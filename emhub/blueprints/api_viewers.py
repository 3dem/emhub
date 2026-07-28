# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *              Grigory Sharov (gsharov@mrc-lmb.cam.ac.uk) [2]
# *
# * [1] SciLifeLab, Stockholm University
# * [2] MRC Laboratory of Molecular Biology (MRC-LMB)
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# * This program is distributed in the hope that it will be useful,
# * but WITHOUT ANY WARRANTY; without even the implied warranty of
# * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# * GNU General Public License for more details.
# *
# * You should have received a copy of the GNU General Public License
# * along with this program; if not, write to the Free Software
# * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA
# * 02111-1307  USA
# *
# *  All comments concerning this program package may be sent to the
# *  e-mail address 'delarosatrevin@scilifelab.se'
# *
# **************************************************************************
"""Helpers for table-viewer panes and Plotly plot content in the REST API."""

import os

from emtools.metadata import StarFile
from emtools.utils import Path


TABLE_VIEW_SPECS = {
    'tiltseriesmovies': {
        'title': 'Tilt series movies',
        'columns': [
            {'id': 'tomoName', 'label': 'Tomo name', 'align': 'left'},
            {'id': 'starFile', 'label': 'Tilt series STAR', 'align': 'left'},
            {'id': 'pixelSize', 'label': 'Pixel size (Å/px)', 'align': 'right'},
        ],
        'cell_fields': {
            'tomoName': 'rlnTomoName',
            'starFile': 'rlnTomoTiltSeriesStarFile',
            'pixelSize': 'rlnMicrographOriginalPixelSize',
        },
        'actions': [
            {'id': 'metadata', 'label': 'metadata'},
            {'id': 'tilt-angles', 'label': 'tilt angles'},
        ],
    },
    'tiltseries': {
        'title': 'Tilt series',
        'columns': [
            {'id': 'tomoName', 'label': 'Tomo name', 'align': 'left'},
            {'id': 'pixelSize', 'label': 'Pixel size (Å/px)', 'align': 'right'},
            {'id': 'tsPixelSize', 'label': 'TS pixel size (Å/px)', 'align': 'right'},
        ],
        'cell_fields': {
            'tomoName': 'rlnTomoName',
            'starFile': 'rlnTomoTiltSeriesStarFile',
            'pixelSize': 'rlnMicrographOriginalPixelSize',
            'tsPixelSize': 'rlnTomoTiltSeriesPixelSize',
        },
        'actions': [
            {'id': 'metadata', 'label': 'metadata'},
            {'id': 'tilt-angles', 'label': 'tilt angles'},
            {'id': 'motion', 'label': 'motion'},
        ],
    },
}


TABLE_VIEW_OPTIONAL_ACTIONS = {
    'tiltseries': [
        {
            'id': 'defocus',
            'label': 'defocus',
            'requires_columns': [
                'rlnTomoNominalStageTiltAngle',
                'rlnDefocusU',
                'rlnDefocusV',
            ],
        },
    ],
}


TILT_ANGLE_X_COL = 'rlnTomoNominalStageTiltAngle'


def _table_view_row_cells(spec, star_cells):
    return {
        cell_id: star_cells.get(star_col, '')
        for cell_id, star_col in spec['cell_fields'].items()
    }


def _normalize_table_view_type(pointer_class):
    key = (pointer_class or '').replace(' ', '').lower()
    if key in TABLE_VIEW_SPECS:
        return key
    return None


def resolve_table_view_type(pointer_class, star_path):
    type_key = _normalize_table_view_type(pointer_class)
    if type_key:
        return type_key
    if '_series' in os.path.basename(star_path or ''):
        return 'tiltseriesmovies'
    return None


def _table_view_valid_actions(type_key):
    return {action['id'] for action in TABLE_VIEW_SPECS[type_key]['actions']}


def _resolve_series_star_table_name(sf):
    table_names = sf.getTableNames()
    if not table_names:
        return None
    for name in table_names:
        if name != 'global':
            return name
    return table_names[0]


def _series_star_column_names(full_path):
    with StarFile(full_path) as sf:
        table_name = _resolve_series_star_table_name(sf)
        if not table_name:
            return set()
        return set(sf.getTableInfo(table_name).getColumnNames())


def _optional_actions_for_series(type_key, series_star_path):
    actions = []
    if not series_star_path or not os.path.exists(series_star_path):
        return actions

    col_names = _series_star_column_names(series_star_path)
    for action in TABLE_VIEW_OPTIONAL_ACTIONS.get(type_key, []):
        required = action.get('requires_columns', [])
        if all(col in col_names for col in required):
            actions.append({'id': action['id'], 'label': action['label']})
    return actions


def action_allowed_for_series(type_key, action_id, series_star_path):
    if action_id in _table_view_valid_actions(type_key):
        return True
    if not series_star_path or not os.path.exists(series_star_path):
        return False

    col_names = _series_star_column_names(series_star_path)
    for action in TABLE_VIEW_OPTIONAL_ACTIONS.get(type_key, []):
        if action['id'] != action_id:
            continue
        required = action.get('requires_columns', [])
        return all(col in col_names for col in required)
    return False


def _table_view_row_actions(spec, type_key, row_cells, root=None):
    actions = list(spec['actions'])
    star_rel = row_cells.get('starFile')
    if root and star_rel and type_key in TABLE_VIEW_OPTIONAL_ACTIONS:
        actions.extend(
            _optional_actions_for_series(type_key, os.path.join(root, star_rel))
        )
    return actions


def build_global_tilt_series_table(full_path, type_key, root=None):
    """Build TableViewerPane rows from a global tilt-series STAR file."""
    spec = TABLE_VIEW_SPECS[type_key]
    with StarFile(full_path) as sf:
        table_names = sf.getTableNames()
        if not table_names:
            return {'columns': [], 'rows': [], 'title': spec['title']}

        table_name = 'global' if 'global' in table_names else table_names[0]
        columns = list(spec['columns'])

        rows = []
        for idx, row in enumerate(sf.iterTable(table_name, guessType=False)):
            star_cells = row._asdict()
            row_cells = _table_view_row_cells(spec, star_cells)
            tomo_name = row_cells.get('tomoName', '')

            rows.append({
                'id': tomo_name or idx,
                'cells': row_cells,
                'actions': _table_view_row_actions(spec, type_key, row_cells, root),
            })

        return {
            'title': f"{spec['title']} ({len(rows)} items)",
            'columns': columns,
            'rows': rows,
        }


def _collect_series_points_by_tilt(full_path, value_columns):
    """Return rows sorted by nominal stage tilt angle with parsed numeric values."""
    with StarFile(full_path) as sf:
        table_name = _resolve_series_star_table_name(sf)
        if not table_name:
            raise Exception('STAR file has no tables')

        col_names = sf.getTableInfo(table_name).getColumnNames()
        if TILT_ANGLE_X_COL not in col_names:
            raise Exception(f'STAR file is missing column {TILT_ANGLE_X_COL}')

        missing = [col for col in value_columns if col not in col_names]
        if missing:
            raise Exception(f'STAR file is missing columns: {", ".join(missing)}')

        points = []
        for row in sf.iterTable(table_name, guessType=False):
            cells = row._asdict()
            try:
                x_val = float(cells.get(TILT_ANGLE_X_COL))
            except (TypeError, ValueError):
                continue

            values = {}
            valid = True
            for col in value_columns:
                try:
                    values[col] = float(cells.get(col))
                except (TypeError, ValueError):
                    valid = False
                    break
            if valid:
                points.append((x_val, values))

    if not points:
        raise Exception('No tilt-angle values found in STAR file')

    points.sort(key=lambda item: item[0])
    return points


def _build_plotly_scatter_figure(traces, xaxis_title, yaxis_title, show_legend=False):
    return {
        'data': traces,
        'layout': {
            'xaxis': {'title': {'text': xaxis_title}},
            'yaxis': {'title': {'text': yaxis_title}},
            'margin': {'l': 72, 'r': 16, 't': 36, 'b': 56},
            'showlegend': show_legend,
        },
    }


def build_tilt_angles_plot_content(full_path, title=None):
    """Plot pre-exposure vs nominal stage tilt angle from a per-series STAR file."""
    y_col = 'rlnMicrographPreExposure'
    points = _collect_series_points_by_tilt(full_path, [y_col])
    xs = [p[0] for p in points]
    ys = [p[1][y_col] for p in points]
    basename = os.path.basename(full_path)

    return {
        'kind': 'plotly',
        'title': title or f'Tilt angles — {basename}',
        'figure': _build_plotly_scatter_figure(
            [{
                'type': 'scatter',
                'mode': 'lines+markers',
                'x': xs,
                'y': ys,
                'marker': {'size': 7},
                'line': {'width': 1.5},
                'name': 'Pre-exposure',
            }],
            xaxis_title='Nominal stage tilt angle (°)',
            yaxis_title='Pre-exposure (e-/Å²)',
        ),
    }


def build_defocus_plot_content(full_path, title=None):
    """Plot defocus U/V vs nominal stage tilt angle from a per-series STAR file."""
    defocus_series = [
        ('rlnDefocusU', 'Defocus U'),
        ('rlnDefocusV', 'Defocus V'),
    ]
    value_columns = [col for col, _ in defocus_series]
    points = _collect_series_points_by_tilt(full_path, value_columns)
    xs = [p[0] for p in points]
    traces = []
    for col, label in defocus_series:
        traces.append({
            'type': 'scatter',
            'mode': 'lines+markers',
            'x': xs,
            'y': [p[1][col] for p in points],
            'marker': {'size': 7},
            'line': {'width': 1.5},
            'name': label,
        })

    basename = os.path.basename(full_path)
    return {
        'kind': 'plotly',
        'title': title or f'Defocus — {basename}',
        'figure': _build_plotly_scatter_figure(
            traces,
            xaxis_title='Nominal stage tilt angle (°)',
            yaxis_title='Defocus (Å)',
            show_legend=True,
        ),
    }


def build_motion_plot_content(full_path, title=None):
    """Plot accumulated motion vs nominal stage tilt angle from a per-series STAR file."""
    motion_series = [
        ('rlnAccumMotionTotal', 'Total'),
        ('rlnAccumMotionEarly', 'Early'),
        ('rlnAccumMotionLate', 'Late'),
    ]

    with StarFile(full_path) as sf:
        table_name = _resolve_series_star_table_name(sf)
        if not table_name:
            raise Exception('STAR file has no tables')

        col_names = sf.getTableInfo(table_name).getColumnNames()
        available_motion = [
            (col, label) for col, label in motion_series if col in col_names
        ]
        if not available_motion:
            raise Exception('STAR file has no accumulated motion columns')

    value_columns = [col for col, _ in available_motion]
    points = _collect_series_points_by_tilt(full_path, value_columns)
    xs = [p[0] for p in points]
    traces = []
    for col, label in available_motion:
        traces.append({
            'type': 'scatter',
            'mode': 'lines+markers',
            'x': xs,
            'y': [p[1][col] for p in points],
            'marker': {'size': 7},
            'line': {'width': 1.5},
            'name': label,
        })

    basename = os.path.basename(full_path)
    return {
        'kind': 'plotly',
        'title': title or f'Motion — {basename}',
        'figure': _build_plotly_scatter_figure(
            traces,
            xaxis_title='Nominal stage tilt angle (°)',
            yaxis_title='Accumulated motion (Å)',
            show_legend=len(traces) > 1,
        ),
    }


def build_metadata_pane_content(star_rel, full_path):
    """Return text pane content for a STAR file metadata preview."""
    title_base = os.path.basename(star_rel)
    info = {
        'kind': 'none',
        'mime': 'text/plain',
        'meta': {'name': star_rel},
        'truncated': False,
        'note': 'Cannot preview this file type.',
    }
    if Path.isText(star_rel):
        with open(full_path) as f:
            info.update({
                'text': f.read(),
                'mime': 'text/plain',
                'kind': 'text',
            })
    if info.get('kind') != 'text':
        note = info.get('note') or info.get('error') or 'Could not load STAR file preview.'
        return {'kind': 'empty', 'message': note, 'title': title_base}

    return {
        'kind': 'text',
        'title': title_base,
        'text': info['text'],
    }
