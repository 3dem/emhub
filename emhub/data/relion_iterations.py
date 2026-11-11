"""The iterations of a Relion map (Class3D, Refine3D, InitialModel) for
emflow's VolumeViewer, to play the map through them.

A map of a Relion job (``run_it025_class003.mrc``, ``run_class001.mrc``,
``run_it011_half1_class001.mrc``, ``run_ct5_it030_class002.mrc`` when the job
was continued) belongs to a series: the same class at every iteration of the
job, the final map last. Each iteration has a model STAR file next to its maps
(``run_it025_model.star``; ``run_it011_half1_model.star`` in Refine3D, whose
iterations only have half maps; ``run_model.star`` for the final one), with:

- ``model_general.rlnCurrentResolution``: the resolution of the iteration (Å).
- ``model_classes``: per class, ``rlnClassDistribution`` (share of the
  particles) and ``rlnEstimatedResolution`` (Å).
- ``model_class_N``: per resolution shell, ``rlnResolution`` (1/Å) and
  ``rlnGoldStandardFsc`` (Refine3D: the FSC of the half maps; all ones or
  zeros in Class3D, where it is not computed, so it is then left out).

Reading the model files can be slow (a network file system: about a second
each), so the results are kept in memory per file (path, modification time
and size): a finished iteration never changes.
"""

import math
import os
import re
import threading
from collections import OrderedDict

# The map of an iteration: prefix, continue number, iteration, half, class
_ITERATION_MAP = re.compile(
    r'^(?P<prefix>.+?)_(?:ct(?P<ct>\d+)_)?it(?P<it>\d+)_(?P<half>half[12]_)?class(?P<cls>\d+)\.mrc$')
# The final map of a job (no iteration)
_FINAL_MAP = re.compile(r'^(?P<prefix>.+?)_(?P<half>half[12]_)?class(?P<cls>\d+)\.mrc$')

_cache = OrderedDict()
_cache_lock = threading.Lock()
_CACHE_SIZE = 2000


def _parse_map(name):
    """ (prefix, ct, iteration, half, class) of a map file name (iteration
    None for the final map), or None. """
    m = _ITERATION_MAP.match(name)
    if m:
        return (m['prefix'], int(m['ct'] or 0), int(m['it']), m['half'] or '', int(m['cls']))
    m = _FINAL_MAP.match(name)
    if m and not _ITERATION_MAP.match(name):
        return (m['prefix'], 0, None, m['half'] or '', int(m['cls']))
    return None


def _model_star(folder, prefix, ct, it, half):
    if it is None:
        return os.path.join(folder, f'{prefix}_model.star')
    ct_part = f'ct{ct}_' if ct else ''
    model = os.path.join(folder, f'{prefix}_{ct_part}it{it:03d}_{half}model.star')
    if not os.path.exists(model) and not half:
        # Refine3D: only the models of the half sets
        alt = os.path.join(folder, f'{prefix}_{ct_part}it{it:03d}_half1_model.star')
        if os.path.exists(alt):
            return alt
    return model


def _float(v):
    """ A finite float (JSON has no inf or nan; Relion writes inf for the
    resolution of the first iteration), else None. """
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _model_stats(model_star, class_id):
    """ Resolution, class share and resolution, and FSC of a class in a model
    STAR file (None values when missing). Kept in memory per file. """
    from emtools.metadata import StarFile

    try:
        st = os.stat(model_star)
    except OSError:
        return None
    key = (os.path.abspath(model_star), st.st_mtime, st.st_size, class_id)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    stats = {'resolution': None, 'classDistribution': None,
             'classResolution': None, 'fsc': None}
    with StarFile(model_star) as sf:
        names = sf.getTableNames()
        if 'model_general' in names:
            g = sf.getTable('model_general', guessType=False)[0]
            res = _float(getattr(g, 'rlnCurrentResolution', None))
            stats['resolution'] = res if res and 0 < res < 999 else None
        if 'model_classes' in names:
            rows = sf.getTable('model_classes', guessType=False)
            if 0 < class_id <= len(rows):
                row = rows[class_id - 1]
                stats['classDistribution'] = _float(getattr(row, 'rlnClassDistribution', None))
                res = _float(getattr(row, 'rlnEstimatedResolution', None))
                stats['classResolution'] = res if res and 0 < res < 999 else None
        table = f'model_class_{class_id}'
        if table in names:
            t = sf.getTable(table, guessType=False)
            if 'rlnGoldStandardFsc' in t.getColumnNames():
                x = [_float(r.rlnResolution) for r in t]
                y = [_float(r.rlnGoldStandardFsc) for r in t]
                pts = [(a, b) for a, b in zip(x, y) if a is not None and b is not None]
                # Class3D does not compute it (all the same value)
                if len(pts) > 2 and len({round(b, 6) for _, b in pts}) > 1:
                    stats['fsc'] = {'resolution': [a for a, _ in pts], 'fsc': [b for _, b in pts]}
    with _cache_lock:
        _cache[key] = stats
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return stats


def is_relion_map(name):
    """ True for the file name of a map of a Relion iteration or job. """
    return _parse_map(name) is not None


def map_iterations(map_path):
    """ The series of the Relion map at map_path: every iteration of the
    same class (and half, for Refine3D: half 1 of the iterations, the full
    final map) in its folder, in order (continued runs after, the final map
    last), with the stats of each model STAR. None if the file name is not
    a Relion map or the series has a single map. Each item: {iteration (None:
    final), label, file, resolution, classDistribution, classResolution,
    fsc}; `current`: the index of map_path. """
    folder, name = os.path.split(map_path)
    parsed = _parse_map(name)
    if not parsed:
        return None
    prefix, _, _, _, cls = parsed
    series = []
    for f in os.listdir(folder):
        p = _parse_map(f)
        if not p or p[0] != prefix or p[4] != cls:
            continue
        _, ct, it, half, _ = p
        # The iterations of one half (Refine3D: half 1), and the full maps
        if half == 'half2_' or (it is None and half):
            continue
        series.append((ct, it, half, f))
    if len(series) < 2:
        return None
    # Iterations by continue and number, the final map last
    series.sort(key=lambda s: (s[1] is None, s[0], s[1] if s[1] is not None else 0))
    items = []
    for ct, it, half, f in series:
        stats = _model_stats(_model_star(folder, prefix, ct, it, half), cls) or {}
        label = 'Final' if it is None else (f'Iteration {it}' + (f' (continue {ct})' if ct else ''))
        items.append(dict(stats, iteration=it, label=label, file=f))
    current = next((i for i, s in enumerate(series) if s[3] == name), len(items) - 1)
    return {'classId': cls, 'items': items, 'current': current}
