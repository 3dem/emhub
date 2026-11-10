"""Plots of STAR file columns for emflow's table viewer.

A table with one row per column (metric) and its statistics, whose rows show
the values of the column for all the items (e.g. the tilt images of all tilt
series, as in Relion's logfile.pdf) and their histogram:

    data = load_star_columns(root, star_path, [label for label, *_ in metrics])
    table = build_star_columns_table(data, metrics, action, title)
    pane = build_star_column_pane(data, label, name, unit)

metrics are (label, name, unit) tuples; only the labels present in the
STAR files get a row.
"""

import math
import os

import numpy as np

from emtools.metadata import StarFile

from . import project_file_path

TILT_SERIES_STAR_COL = 'rlnTomoTiltSeriesStarFile'
TILT_ANGLE_COL = 'rlnTomoNominalStageTiltAngle'


def _finite(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def round_value(v):
    """ Rounded for a table: 4 significant digits, at most 2 decimals for
    values >= 1. """
    if v is None or not math.isfinite(v):
        return ''
    if v == 0:
        return 0
    digits = max(0, 3 - int(math.floor(math.log10(abs(v)))))
    return round(v, min(digits, 2) if abs(v) >= 1 else digits)


def _read_rows(path):
    """ Column names and rows (dicts of strings) of the first table. """
    with StarFile(path) as sf:
        table_name = sf.getTableNames()[0]
        cols = sf.getTableInfo(table_name).getColumnNames()
        rows = [r._asdict() for r in sf.iterTable(table_name, guessType=False)]
    return cols, rows


class StarColumns:
    """ Values of some columns of the items of a STAR file, in file order,
    split in groups: the tilt series of a global tilt series STAR (items
    are the tilt images of the per tilt series STARs it points to), or a
    single group for a plain table (e.g. micrographs).

    groups: [(name, n_items)]; values: {label: [float or None]} (only the
    labels with some value); names / tilts: group name and tilt angle (or
    None) of each item. """

    def __init__(self):
        self.groups = []
        self.values = {}
        self.names = []
        self.tilts = []

    @property
    def size(self):
        return len(self.names)

    def _add(self, name, cols, rows, labels):
        for cells in rows:
            self.names.append(name)
            self.tilts.append(_finite(cells.get(TILT_ANGLE_COL)))
            for label in labels:
                # None for labels missing in a file: indexes stay aligned
                self.values[label].append(
                    _finite(cells.get(label)) if label in cols else None)
        self.groups.append((name, len(rows)))


def load_star_columns(root, star_path, labels):
    """ Load the columns (labels) of star_path (absolute, or relative to
    root), see StarColumns. """
    data = StarColumns()
    data.values = {label: [] for label in labels}
    cols, rows = _read_rows(project_file_path(root, star_path))

    if TILT_SERIES_STAR_COL in cols:
        for g in rows:
            ts_star = g.get(TILT_SERIES_STAR_COL)
            ts_path = project_file_path(root, ts_star) if ts_star else None
            if ts_path and os.path.exists(ts_path):
                ts_cols, ts_rows = _read_rows(ts_path)
                data._add(g.get('rlnTomoName', os.path.basename(ts_star)),
                          ts_cols, ts_rows, labels)
    else:
        data._add(os.path.splitext(os.path.basename(star_path))[0], cols, rows, labels)

    data.values = {k: v for k, v in data.values.items()
                   if any(x is not None for x in v)}
    return data


def histogram(values, max_bins=60):
    """ Bins of the values over a robust range (Tukey fences, 3 IQR beyond
    the quartiles, within min-max), the number of bins from the
    Freedman-Diaconis rule as in Relion's columnHistogram (at least
    sqrt(n)). The values out of
    that range are counted apart (below, above) instead of stretching the
    bins (e.g. one failed fit with a huge astigmatism). """
    v = np.asarray(values, dtype=float)
    q1, q3 = np.percentile(v, [25, 75])
    iqr = q3 - q1
    vmin, vmax = float(v.min()), float(v.max())
    lo, hi = (max(vmin, q1 - 3 * iqr), min(vmax, q3 + 3 * iqr)) if iqr > 0 else (vmin, vmax)
    if hi <= lo:
        lo, hi = lo - 0.5, hi + 0.5
    inside = v[(v >= lo) & (v <= hi)]
    if iqr > 0:
        width = 2 * iqr / len(v) ** (1 / 3)
        # At least sqrt(n) bins: Freedman-Diaconis gives too few for
        # multimodal values (e.g. a defocus per tilt series)
        nbins = int(min(max_bins, max(5, math.ceil(math.sqrt(len(v))),
                                      math.ceil((hi - lo) / width))))
    else:
        nbins = 1
    counts, edges = np.histogram(inside, bins=nbins, range=(lo, hi))
    return {
        'centers': ((edges[:-1] + edges[1:]) / 2).tolist(),
        'width': float(edges[1] - edges[0]),
        'counts': counts.tolist(),
        'below': int((v < lo).sum()),
        'above': int((v > hi).sum()),
        'lo': lo,
        'hi': hi,
    }


def _axis_title(name, unit):
    return f'{name} ({unit})' if unit else name


def build_star_columns_table(data, metrics, action, title, item_label='items'):
    """ TableViewerData with a row per metric (label, name, unit) present in
    data and its statistics; clicking a row (and opening the table, for the
    first row) runs action ({id, label}) with the row cells, whose
    'metric' is the label. """
    rows = []
    for label, name, unit in metrics:
        if label not in data.values:
            continue
        v = np.array([x for x in data.values[label] if x is not None], dtype=float)
        rows.append({
            'id': label,
            'cells': {
                'name': _axis_title(name, unit),
                'metric': label,
                'count': int(v.size),
                'min': round_value(float(v.min())),
                'mean': round_value(float(v.mean())),
                'median': round_value(float(np.median(v))),
                'max': round_value(float(v.max())),
                'std': round_value(float(v.std())),
            },
            'actions': [],
            'defaultAction': dict(action),
        })
    groups = (f'{len(data.groups)} tilt series, ' if len(data.groups) > 1 else '')
    table = {
        'title': f'{title} ({groups}{data.size} {item_label})',
        'columns': [
            {'id': 'name', 'label': 'Metric', 'align': 'left'},
            {'id': 'metric', 'label': 'Label', 'align': 'left'},
            {'id': 'count', 'label': 'N', 'align': 'right'},
            {'id': 'min', 'label': 'Min', 'align': 'right', 'sortable': True},
            {'id': 'mean', 'label': 'Mean', 'align': 'right', 'sortable': True},
            {'id': 'median', 'label': 'Median', 'align': 'right', 'sortable': True},
            {'id': 'max', 'label': 'Max', 'align': 'right', 'sortable': True},
            {'id': 'std', 'label': 'Std', 'align': 'right', 'sortable': True},
        ],
        'rows': rows,
    }
    if rows:
        table['initialAction'] = {'rowId': rows[0]['id'], 'actionId': action['id']}
    return table


def build_star_column_pane(data, label, name, unit='', item_label='items'):
    """ A 'cols' grid: the values of the column for all items (one trace
    per group, hover with the group and tilt angle) and their histogram. """
    values = data.values.get(label)
    if not values:
        raise Exception(f'No values of {label}')
    axis = _axis_title(name, unit)

    traces = []
    index = 0
    for group, n in data.groups:
        xs, ys, texts = [], [], []
        for i in range(index, index + n):
            if values[i] is not None:
                xs.append(i + 1)
                ys.append(values[i])
                tilt = data.tilts[i]
                texts.append(f'{group}, tilt {tilt:g}°' if tilt is not None else group)
        index += n
        traces.append({
            'type': 'scatter', 'mode': 'lines+markers', 'name': group,
            'x': xs, 'y': ys, 'text': texts,
            'hovertemplate': '%{text}<br>#%{x}: %{y}<extra></extra>',
            'marker': {'size': 5}, 'line': {'width': 1},
        })
    # Same robust range as the histogram: outliers would squash the others
    # (Plotly's autoscale shows them)
    h = histogram([v for v in values if v is not None])
    n_out = h['below'] + h['above']
    yaxis = {'title': {'text': axis}}
    if n_out:
        pad = 0.05 * (h['hi'] - h['lo'])
        yaxis['range'] = [h['lo'] - pad, h['hi'] + pad]
    plot = {
        'kind': 'plotly',
        'title': f'{label} for all {item_label}'
                 + (f' ({n_out} off scale)' if n_out else ''),
        'figure': {
            'data': traces,
            'layout': {
                'xaxis': {'title': {'text': item_label.capitalize()}},
                'yaxis': yaxis,
                'margin': {'l': 72, 'r': 16, 't': 24, 'b': 56},
                'showlegend': 1 < len(data.groups) <= 20,
                'legend': {'orientation': 'h', 'y': -0.2},
            },
        },
    }

    notes = []
    if h['below']:
        notes.append(f"{h['below']} below {round_value(h['lo'])}")
    if h['above']:
        notes.append(f"{h['above']} above {round_value(h['hi'])}")
    title = f'Histogram of {label}'
    if notes:
        title += f" (not shown: {', '.join(notes)})"
    hist = {
        'kind': 'plotly',
        'title': title,
        'figure': {
            'data': [{
                'type': 'bar', 'x': h['centers'], 'y': h['counts'],
                'width': h['width'], 'name': name,
                'hovertemplate': '%{x}: %{y}<extra></extra>',
            }],
            'layout': {
                'xaxis': {'title': {'text': axis}},
                'yaxis': {'title': {'text': item_label.capitalize()}},
                'margin': {'l': 64, 'r': 16, 't': 24, 'b': 56},
                'bargap': 0.05,
                'showlegend': False,
            },
        },
    }
    return {'kind': 'grid', 'title': f'{name} ({label})', 'layout': 'cols',
            'cells': {'left': plot, 'right': hist}}
