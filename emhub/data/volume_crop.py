"""Full-resolution crops of the sections of a volume, for emflow's
VolumeViewer Slices tab.

The slice images of a volume are thumbnails (at most ``slice_dim`` pixels a
side, see api_viewers._volume_axis_slices), so a zoomed section only shows
enlarged thumbnail pixels. When the view needs more detail the viewer asks for
the window it shows: the real voxels of that window, binned (block means) only
when it has more voxels than the screen pixels, so no detail is made up.

Contrast: a thumbnail maps the slice from its min-max to 0-255, is scaled
down and then auto-contrasted (PIL ImageOps.autocontrast with a cutoff).
``slice_levels`` gives the two values of the volume that end up as 0 and 255.
A crop shows other values (less binned, or filtered: they spread more or
less), so these levels are widened or narrowed by the ratio of the spread of
the crop to that of the window binned as the thumbnail: the crop keeps the
brightness and contrast of the thumbnail it covers.

Z sections (contiguous in the file) are read whole once and kept in memory
(a few hundred MB at most, least recently used dropped), so moving or zooming
over them does not read the file again; X and Y sections are strided in the
file, so only the window shown is read (an X window as whole rows, and only
when they are not too many: else the viewer keeps the thumbnail).

An optional Gaussian low-pass (``sigma`` in voxels, numpy only) is applied on
the full-resolution voxels before binning; the window is read with a margin so
its edges are filtered as its center.

Sections are oriented as the thumbnails: Z (rows y, columns x), Y (rows z,
columns x) and X upright (rows y, columns z).
"""

import base64
import io
import math
import os
import threading
import time
from collections import OrderedDict

import numpy as np

# Largest output side of a crop (pixels) and largest Gaussian sigma (voxels)
MAX_OUTPUT = 4096
MAX_SIGMA = 8.0
# Whole Z sections kept in memory (the views of one section, zoomed or
# moved, are cut from it): least recently used are dropped past this many
# bytes. Also the shape of the volumes
_SECTIONS_BYTES = 512 * 1024 ** 2
_sections = OrderedDict()
_sections_lock = threading.Lock()
# X windows are read as whole rows, up to this many bytes
_ROWS_BYTES = 64 * 1024 ** 2


class CropTooLarge(Exception):
    """ The window would take too long to read. """


def autocontrast_levels(pil_img, cutoff):
    """ The lowest and highest 0-255 values kept by
    ImageOps.autocontrast(pil_img, cutoff) of a grayscale image (the same
    algorithm): they are mapped to 0 and 255. None when it keeps the image
    as is. """
    h = list(pil_img.histogram()[:256])
    n = sum(h)
    if cutoff:
        cut = n * cutoff // 100
        for lo in range(256):
            if cut > h[lo]:
                cut -= h[lo]
                h[lo] = 0
            else:
                h[lo] -= cut
                cut = 0
            if cut <= 0:
                break
        cut = n * cutoff // 100
        for hi in range(255, -1, -1):
            if cut > h[hi]:
                cut -= h[hi]
                h[hi] = 0
            else:
                h[hi] -= cut
                cut = 0
            if cut <= 0:
                break
    lo = next((i for i in range(256) if h[i]), 0)
    hi = next((i for i in range(255, -1, -1) if h[i]), 255)
    return None if hi <= lo else (lo, hi)


def slice_levels(array, max_size, cutoff):
    """ [low, high] values of the slice array that its thumbnail (emtools
    Thumbnail: min-max to uint8, scaled to max_size, autocontrast with
    cutoff) shows as 0 and 255. """
    import PIL.Image
    a = np.asarray(array, dtype=np.float32)
    vmin, vmax = float(a.min()), float(a.max())
    if vmax <= vmin:
        return [vmin, vmax]
    img = PIL.Image.fromarray(((a - vmin) / (vmax - vmin) * 255).astype(np.uint8))
    img.thumbnail(max_size)
    lv = autocontrast_levels(img, cutoff) if cutoff is not None else None
    if not lv:
        return [vmin, vmax]
    step = (vmax - vmin) / 255
    return [vmin + lv[0] * step, vmin + lv[1] * step]


def _gaussian(a, sigma):
    """ Separable Gaussian filter of a 2D array (reflected edges). """
    r = max(1, int(math.ceil(3 * sigma)))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    k /= k.sum()
    for ax in (0, 1):
        n = a.shape[ax]
        rr = min(r, n - 1)
        if rr <= 0:
            continue
        kk = k[r - rr:r + rr + 1]
        kk = kk / kk.sum()
        pad = [(0, 0), (0, 0)]
        pad[ax] = (rr, rr)
        p = np.pad(a, pad, mode='reflect')
        out = np.zeros_like(a)
        for j, w in enumerate(kk):
            sl = [slice(None), slice(None)]
            sl[ax] = slice(j, j + n)
            out += w * p[tuple(sl)]
        a = out
    return a


def _block_mean(a, f):
    """ Block means of f x f (the last partial blocks are dropped). """
    if f <= 1:
        return a
    h, w = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    return a[:h, :w].reshape(h // f, f, w // f, f).mean(axis=(1, 3))


def _file_key(path):
    st = os.stat(path)
    return os.path.abspath(path), st.st_mtime, st.st_size


def _shape(path):
    """ (Z, Y, X) of the volume, from its header (kept in memory). """
    import mrcfile

    key = ('shape',) + _file_key(path)
    with _sections_lock:
        if key in _sections:
            return _sections[key]
    with mrcfile.mmap(path, mode='r', permissive=True) as mrc:
        shape = tuple(int(n) for n in mrc.data.shape[-3:])
    with _sections_lock:
        _sections[key] = shape
    return shape


def _read(path, axis, index, h0, h1, v0, v1):
    """ The window of a section (rows: vertical, columns: horizontal) as
    float32 and the seconds it took to read (0 if it was in memory). Z
    sections are contiguous in the file: they are read whole once and kept
    in memory. X and Y sections are strided, so only the window is read. """
    import mrcfile

    t0 = time.time()
    if axis == 'z':
        key = ('z',) + _file_key(path) + (index,)
        with _sections_lock:
            if key in _sections:
                _sections.move_to_end(key)
                return _sections[key][v0:v1, h0:h1], 0.0
        with mrcfile.mmap(path, mode='r', permissive=True) as mrc:
            a = np.array(mrc.data[index], dtype=np.float32)
        with _sections_lock:
            _sections[key] = a
            sizes = [(k, x.nbytes) for k, x in _sections.items() if isinstance(x, np.ndarray)]
            total = sum(n for _, n in sizes)
            for k, n in sizes[:-1]:
                if total <= _SECTIONS_BYTES:
                    break
                del _sections[k]
                total -= n
        return a[v0:v1, h0:h1], time.time() - t0
    with mrcfile.mmap(path, mode='r', permissive=True) as mrc:
        data = mrc.data
        if axis == 'y':
            a = data[v0:v1, index, h0:h1]
        else:
            # x upright (rows y, columns z): each voxel is in another row of
            # the file; the whole rows of the window are much faster to read
            # (over a network file system) than one voxel of each, but only
            # a small window is worth it (else: zoom in more)
            nbytes = (h1 - h0) * (v1 - v0) * data.shape[-1] * data.itemsize
            if nbytes > _ROWS_BYTES:
                raise CropTooLarge(
                    f'The X window reads {nbytes / 1024 ** 2:.0f} MB of the '
                    f'file (at most {_ROWS_BYTES / 1024 ** 2:.0f} MB): zoom in more')
            a = np.array(data[h0:h1, v0:v1, :])[:, :, index].T
        a = np.array(a, dtype=np.float32)
    return a, time.time() - t0


def volume_crop(path, axis, index, x0, y0, w, h, max_w, max_h,
                levels=None, sigma=0, thumb_binning=1):
    """ PNG (base64) of the window (x0, y0, w, h) of section `index` of `axis`
    (section voxels: horizontal, vertical; see the module doc), at most
    max_w x max_h pixels. levels: [low, high] mapped to 0 and 255 (the
    thumbnail's, see slice_levels), else the 1-99 percentiles of the window.
    sigma: Gaussian low-pass in voxels (0: none). thumb_binning: voxels per
    pixel of the thumbnail the levels come from. """
    import PIL.Image

    t0 = time.time()
    if axis not in ('x', 'y', 'z'):
        raise Exception(f'Invalid axis: {axis}')
    sigma = min(MAX_SIGMA, max(0.0, float(sigma or 0)))
    max_w = max(1, min(MAX_OUTPUT, int(max_w)))
    max_h = max(1, min(MAX_OUTPUT, int(max_h)))
    Z, Y, X = _shape(path)
    H, V, N = {'z': (X, Y, Z), 'y': (X, Z, Y), 'x': (Z, Y, X)}[axis]
    index = min(max(int(index), 0), N - 1)
    h0 = min(max(int(math.floor(x0)), 0), H - 1)
    v0 = min(max(int(math.floor(y0)), 0), V - 1)
    h1 = min(max(int(math.ceil(x0 + w)), h0 + 1), H)
    v1 = min(max(int(math.ceil(y0 + h)), v0 + 1), V)
    # Integer binning to the output size (never more pixels than voxels)
    f = max(1, math.ceil((h1 - h0) / max_w), math.ceil((v1 - v0) / max_h))
    # A margin for the filter, cut afterwards
    m = int(math.ceil(3 * sigma)) if sigma > 0 else 0
    rh0, rv0 = max(h0 - m, 0), max(v0 - m, 0)
    rh1, rv1 = min(h1 + m, H), min(v1 + m, V)
    a, t_read = _read(path, axis, index, rh0, rh1, rv0, rv1)

    window = (slice(v0 - rv0, v1 - rv0), slice(h0 - rh0, h1 - rh0))
    raw = a[window]
    # Filtered with its margin, then cut
    a = _gaussian(a, sigma)[window] if sigma > 0 else raw
    lo, hi = (levels if levels and len(levels) == 2 and levels[1] > levels[0]
              else np.percentile(_block_mean(raw, f), [1, 99]))
    lo, hi = float(lo), float(hi)
    a = _block_mean(a, f)
    # The levels are the thumbnail's, whose pixels average thumb_binning
    # voxels: the values shown here (other binning, filtered) spread more or
    # less, so the levels are scaled as much around their middle and the
    # contrast looks as the thumbnail's
    tb = max(1, int(round(float(thumb_binning or 1))))
    ref = _block_mean(raw, tb) if tb > 1 and min(raw.shape) >= 2 * tb else raw
    r = float(a.std()) / max(float(ref.std()), 1e-12)
    if np.isfinite(r) and r > 0:
        mid = 0.5 * (lo + hi)
        lo, hi = mid - (mid - lo) * r, mid + (hi - mid) * r
    u8 = np.clip((a - lo) * (255.0 / max(hi - lo, 1e-12)), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    PIL.Image.fromarray(u8).save(buf, format='PNG')
    return {
        'image': base64.b64encode(buf.getvalue()).decode('utf-8'),
        'axis': axis,
        'index': index,
        # Voxels of the section covered by the image
        'x0': h0, 'y0': v0, 'w': u8.shape[1] * f, 'h': u8.shape[0] * f,
        'binning': f,
        'sigma': sigma,
        'timing': {'read': round(t_read, 4), 'cached': t_read == 0,
                   'total': round(time.time() - t0, 4)},
    }
