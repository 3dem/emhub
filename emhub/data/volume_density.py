"""Volume density for emflow's VolumeViewer "3D volume" tab (iso-surface).

The viewer gets a small grid of the volume (scaled down and quantized to
uint8, for transfer and GPU) plus the histogram and statistics computed from
the float values, in the units of the map:

- ``histogram.counts``: the full-resolution volume (every voxel, before
  scaling and quantization).
- ``histogram.shown``: the scaled grid the surface is computed from (before
  quantization). Scaling down averages voxels, which narrows the
  distribution, so the share of voxels enclosed by a threshold is computed
  from these counts.

Both use the same bins, over ``histogram.range``: the full-resolution values
from the 0.01 to the 99.99 percentile (of a sample, so a few outliers do not
squeeze the plot); ``below`` and ``above`` (``shownBelow``, ``shownAbove``)
count the voxels left out on each side.
The uint8 values map linearly to ``valueRange`` (0 -> valueRange[0], 255 ->
valueRange[1]), so a threshold t is ``(t - v0) / (v1 - v0)`` on the grid.

The grid is scaled down when it has more than ``max_voxels`` voxels (block
means of an integer ``binning``, read in chunks: fit for big tomograms) or a
side longer than ``max_size`` (Fourier cropping of the whole map with emtools,
as for maps; ``binning`` is then the real scale factor). Its bytes are zlib
compressed (``encoding: 'zlib'``) when that is worth it. ``timing`` has the
seconds of each step on the server (``cached`` when it was in memory).
"""

import base64
import os
import threading
import time
import zlib
from collections import OrderedDict

import numpy as np

DEFAULT_MAX_VOXELS = 2_000_000
MAX_VOXELS = 8_000_000
# Largest grid of a Fourier-scaled map (256^3 is 16.7 M voxels)
MAX_SIZE_VOXELS = 256 ** 3
HISTOGRAM_BINS = 200
# Full-resolution voxels sampled to find the histogram range
_SAMPLE_VOXELS = 2_000_000
_CHUNK_VOXELS = 32_000_000
# Maps up to this many voxels are scaled in Fourier space (in memory)
_FOURIER_MAX_VOXELS = 512 ** 3
# Grids bigger than this are compressed
_COMPRESS_BYTES = 256 * 1024

_cache = OrderedDict()
_cache_lock = threading.Lock()
_CACHE_SIZE = 4


def binning_for(shape, max_voxels):
    """ Smallest integer block size whose binned grid has at most max_voxels. """
    f = 1
    while np.prod([-(-n // f) for n in shape]) > max_voxels:
        f += 1
    return f


def _bin_slab(slab, f, ny, nx):
    """ Block means (f x f x f) of a (<=f, Y, X) slab -> (ny, nx). """
    s = slab.sum(axis=0, dtype=np.float64)
    s = np.add.reduceat(s, np.arange(0, s.shape[0], f), axis=0)
    s = np.add.reduceat(s, np.arange(0, s.shape[1], f), axis=1)
    cy = np.diff(np.append(np.arange(0, slab.shape[1], f), slab.shape[1]))
    cx = np.diff(np.append(np.arange(0, slab.shape[2], f), slab.shape[2]))
    return (s / (slab.shape[0] * cy[:, None] * cx[None, :])).astype(np.float32)[:ny, :nx]


class _Timer:
    """ Seconds of each step, in order. """
    def __init__(self):
        self.t0 = self.last = time.perf_counter()
        self.steps = {}

    def step(self, name):
        now = time.perf_counter()
        self.steps[name] = round(self.steps.get(name, 0) + now - self.last, 4)
        self.last = now

    def result(self):
        return dict(self.steps, total=round(time.perf_counter() - self.t0, 4))


def _robust_range(sample, vmin, vmax):
    lo, hi = (float(v) for v in np.percentile(sample, [0.01, 99.99]))
    if not hi > lo:
        lo, hi = vmin, max(vmax, vmin + 1.0)
    return lo, hi


def _stats(total, total2, n, vmin, vmax):
    mean = total / n
    std = float(np.sqrt(max(total2 / n - mean * mean, 0.0)))
    return {'min': vmin, 'max': vmax, 'mean': mean, 'std': std}


def _binned(data, f, timer):
    """ Block-mean grid read in chunks, statistics and a sample of data. """
    Z, Y, X = data.shape
    nz, ny, nx = -(-Z // f), -(-Y // f), -(-X // f)
    grid = np.empty((nz, ny, nx), dtype=np.float32)
    vmin, vmax, total, total2 = np.inf, -np.inf, 0.0, 0.0
    stride = max(1, int(np.ceil(np.sqrt(float(Z) * Y * X / _SAMPLE_VOXELS))))
    sample = []
    for k, z0 in enumerate(range(0, Z, f)):
        slab = np.asarray(data[z0:z0 + f], dtype=np.float32)
        vmin = min(vmin, float(slab.min()))
        vmax = max(vmax, float(slab.max()))
        total += float(slab.sum(dtype=np.float64))
        total2 += float(np.square(slab, dtype=np.float64).sum())
        grid[k] = _bin_slab(slab, f, ny, nx)
        sample.append(slab[:, ::stride, ::stride].ravel())
    timer.step('read+bin')
    stats = _stats(total, total2, float(Z) * Y * X, vmin, vmax)
    return grid, stats, np.concatenate(sample)


def _histogram_chunks(data, bins, lo, hi):
    """ Exact histogram of every voxel, in chunks of Z slices. """
    Z, Y, X = data.shape
    counts = np.zeros(bins, dtype=np.int64)
    below = above = 0
    step = max(1, _CHUNK_VOXELS // (Y * X))
    for z0 in range(0, Z, step):
        chunk = np.asarray(data[z0:z0 + step], dtype=np.float32)
        counts += np.histogram(chunk, bins=bins, range=(lo, hi))[0]
        below += int(np.count_nonzero(chunk < lo))
        above += int(np.count_nonzero(chunk > hi))
    return counts, below, above


def _compute(path, max_voxels, max_size, bins):
    import mrcfile

    timer = _Timer()
    with mrcfile.mmap(path, permissive=True) as mrc:
        data = mrc.data
        if data.ndim != 3:
            raise Exception(f'Not a volume (shape {data.shape}): {path}')
        Z, Y, X = data.shape
        n = float(Z) * Y * X
        too_long = bool(max_size) and max(Z, Y, X) > max_size

        if too_long and n <= _FOURIER_MAX_VOXELS:
            # A map: Fourier cropping to max_size (emtools), in memory
            from emtools.image import Image
            full = np.array(data, dtype=np.float32)   # read now (copy)
            timer.step('read')
            vmin, vmax = float(full.min()), float(full.max())
            stats = _stats(float(full.sum(dtype=np.float64)),
                           float(np.square(full, dtype=np.float64).sum()), n, vmin, vmax)
            scale = max_size / max(Z, Y, X)
            grid = Image._fourier_rescale(full, scale).astype(np.float32, copy=False)
            binning = max(Z, Y, X) / max(grid.shape)
            method = f'Fourier ×{scale:.3f}'
            timer.step('scale')
            stride = max(1, int(np.ceil(np.sqrt(n / _SAMPLE_VOXELS))))
            lo, hi = _robust_range(full[:, ::stride, ::stride], vmin, vmax)
            counts = np.histogram(full, bins=bins, range=(lo, hi))[0]
            below = int(np.count_nonzero(full < lo))
            above = int(np.count_nonzero(full > hi))
            del full
        else:
            f = binning_for((Z, Y, X), max_voxels)
            if too_long:
                f = max(f, -(-max(Z, Y, X) // max_size))
            grid, stats, sample = _binned(data, f, timer)
            binning = f
            method = f'block mean ×{f}' if f > 1 else 'full resolution'
            lo, hi = _robust_range(sample, stats['min'], stats['max'])
            counts, below, above = _histogram_chunks(data, bins, lo, hi)

    shown = np.histogram(grid, bins=bins, range=(lo, hi))[0]
    shown_below = int(np.count_nonzero(grid < lo))
    shown_above = int(np.count_nonzero(grid > hi))
    timer.step('histogram')

    # uint8 over the range of the grid (its own 0.01-99.99 percentiles)
    q0, q1 = (float(v) for v in np.percentile(grid, [0.01, 99.99]))
    if not q1 > q0:
        q0, q1 = float(grid.min()), float(grid.max()) or 1.0
    u8 = np.clip(np.round((grid - q0) * (255.0 / (q1 - q0))), 0, 255).astype(np.uint8)
    raw = u8.tobytes()
    encoding = None
    if len(raw) > _COMPRESS_BYTES:
        packed = zlib.compress(raw, 1)
        if len(packed) < 0.9 * len(raw):
            raw, encoding = packed, 'zlib'
    data_b64 = base64.b64encode(raw).decode('ascii')
    timer.step('encode')

    nz, ny, nx = grid.shape
    result = {
        # Grid (z, y, x), x fastest, base64 uint8 (zlib compressed: encoding)
        'shape': [int(nz), int(ny), int(nx)],
        'binning': float(binning),
        'method': method,
        'data': data_b64,
        'encoding': encoding,
        'valueRange': [q0, q1],
        'dimensions': [X, Y, Z],
        'stats': stats,
        'histogram': {
            'range': [float(lo), float(hi)],
            'counts': [int(c) for c in counts],
            'shown': [int(c) for c in shown],
            'below': below,
            'above': above,
            'shownBelow': shown_below,
            'shownAbove': shown_above,
        },
        'bytes': {'grid': int(u8.size), 'sent': len(data_b64)},
        'timing': timer.result(),
    }
    t = result['timing']
    print(f"[volume_density] {os.path.basename(path)} {X}x{Y}x{Z} -> {nx}x{ny}x{nz} "
          f"({method}), {result['bytes']['sent'] / 1e6:.1f} MB sent, "
          + ", ".join(f"{k} {v:.2f}s" for k, v in t.items()))
    return result


def load_volume_density(path, max_voxels=None, max_size=None, bins=HISTOGRAM_BINS):
    """ Density of the volume at path for the iso-surface view (see module
    doc). max_voxels bounds the size of the grid (block means); max_size its
    longest side (Fourier scaling for maps). Recent results are kept in
    memory (keyed by path, modification time and size). """
    max_voxels = int(max_voxels or DEFAULT_MAX_VOXELS)
    max_voxels = max(64 ** 3, min(MAX_VOXELS, max_voxels))
    if max_size:
        max_size = max(32, min(int(round(MAX_SIZE_VOXELS ** (1 / 3))), int(max_size)))
        # A whole side of max_size (e.g. 256^3) may pass the voxel budget
        max_voxels = max(max_voxels, min(MAX_SIZE_VOXELS, max_size ** 3))
    st = os.stat(path)
    key = (os.path.abspath(path), st.st_mtime, st.st_size, max_voxels, max_size, bins)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            hit = _cache[key]
            return dict(hit, timing=dict(hit['timing'], cached=True))
    result = _compute(path, max_voxels, max_size, bins)
    with _cache_lock:
        _cache[key] = result
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return result
