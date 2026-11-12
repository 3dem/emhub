"""Analysis of the iterations of Relion 3D classification and 3D auto-refine
jobs (SPA and tomography) for emflow's table viewer, as the Relion tutorials
check them: the values Relion writes per iteration in the optimiser and model
STAR files, and the maps.

A table with an 'Overall' row and one row per iteration (the last first,
without iteration 0, which has no results yet; and the final result of
Refine3D), with its resolution, accuracies and changes of the assignments,
the convergence criteria of Relion (_optimiser.star:
rlnChangesOptimalOrientations, rlnChangesOptimalOffsets,
rlnChangesOptimalClasses). The rows show:

  - Overall: plots of the values of all iterations (resolution, changes,
    accuracies or Pmax for Refine3D, class distribution and resolution
    for Class3D).
  - An iteration of Refine3D: its map (the half 1 map, the final map at the
    end), the FSC between the half maps (gold standard) and the SSNR.
  - An iteration of Class3D: the SSNR of the classes (as relion_star_plottable
    ... data_model_class_N rlnResolution rlnSsnrMap) and the class
    distribution; its most populated class volumes with the 'classes' action.

    data = load_relion_iterations(root, job_dir, refine)
    table = build_iterations_table(data, title)
    pane = build_iteration_pane(root, data, action_id, row_cells)

Also the series of a Relion map, for emflow's VolumeViewer to play the map
through the iterations of its job (map_iterations, see "Map series" below).
"""

import math
import os
import re
import threading
from collections import OrderedDict

from emtools.metadata import StarFile

from . import project_file_path

# run_it025_optimiser.star, run_ct5_it025_optimiser.star (continued), and
# run_optimiser.star (final result of Refine3D)
_OPTIMISER = re.compile(r'^run(?:_ct(\d+))?(?:_it(\d+))?_optimiser\.star$')

ACTION_OVERALL = {'id': 'overall', 'label': 'plots'}
ACTION_ITERATION = {'id': 'iteration', 'label': 'results'}
ACTION_VOLUMES = {'id': 'volumes', 'label': 'classes'}
OVERALL_ROW = 'overall'

# Class volumes shown for an iteration of a 3D classification (a 2 x 2 grid)
MAX_CLASS_VOLUMES = 4
# Relion's initial values of the changes (before the first expectation)
_NO_CHANGES = 999
# FSC threshold of the gold-standard resolution
FSC_THRESHOLD = 0.143
# SSNR written by Relion beyond the current image size (0.001001)
_MIN_SSNR = 0.0011

# (key, label of optimiser_general)
_OPTIMISER_VALUES = (
    ('iteration', 'rlnCurrentIteration'),
    ('accRot', 'rlnOverallAccuracyRotations'),
    ('accTrans', 'rlnOverallAccuracyTranslationsAngst'),
    ('changesOrient', 'rlnChangesOptimalOrientations'),
    ('changesOffsets', 'rlnChangesOptimalOffsets'),
    ('changesClasses', 'rlnChangesOptimalClasses'),
)

# (key, label of model_general)
_MODEL_VALUES = (
    ('resolution', 'rlnCurrentResolution'),
    ('pixelSize', 'rlnPixelSize'),
    ('pmax', 'rlnAveragePmax'),
)


def _float(value):
    """ The value as a float, None if it is not a finite number (e.g. the
    'inf' resolution of iteration 0): not valid in JSON. """
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _round(value, digits=2):
    return None if value is None else round(value, digits)


class RelionIteration:
    """ Values of an iteration (optimiser and model STAR files). """

    def __init__(self, name, ct, it):
        self.name = name  # optimiser filename, the row id
        self.final = it is None
        self.ct = ct
        self.values = {}
        self.classes = []  # [{volume, distribution, resolution}]
        self.model = None  # model STAR (path relative to the project)

    @property
    def number(self):
        """ The iteration number, 'Final' for the final result. """
        return 'Final' if self.final else int(self.values.get('iteration') or 0)

    @property
    def label(self):
        return 'Final' if self.final else f'Iteration {self.number}'

    @property
    def x(self):
        return self.values.get('iteration')


class RelionIterations:
    """ The iterations of a Relion Class3D or Refine3D job, in order. """

    def __init__(self, job_dir, iterations, refine):
        self.job_dir = job_dir
        self.iterations = iterations
        # Auto-refine: two half maps per iteration (half1 / half2 models)
        self.refine = refine

    def get(self, name):
        for i in self.iterations:
            if i.name == name:
                return i
        raise Exception(f'Unknown iteration: {name!r}')


def _optimiser_files(job_dir):
    """ (name, ct, it) of the optimiser files: the iterations in order and the
    final result last. """
    files = []
    for name in os.listdir(job_dir):
        if m := _OPTIMISER.match(name):
            ct, it = m.group(1), m.group(2)
            files.append((name, int(ct) if ct else 0, int(it) if it else None))
    return sorted(files, key=lambda f: (f[2] is None, f[1], f[2] or 0))


def _read_iteration(root, job_dir, name, ct, it):
    i = RelionIteration(name, ct, it)
    with StarFile(os.path.join(job_dir, name)) as sf:
        opt = sf.getTable('optimiser_general', guessType=False)[0]._asdict()
    for key, label in _OPTIMISER_VALUES:
        i.values[key] = _float(opt.get(label))
    # Relion's initial values (no accuracies or changes yet)
    for key in ('accRot', 'accTrans', 'changesOrient', 'changesOffsets', 'changesClasses'):
        if (v := i.values[key]) is not None and v >= _NO_CHANGES:
            i.values[key] = None

    model = opt.get('rlnModelStarFile')
    model_path = project_file_path(root, model) if model else None
    if not model_path or not os.path.exists(model_path):
        # Not written yet (running) or moved: next to the optimiser
        model_path = os.path.join(job_dir, name.replace('_optimiser.star', '_model.star'))
        if not os.path.exists(model_path):
            model_path = model_path.replace('_model.star', '_half1_model.star')
    if not os.path.exists(model_path):
        return None
    i.model = model_path

    with StarFile(model_path) as sf:
        general = sf.getTable('model_general', guessType=False)[0]._asdict()
        for row in sf.iterTable('model_classes', guessType=False):
            i.classes.append({
                'volume': row.rlnReferenceImage,
                'distribution': _float(row.rlnClassDistribution),
                'resolution': _float(getattr(row, 'rlnEstimatedResolution', None)),
            })
    for key, label in _MODEL_VALUES:
        i.values[key] = _float(general.get(label))
    return i


def load_relion_iterations(root, job_dir, refine=False):
    """ The iterations of the Relion job in job_dir (absolute path) whose
    optimiser and model STAR files exist, see RelionIterations; refine:
    whether it is an auto-refine (Refine3D) job. """
    iterations = []
    for name, ct, it in _optimiser_files(job_dir):
        try:
            if i := _read_iteration(root, job_dir, name, ct, it):
                iterations.append(i)
        except Exception:
            # An iteration being written by a running job
            continue
    # Iteration 0 has no results yet (only the initial reference)
    iterations = [i for i in iterations if i.final or i.x]
    # The final result of Refine3D (last) might have the number of its last
    # iteration: plotted after it
    if len(iterations) > 1 and iterations[-1].final:
        last, prev = iterations[-1].x, iterations[-2].x
        if prev is not None and (last is None or last <= prev):
            iterations[-1].values['iteration'] = prev + 1
    return RelionIterations(job_dir, iterations, refine)


# ---------------------------- Table -------------------------------------

def build_iterations_table(data, title):
    """ TableViewerData with the Overall row (its plots shown when the table
    is opened) and a row per iteration, the last first. """
    columns = [
        {'id': 'it', 'label': 'Iteration', 'align': 'left'},
        {'id': 'resolution', 'label': 'Resolution (Å)', 'align': 'right', 'sortable': True},
        {'id': 'accRot', 'label': 'Acc. rot. (°)', 'align': 'right', 'sortable': True},
        {'id': 'accTrans', 'label': 'Acc. trans. (Å)', 'align': 'right', 'sortable': True},
        {'id': 'changesOrient', 'label': 'Δ orient. (°)', 'align': 'right', 'sortable': True},
        {'id': 'changesOffsets', 'label': 'Δ offsets (Å)', 'align': 'right', 'sortable': True},
    ]
    if not data.refine:
        columns.append({'id': 'changesClasses', 'label': 'Δ classes (%)',
                        'align': 'right', 'sortable': True})
        columns.append({'id': 'classes', 'label': 'Classes', 'align': 'right'})
    columns.append({'id': 'pmax', 'label': 'Pmax', 'align': 'right', 'sortable': True})

    rows = [{'id': OVERALL_ROW, 'cells': {'it': 'Overall', 'optimiser': OVERALL_ROW},
             'actions': [], 'defaultAction': dict(ACTION_OVERALL)}]
    for i in reversed(data.iterations):
        v = i.values
        changes_classes = v.get('changesClasses')
        cells = {
            'optimiser': i.name,
            'it': i.number,
            'resolution': _round(v.get('resolution')),
            'accRot': _round(v.get('accRot'), 3),
            'accTrans': _round(v.get('accTrans'), 3),
            'changesOrient': _round(v.get('changesOrient'), 3),
            'changesOffsets': _round(v.get('changesOffsets'), 3),
            'changesClasses': (None if changes_classes is None
                               else round(100 * changes_classes, 2)),
            'classes': len(i.classes),
            'pmax': _round(v.get('pmax'), 3),
        }
        rows.append({'id': i.name, 'cells': cells,
                     'actions': [] if data.refine else [dict(ACTION_VOLUMES)],
                     'defaultAction': dict(ACTION_ITERATION)})

    n = sum(not i.final for i in data.iterations)
    info = f'{n} iterations'
    if data.iterations and (ps := data.iterations[-1].values.get('pixelSize')):
        info += f', {ps:0.3f} Å/px'
    # Shown when opened: the final result (or the last iteration while running)
    first = rows[1] if len(rows) > 1 else rows[0]
    return {'title': f'{title} ({info})', 'columns': columns, 'rows': rows,
            'initialAction': {'rowId': first['id'],
                              'actionId': first['defaultAction']['id']}}


# ---------------------------- Plots -------------------------------------

_MARGIN = {'l': 64, 'r': 56, 't': 24, 'b': 48}


def _plot(title, traces, layout):
    return {'kind': 'plotly', 'title': title, 'figure': {'data': traces, 'layout': layout}}


def _iteration_traces(data, series):
    """ Line traces of the values (series: [(key, name, scale, yaxis)]) of
    all iterations. """
    traces = []
    for key, name, scale, yaxis in series:
        xs, ys, texts = [], [], []
        for i in data.iterations:
            v = i.values.get(key)
            if v is not None and i.x is not None:
                xs.append(i.x)
                ys.append(v * scale)
                texts.append(i.label)
        if ys:
            traces.append({
                'type': 'scatter', 'mode': 'lines+markers', 'name': name,
                'x': xs, 'y': ys, 'text': texts, 'yaxis': yaxis,
                'hovertemplate': '%{text}: %{y}<extra>' + name + '</extra>',
                'marker': {'size': 5}, 'line': {'width': 1.5},
            })
    return traces


def _iterations_plot(data, title, series, y_title, y2_title=None):
    traces = _iteration_traces(data, series)
    if not traces:
        return {'kind': 'empty', 'title': title, 'message': 'No values'}
    layout = {
        'xaxis': {'title': {'text': 'Iteration'}},
        'yaxis': {'title': {'text': y_title}},
        'margin': _MARGIN,
        'showlegend': len(traces) > 1,
        'legend': {'orientation': 'h', 'y': 1.12},
    }
    if y2_title:
        layout['yaxis2'] = {'title': {'text': y2_title}, 'overlaying': 'y',
                            'side': 'right', 'showgrid': False}
    return _plot(title, traces, layout)


def _class_series_plot(data, title, key, y_title, scale=1, stacked=False):
    """ A value of each class (key of the classes) per iteration. """
    n = max((len(i.classes) for i in data.iterations), default=0)
    traces = []
    for c in range(n):
        xs, ys = [], []
        for i in data.iterations:
            if c < len(i.classes) and i.x is not None:
                v = i.classes[c][key]
                if stacked or (v is not None and v < _NO_CHANGES):
                    xs.append(i.x)
                    ys.append(round(scale * (v or 0), 2))
        trace = {'type': 'scatter', 'mode': 'lines' if stacked else 'lines+markers',
                 'name': f'Class {c + 1}', 'x': xs, 'y': ys,
                 'marker': {'size': 4},
                 'hovertemplate': f'Class {c + 1}' + ': %{y}<extra></extra>'}
        if stacked:
            trace['stackgroup'] = 'classes'
        traces.append(trace)
    layout = {
        'xaxis': {'title': {'text': 'Iteration'}},
        'yaxis': {'title': {'text': y_title}},
        'margin': _MARGIN,
        'showlegend': n <= 20,
        'legend': {'orientation': 'h', 'y': -0.25},
    }
    if stacked:
        layout['yaxis']['range'] = [0, 100]
    return _plot(title, traces, layout)


def build_overall_pane(data):
    """ 2 x 2 grid with the values of all iterations: resolution, changes of
    the assignments, and Pmax and accuracies (Refine3D) or the resolution
    and distribution of the classes (Class3D). """
    resolution = _iterations_plot(
        data, 'Resolution per iteration',
        [('resolution', 'Resolution', 1, 'y')], 'Resolution (Å)')
    changes = [('changesOrient', 'Δ orientations (°)', 1, 'y'),
               ('changesOffsets', 'Δ offsets (Å)', 1, 'y')]
    if not data.refine:
        changes.append(('changesClasses', 'Δ classes (%)', 100, 'y2'))
    changes = _iterations_plot(
        data, 'Changes of the assignments per iteration', changes,
        'Δ orientations (°), Δ offsets (Å)',
        y2_title=None if data.refine else 'Δ classes (%)')
    if data.refine:
        bottom_left = _iterations_plot(
            data, 'Pmax per iteration', [('pmax', 'Pmax', 1, 'y')], 'Average Pmax')
        bottom_right = _iterations_plot(
            data, 'Accuracy per iteration',
            [('accRot', 'Rotations (°)', 1, 'y'),
             ('accTrans', 'Translations (Å)', 1, 'y')], 'Accuracy (°, Å)')
    else:
        bottom_left = _class_series_plot(
            data, 'Class resolution per iteration', 'resolution', 'Resolution (Å)')
        bottom_right = _class_series_plot(
            data, 'Class distribution per iteration', 'distribution',
            'Particles (%)', scale=100, stacked=True)
    return {'kind': 'grid', 'title': f'Overall — {len(data.iterations)} iterations',
            'layout': '2x2',
            'cells': {'topLeft': resolution, 'topRight': changes,
                      'bottomLeft': bottom_left, 'bottomRight': bottom_right}}


def _class_curves(model_path, n_classes, column):
    """ [(class number, [resolution 1/Å], [Å], [values])] of the
    model_class_N tables, without the frequencies beyond the current
    image size (all zeros). """
    curves = []
    with StarFile(model_path) as sf:
        tables = sf.getTableNames()
        for c in range(1, n_classes + 1):
            if (name := f'model_class_{c}') not in tables:
                continue
            xs, angst, ys = [], [], []
            for row in sf.iterTable(name, guessType=False):
                xs.append(_float(row.rlnResolution))
                angst.append(_float(getattr(row, 'rlnAngstromResolution', None)))
                ys.append(_float(getattr(row, column, None)))
            # Drop the frequencies not computed (beyond the current image
            # size: FSC 0, SSNR 0.001001) and the origin
            while ys and (not ys[-1] or (column == 'rlnSsnrMap' and ys[-1] <= _MIN_SSNR)):
                xs.pop(), angst.pop(), ys.pop()
            curves.append((c, xs[1:], angst[1:], ys[1:]))
    return curves


def fsc_crossing(xs, ys, threshold=FSC_THRESHOLD):
    """ The frequency (1/Å) where the FSC curve first drops below the
    threshold, linearly interpolated between the two points, or None. """
    for i in range(1, len(ys)):
        y0, y1 = ys[i - 1], ys[i]
        if y0 is None or y1 is None or xs[i - 1] is None or xs[i] is None:
            continue
        if y0 >= threshold > y1:
            return xs[i - 1] + (y0 - threshold) * (xs[i] - xs[i - 1]) / (y0 - y1)
    return None


def _resolution_curve_plot(data, it, ssnr):
    """ ssnr: the SSNR of each class (log scale, the resolution of a class
    is where SSNR = 1); otherwise the FSC between the half maps (gold
    standard, Refine3D) with the 0.143 threshold. """
    if ssnr:
        title = f'SSNR — {it.label}' if data.refine else f'SSNR of the classes — {it.label}'
        column, threshold, y_title = 'rlnSsnrMap', 1, 'SSNR'
    else:
        title = f'Gold-standard FSC — {it.label}'
        column, threshold, y_title = 'rlnGoldStandardFsc', FSC_THRESHOLD, 'FSC'
    try:
        curves = _class_curves(it.model, len(it.classes), column)
    except Exception as e:
        return {'kind': 'empty', 'title': title, 'message': str(e)}
    traces = []
    for c, xs, angst, ys in curves:
        if ssnr:
            # Relion writes 999 at the lowest frequencies
            ys = [y if y and y < 999 else None for y in ys]
        traces.append({
            'type': 'scatter', 'mode': 'lines',
            'name': f'Class {c}' if len(curves) > 1 else y_title,
            'x': xs, 'y': ys, 'text': [f'{a:0.2f} Å' if a else '' for a in angst],
            'hovertemplate': '%{text}: %{y}<extra></extra>',
            'line': {'width': 1.5},
        })
    if not traces:
        return {'kind': 'empty', 'title': title, 'message': f'No {column} values'}
    shape = {'type': 'line', 'xref': 'paper', 'x0': 0, 'x1': 1, 'y0': threshold,
             'y1': threshold, 'line': {'color': '#ef4444', 'dash': 'dash', 'width': 1}}
    layout = {
        'xaxis': {'title': {'text': 'Resolution (1/Å)'}},
        'yaxis': {'title': {'text': y_title}},
        'margin': _MARGIN,
        'showlegend': 1 < len(traces) <= 20,
        'legend': {'orientation': 'h', 'y': -0.25},
        'shapes': [shape],
    }
    if ssnr:
        layout['yaxis']['type'] = 'log'
    elif (x := fsc_crossing(traces[0]['x'], traces[0]['y'])) is not None:
        # The resolution achieved: where the FSC crosses the threshold, labeled
        # above and to the right of the point, away from the falling curve
        layout['annotations'] = [{
            'x': x, 'y': threshold, 'xref': 'x', 'yref': 'y',
            'text': f'<b>{1 / x:0.2f} Å</b>', 'showarrow': True, 'arrowhead': 2,
            'ax': 40, 'ay': -64, 'xanchor': 'left', 'font': {'color': '#b91c1c'},
            'bgcolor': 'rgba(255,255,255,0.85)', 'bordercolor': '#ef4444',
        }]
        # Room for the label when the crossing is close to the last frequency
        xs = [v for v in traces[0]['x'] if v is not None]
        layout['xaxis']['range'] = [min(xs), max(max(xs), x + 0.4 * (x - min(xs)))]
    return _plot(title, traces, layout)


def _class_distribution_bars(it):
    """ Particles (%) of each class of the iteration, with its resolution. """
    title = f'Class distribution — {it.label}'
    xs, ys, texts = [], [], []
    for c, cls in enumerate(it.classes, 1):
        res = cls['resolution']
        xs.append(f'Class {c}')
        ys.append(round(100 * (cls['distribution'] or 0), 2))
        texts.append(f'{res:0.2f} Å' if res and res < _NO_CHANGES else '')
    traces = [{'type': 'bar', 'x': xs, 'y': ys, 'customdata': texts,
               'hovertemplate': '%{x}: %{y}% (%{customdata})<extra></extra>'}]
    layout = {'yaxis': {'title': {'text': 'Particles (%)'}},
              'margin': _MARGIN, 'showlegend': False}
    return _plot(title, traces, layout)


def build_iteration_results_pane(root, data, it):
    """ Results of an iteration. Refine3D: its map on the left, the FSC and
    the SSNR on the right; Class3D: the SSNR and the distribution of the
    classes (their volumes with the 'classes' action). """
    if data.refine:
        return {'kind': 'grid', 'title': f'{it.label} — {os.path.basename(it.model)}',
                'layout': 'span-left',
                'cells': {'left': build_iteration_volumes_pane(root, data, it),
                          'topRight': _resolution_curve_plot(data, it, ssnr=False),
                          'bottomRight': _resolution_curve_plot(data, it, ssnr=True)}}
    return {'kind': 'grid', 'title': f'{it.label} — {os.path.basename(it.model)}',
            'layout': 'cols',
            'cells': {'left': _resolution_curve_plot(data, it, ssnr=True),
                      'right': _class_distribution_bars(it)}}


# ---------------------------- Volumes ------------------------------------

def _class_volume_cells(it):
    """ The class volumes of the iteration to show (Refine3D: the map, the
    half 1 map before the final iteration), most populated first:
    [(title, volume path)]. """
    classes = sorted(enumerate(it.classes, 1),
                     key=lambda c: -(c[1]['distribution'] or 0))
    cells = []
    for c, cls in classes[:MAX_CLASS_VOLUMES]:
        res = cls['resolution']
        res = f', {res:0.1f} Å' if res and res < 999 else ''
        cells.append((f'Class {c} — {100 * (cls["distribution"] or 0):0.1f}%{res}',
                      cls['volume']))
    return cells


def build_iteration_volumes_pane(root, data, it):
    """ VolumeViewer of the map (Refine3D) or a grid with the most populated
    class volumes (Class3D) of the iteration, re-using the viewer of the 3D
    classes (Classes3D outputs). """
    # Imported here: the viewers are in the blueprints, that import this package
    from emhub.blueprints.api_viewers import (build_volume_viewer_pane_content,
                                              MAP_VIEWER_CONFIG)
    from emhub.blueprints.api_viewers_spa import CLASS3D_MAX_VOXELS

    cells = _class_volume_cells(it)
    if not cells:
        raise Exception(f'No volumes in {it.model}')

    def _volume(title, volume, max_voxels):
        return build_volume_viewer_pane_content(
            root, volume, title=title, slices=False, density='inline',
            max_voxels=max_voxels, viewer_config=MAP_VIEWER_CONFIG)

    if data.refine:
        title, volume = cells[0]
        if not it.final:
            title = f'{it.label} — half 1 map'
        else:
            res = it.values.get('resolution')
            title = f'Final map — {res:0.2f} Å' if res else 'Final map'
        return _volume(title, volume, CLASS3D_MAX_VOXELS)

    if len(cells) == 1:
        return _volume(f'{it.label} — {cells[0][0]}', cells[0][1], CLASS3D_MAX_VOXELS)
    slots = ('topLeft', 'topRight', 'bottomLeft', 'bottomRight')
    max_voxels = CLASS3D_MAX_VOXELS // len(cells)
    return {'kind': 'grid', 'title': f'{it.label} — {len(cells)} most populated classes',
            'layout': '2x2' if len(cells) > 2 else 'cols',
            'cells': {slot: _volume(t, v, max_voxels)
                      for slot, (t, v) in zip(slots if len(cells) > 2 else ('left', 'right'),
                                              cells)}}


def build_iteration_pane(root, data, action_id, row_cells):
    if action_id == ACTION_OVERALL['id']:
        return build_overall_pane(data)
    it = data.get(row_cells.get('optimiser'))
    if action_id == ACTION_ITERATION['id']:
        return build_iteration_results_pane(root, data, it)
    if action_id == ACTION_VOLUMES['id']:
        return build_iteration_volumes_pane(root, data, it)
    raise Exception(f'Unknown action {action_id!r}')


# ---------------------------- Map series ---------------------------------
#
# A map of a Relion job (run_it025_class003.mrc, run_class001.mrc,
# run_it011_half1_class001.mrc, run_ct5_it030_class002.mrc when the job was
# continued) belongs to a series: the same class at every iteration of the
# job, the final map last. Each iteration has a model STAR file next to its
# maps (run_it025_model.star; run_it011_half1_model.star in Refine3D, whose
# iterations only have half maps; run_model.star for the final one) with its
# resolution (model_general), the share and resolution of each class
# (model_classes) and, for Refine3D, the gold-standard FSC (model_class_N;
# not computed in Class3D, so it is then left out). Reading a model file can
# be slow (a network file system: about a second each), so its values are
# kept in memory per file (path, modification time and size): a finished
# iteration never changes.

# The map of an iteration: prefix, continue number, iteration, half, class
_ITERATION_MAP = re.compile(
    r'^(?P<prefix>.+?)_(?:ct(?P<ct>\d+)_)?it(?P<it>\d+)_(?P<half>half[12]_)?class(?P<cls>\d+)\.mrc$')
# The final map of a job (no iteration)
_FINAL_MAP = re.compile(r'^(?P<prefix>.+?)_(?P<half>half[12]_)?class(?P<cls>\d+)\.mrc$')

_stats_cache = OrderedDict()
_stats_lock = threading.Lock()
_STATS_CACHE_SIZE = 2000


def _parse_map(name):
    """ (prefix, ct, iteration, half, class) of a map file name (iteration
    None for the final map), or None. """
    if m := _ITERATION_MAP.match(name):
        return m['prefix'], int(m['ct'] or 0), int(m['it']), m['half'] or '', int(m['cls'])
    if m := _FINAL_MAP.match(name):
        return m['prefix'], 0, None, m['half'] or '', int(m['cls'])
    return None


def _map_model_star(folder, prefix, ct, it, half):
    """ The model STAR file of the iteration of a map. """
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


def _resolution(value):
    """ A resolution in Å, None when not estimated yet (Relion writes inf or
    999 then). """
    return value if value and 0 < value < 999 else None


def _map_model_stats(model_star, class_id):
    """ Resolution, class share and resolution, and FSC of a class in a model
    STAR file (None values when missing); None without the file. Kept in
    memory per file. """
    try:
        st = os.stat(model_star)
    except OSError:
        return None
    key = (os.path.abspath(model_star), st.st_mtime, st.st_size, class_id)
    with _stats_lock:
        if key in _stats_cache:
            _stats_cache.move_to_end(key)
            return _stats_cache[key]
    stats = {'resolution': None, 'classDistribution': None,
             'classResolution': None, 'fsc': None}
    with StarFile(model_star) as sf:
        names = sf.getTableNames()
        if 'model_general' in names:
            g = sf.getTable('model_general', guessType=False)[0]._asdict()
            stats['resolution'] = _resolution(_float(g.get('rlnCurrentResolution')))
        if 'model_classes' in names:
            rows = sf.getTable('model_classes', guessType=False)
            if 0 < class_id <= len(rows):
                row = rows[class_id - 1]._asdict()
                stats['classDistribution'] = _float(row.get('rlnClassDistribution'))
                stats['classResolution'] = _resolution(_float(row.get('rlnEstimatedResolution')))
    try:
        curves = _class_curves(model_star, class_id, 'rlnGoldStandardFsc')
    except Exception:
        curves = []
    for c, xs, _, ys in curves:
        if c != class_id:
            continue
        pts = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
        # Class3D does not compute it (all the same value)
        if len(pts) > 2 and len({round(y, 6) for _, y in pts}) > 1:
            stats['fsc'] = {'resolution': [x for x, _ in pts], 'fsc': [y for _, y in pts]}
    with _stats_lock:
        _stats_cache[key] = stats
        while len(_stats_cache) > _STATS_CACHE_SIZE:
            _stats_cache.popitem(last=False)
    return stats


def is_relion_map(name):
    """ True for the file name of a map of a Relion iteration or job. """
    return _parse_map(name) is not None


def map_iterations(map_path):
    """ The series of the Relion map at map_path: every iteration of the
    same class (and half, for Refine3D: half 1 of the iterations, the full
    final map) in its folder, in order (continued runs after, the final map
    last), with the values of each model STAR. None if the file name is not
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
    series.sort(key=lambda s: (s[1] is None, s[0], s[1] or 0))
    items = []
    for ct, it, half, f in series:
        stats = _map_model_stats(_map_model_star(folder, prefix, ct, it, half), cls) or {}
        label = 'Final' if it is None else (f'Iteration {it}' + (f' (continue {ct})' if ct else ''))
        items.append(dict(stats, iteration=it, label=label, file=f))
    current = next((i for i, s in enumerate(series) if s[3] == name), len(items) - 1)
    return {'classId': cls, 'items': items, 'current': current}
