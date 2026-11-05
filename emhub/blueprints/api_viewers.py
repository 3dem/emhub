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
import contextlib

import flask

from emtools.metadata import StarFile, RelionStar
from emtools.utils import Path

from emhub.data.processing import (get_processing_project, resolve_project_root,
                                   project_file_path)


# --- Shared table column / field / action definitions ---

# 'sortable' columns can be sorted (over the loaded rows) in the TableViewer
_TOMO_NAME_COL = {'id': 'tomoName', 'label': 'Tomo name', 'align': 'left',
                  'sortable': True}
_STAR_FILE_COL = {'id': 'starFile', 'label': 'Metadata', 'align': 'left'}
_PIXEL_SIZE_COL = {'id': 'pixelSize', 'label': 'Pixel size (Å/px)', 'align': 'right'}
_TS_PIXEL_SIZE_COL = {'id': 'tsPixelSize', 'label': 'TS pixel size (Å/px)', 'align': 'right'}
_ALIGNED_STACK_COL = {'id': 'alignedStack', 'label': 'Aligned stack', 'align': 'left'}
_TOMOGRAM_COL = {'id': 'tomogram', 'label': 'Tomogram', 'align': 'left'}
_NCOORDS_COL = {'id': 'nCoords', 'label': 'Coordinates', 'align': 'right',
                'sortable': True}
_TS_TOMO_COL = {'id': 'tsTomo', 'label': 'TS / Tomogram', 'align': 'left', 'width': 110}

_TILT_SERIES_GLOBAL_CELL_FIELDS = {
    'tomoName': 'rlnTomoName',
    'starFile': 'rlnTomoTiltSeriesStarFile',
    'pixelSize': 'rlnMicrographOriginalPixelSize',
}
_TS_PIXEL_SIZE_FIELD = {'tsPixelSize': 'rlnTomoTiltSeriesPixelSize'}
_ALIGNED_STACK_FIELD = {'alignedStack': 'rlnTiltSeriesAligned'}
_TOMOGRAM_FIELD = {'tomogram': 'rlnTomoReconstructedTomogram'}

_ACTION_METADATA = {'id': 'metadata', 'label': 'metadata', 'column': 'starFile'}
_ACTION_TILT_ANGLES = {'id': 'tilt-angles', 'label': 'tilt angles'}
_ACTION_MOTION = {'id': 'motion', 'label': 'motion'}
_ACTION_ALIGNED_SLICES = {'id': 'aligned-slices', 'label': 'slices', 'column': 'alignedStack'}
_ACTION_VOLUME_SLICES = {'id': 'volume-slices', 'label': 'slices', 'column': 'tomogram'}
# Icon actions of the 'TS / Tomogram' column, set per row in cellContexts
# (the tomogram one only for rows with a tomogram)
_ACTION_TS_VIEW = {'id': 'ts-view', 'label': 'Tilt series', 'icon': 'tilt-series',
                   'column': 'tsTomo', 'per_row': True}
_ACTION_TOMO_VIEW = {'id': 'tomo-view', 'label': 'Tomogram', 'icon': 'tomogram',
                     'column': 'tsTomo', 'per_row': True, 'requires_cell': 'tomogramPath'}

_TILT_SERIES_STAR_OPTIONAL_ACTIONS = [
    {
        'id': 'defocus',
        'label': 'defocus',
        'requires_columns': [
            'rlnTomoNominalStageTiltAngle',
            'rlnDefocusU',
            'rlnDefocusV',
        ],
    },
    {
        'id': 'slices',
        'label': 'slices',
        'requires_any_columns': [
            'rlnTomoReconstructedTomogram',
            'rlnTomoReconstructedTomogramDenoised',
        ],
    },
]

_TILT_SERIES_TYPES_WITH_OPTIONAL = frozenset({
    'tiltseries',
    'tiltseriesaligned',
    'tomograms',
    'tomocoordinates',
})

# Display cell id -> row cell key holding the project-relative path.
_TABLE_PATH_CELL_FIELDS = {
    'starFile': 'starFilePath',
    'alignedStack': 'alignedStackPath',
    'tomogram': 'tomogramPath',
}

_TOMOGRAM_PATH_COLUMNS = (
    'rlnTomoReconstructedTomogram',
    'rlnTomoReconstructedTomogramDenoised',
)


def _format_tomo_pixel_size(star_cells):
    """Return tomogram pixel size (Å/px) from TS pixel size and binning."""
    try:
        ts_ps = float(star_cells.get('rlnTomoTiltSeriesPixelSize') or 0)
        binning = float(star_cells.get('rlnTomoTomogramBinning') or 1)
        if ts_ps:
            return f'{ts_ps * binning:.3f}'
    except (TypeError, ValueError):
        pass
    return star_cells.get('rlnMicrographOriginalPixelSize', '')


def _tilt_series_table_spec(
    title,
    *,
    with_ts_pixel_size=False,
    with_aligned_stack=False,
    with_tomogram=False,
    with_ts_tomo=False,
    computed_cell_fields=None,
):
    """Build a table-view spec for global tilt-series / tomogram STAR outputs."""
    columns = [_TOMO_NAME_COL, _STAR_FILE_COL]
    cell_fields = dict(_TILT_SERIES_GLOBAL_CELL_FIELDS)
    actions = [_ACTION_METADATA]

    if with_ts_tomo:
        actions.append(_ACTION_TS_VIEW)
        if with_tomogram:
            actions.append(_ACTION_TOMO_VIEW)

    if with_tomogram:
        columns.append(_TOMOGRAM_COL)
        cell_fields.update(_TOMOGRAM_FIELD)
        actions.append(_ACTION_VOLUME_SLICES)

    if with_aligned_stack:
        columns.append(_ALIGNED_STACK_COL)
        cell_fields.update(_ALIGNED_STACK_FIELD)
        actions.append(_ACTION_ALIGNED_SLICES)

    columns.append(_PIXEL_SIZE_COL)
    if with_ts_pixel_size or with_aligned_stack or with_tomogram:
        columns.append(_TS_PIXEL_SIZE_COL)
        cell_fields.update(_TS_PIXEL_SIZE_FIELD)

    actions.extend([_ACTION_TILT_ANGLES, _ACTION_MOTION])

    spec = {
        'title': title,
        'columns': columns,
        'cell_fields': cell_fields,
        'actions': actions,
    }
    if computed_cell_fields:
        spec['computed_cell_fields'] = computed_cell_fields
    if with_ts_tomo:
        # The stack, tomogram and pixel size cells are still read (for the
        # icon actions), but only shown through the 'TS / Tomogram' icons;
        # the plots are in the tilt series grid, so no row actions
        spec['columns'] = [_TOMO_NAME_COL, _STAR_FILE_COL, _TS_TOMO_COL]
        spec['hide_row_actions'] = True
    return spec


def _tomocoordinates_table_spec():
    """Table spec for optimisation_set.star (tomograms + particles coordinates),
    as the Tomograms one plus the number of coordinates; its tomogram icon
    shows the coordinates on the slices."""
    spec = _tilt_series_table_spec(
        'Tomo coordinates',
        with_ts_pixel_size=True,
        with_aligned_stack=True,
        with_tomogram=True,
        with_ts_tomo=True,
        computed_cell_fields={'pixelSize': _format_tomo_pixel_size},
    )
    spec['columns'].insert(2, _NCOORDS_COL)
    return spec


TABLE_VIEW_SPECS = {
    'tiltseriesmovies': {
        'title': 'Tilt series movies',
        'columns': [
            _TOMO_NAME_COL,
            _STAR_FILE_COL,
            _PIXEL_SIZE_COL,
        ],
        'cell_fields': dict(_TILT_SERIES_GLOBAL_CELL_FIELDS),
        'actions': [
            _ACTION_METADATA,
            _ACTION_TILT_ANGLES,
        ],
    },
    'tiltseries': _tilt_series_table_spec(
        'Tilt series',
        with_ts_pixel_size=True,
        with_ts_tomo=True,
    ),
    'tiltseriesaligned': _tilt_series_table_spec(
        'Aligned tilt series',
        with_ts_pixel_size=True,
        with_aligned_stack=True,
        with_ts_tomo=True,
    ),
    'tomograms': _tilt_series_table_spec(
        'Tomograms',
        with_ts_pixel_size=True,
        with_aligned_stack=True,
        with_tomogram=True,
        with_ts_tomo=True,
        computed_cell_fields={'pixelSize': _format_tomo_pixel_size},
    ),
    'tomocoordinates': _tomocoordinates_table_spec(),
}


TABLE_VIEW_OPTIONAL_ACTIONS = {
    'tiltseries': _TILT_SERIES_STAR_OPTIONAL_ACTIONS,
    'tiltseriesaligned': _TILT_SERIES_STAR_OPTIONAL_ACTIONS,
    'tomograms': _TILT_SERIES_STAR_OPTIONAL_ACTIONS,
    'tomocoordinates': _TILT_SERIES_STAR_OPTIONAL_ACTIONS,
}


TILT_ANGLE_X_COL = 'rlnTomoNominalStageTiltAngle'


def _table_view_row_cells(spec, star_cells):
    row_cells = {}
    for cell_id, star_col in spec['cell_fields'].items():
        value = star_cells.get(star_col, '')
        if cell_id == 'tomogram' and not value:
            for col in _TOMOGRAM_PATH_COLUMNS:
                if star_cells.get(col):
                    value = star_cells.get(col)
                    break
        path_key = _TABLE_PATH_CELL_FIELDS.get(cell_id)
        if path_key:
            row_cells[path_key] = value
            row_cells[cell_id] = os.path.basename(value) if value else ''
        else:
            row_cells[cell_id] = value
    for cell_id, compute in spec.get('computed_cell_fields', {}).items():
        row_cells[cell_id] = compute(star_cells)
    return row_cells


def _normalize_table_view_type(pointer_class):
    key = (pointer_class or '').replace(' ', '').lower()
    if key in TABLE_VIEW_SPECS:
        return key
    return None


def resolve_table_view_type(pointer_class, star_path):
    type_key = _normalize_table_view_type(pointer_class)
    if type_key:
        return type_key
    if star_path and os.path.isfile(star_path):
        if RelionStar.isTomoOptimisationSet(star_path):
            return 'tomocoordinates'
    basename = os.path.basename(star_path or '').lower()
    if basename == 'tomograms.star':
        return 'tomograms'
    if 'aln' in basename or 'aligned' in basename:
        return 'tiltseriesaligned'
    if '_series' in basename:
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
        col_names = set()
        for table_name in sf.getTableNames():
            col_names.update(sf.getTableInfo(table_name).getColumnNames())
        return col_names


def _optional_action_matches(action, col_names):
    required = action.get('requires_columns', [])
    if required and not all(col in col_names for col in required):
        return False
    required_any = action.get('requires_any_columns', [])
    if required_any and not any(col in col_names for col in required_any):
        return False
    return bool(required or required_any)


def _optional_actions_for_series(type_key, series_star_path):
    actions = []
    if not series_star_path or not os.path.exists(series_star_path):
        return actions

    col_names = _series_star_column_names(series_star_path)
    for action in TABLE_VIEW_OPTIONAL_ACTIONS.get(type_key, []):
        if _optional_action_matches(action, col_names):
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
        return _optional_action_matches(action, col_names)
    return False


def _table_view_action_payload(action):
    payload = {'id': action['id'], 'label': action['label']}
    if action.get('icon'):
        payload['icon'] = action['icon']
    return payload


def _table_view_column_actions(spec):
    """Attach static column-bound actions to column definitions."""
    columns = []
    for col in spec['columns']:
        col_def = dict(col)
        col_actions = [
            _table_view_action_payload(action)
            for action in spec['actions']
            if action.get('column') == col['id'] and not action.get('per_row')
        ]
        if col_actions:
            col_def['actions'] = col_actions
        columns.append(col_def)
    return columns


def _table_view_row_actions(spec, type_key, row_cells, root=None):
    """Return row-level actions (those not bound to a column)."""
    actions = [
        _table_view_action_payload(action)
        for action in spec['actions']
        if not action.get('column')
    ]
    star_rel = row_cells.get('starFilePath') or row_cells.get('starFile')
    if root and star_rel and type_key in _TILT_SERIES_TYPES_WITH_OPTIONAL:
        actions.extend(
            _optional_actions_for_series(
                type_key,
                project_file_path(root, star_rel))
        )
    return actions


def _table_view_cell_contexts(spec, row_cells):
    """Return the row cellContexts with the per-row column actions."""
    contexts = {}
    for action in spec['actions']:
        if not action.get('per_row'):
            continue
        required = action.get('requires_cell')
        if required and not row_cells.get(required):
            continue
        cell_context = contexts.setdefault(action['column'], {'actions': []})
        cell_context['actions'].append(_table_view_action_payload(action))
    return contexts


def _table_view_row(spec, type_key, row_id, row_cells, root=None):
    actions = ([] if spec.get('hide_row_actions')
               else _table_view_row_actions(spec, type_key, row_cells, root))
    cell_contexts = _table_view_cell_contexts(spec, row_cells)
    row = {'id': row_id, 'cells': row_cells, 'actions': actions}
    if cell_contexts:
        row['cellContexts'] = cell_contexts
    return row


def build_global_tilt_series_table(full_path, type_key, root=None):
    """Build TableViewerPane rows from a global tilt-series STAR file."""
    spec = TABLE_VIEW_SPECS[type_key]
    with StarFile(full_path) as sf:
        table_names = sf.getTableNames()
        if not table_names:
            return {'columns': [], 'rows': [], 'title': spec['title']}

        table_name = 'global' if 'global' in table_names else table_names[0]
        columns = _table_view_column_actions(spec)

        rows = []
        for idx, row in enumerate(sf.iterTable(table_name, guessType=False)):
            star_cells = row._asdict()
            row_cells = _table_view_row_cells(spec, star_cells)
            tomo_name = row_cells.get('tomoName', '')

            rows.append(_table_view_row(spec, type_key, tomo_name or idx,
                                        row_cells, root))

        return {
            'title': f"{spec['title']} ({len(rows)} items)",
            'columns': columns,
            'rows': rows,
        }


def build_tomocoordinates_table(optimisation_set_path, root=None):
    """Build table rows from optimisation_set.star via linked tomograms/particles."""
    from emhub.data import coords3d as coords3d_mod

    paths = coords3d_mod.resolve_coords_set(root, optimisation_set_path)
    if not paths.get('tomograms_star'):
        raise Exception(
            f'{optimisation_set_path} does not link to a tomograms.star file'
        )

    type_key = 'tomocoordinates'
    spec = TABLE_VIEW_SPECS[type_key]
    particles_table = coords3d_mod._load_particles_table(paths['particles_star'])

    with StarFile(paths['tomograms_star']) as sf:
        table_names = sf.getTableNames()
        if not table_names:
            return {'columns': [], 'rows': [], 'title': spec['title']}

        table_name = 'global' if 'global' in table_names else table_names[0]
        columns = _table_view_column_actions(spec)

        rows = []
        for idx, row in enumerate(sf.iterTable(table_name, guessType=False)):
            star_cells = row._asdict()
            row_cells = _table_view_row_cells(spec, star_cells)
            tomo_name = row_cells.get('tomoName', '')
            row_cells['nCoords'] = coords3d_mod._count_particles_for_tomo(
                particles_table,
                tomo_name,
            )

            rows.append(_table_view_row(spec, type_key, tomo_name or idx,
                                        row_cells, root))

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
    """Plot the dose (pre-exposure) vs nominal stage tilt angle from a per-series STAR file."""
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
                'name': 'Dose',
            }],
            xaxis_title='Nominal stage tilt angle (°)',
            yaxis_title='Dose (e-/Å²)',
        ),
    }


def build_defocus_plot_content(full_path, title=None):
    """Plot defocus U/V (µm) vs nominal stage tilt angle from a per-series STAR file."""
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
            'y': [p[1][col] / 10000 for p in points],  # Å -> µm
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
            yaxis_title='Defocus (µm)',
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
    title = star_rel
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
        return {'kind': 'empty', 'message': note, 'title': title}

    return {
        'kind': 'text',
        'title': title,
        'text': info['text'],
    }


TOMOGRAM_COLUMNS = (
    'rlnTomoReconstructedTomogram',
    'rlnTomoReconstructedTomogramDenoised',
)


def _find_tomogram_row(full_path):
    """Return the first STAR row that references a reconstructed tomogram."""
    with StarFile(full_path) as sf:
        for table_name in sf.getTableNames():
            for row in sf.iterTable(table_name, guessType=False):
                cells = row._asdict()
                if any(cells.get(col) for col in TOMOGRAM_COLUMNS):
                    return cells
    return None


def _resolve_data_path(root, rel_path):
    """ Full path of a file referenced in a row (relative to the project
    root or absolute), that must be inside the project (see project_file_path). """
    if not rel_path:
        return None
    return project_file_path(root, rel_path)


def _resolve_tomogram_path(root, row_cells):
    for col in TOMOGRAM_COLUMNS:
        rel = row_cells.get(col)
        if not rel:
            continue
        full_path = _resolve_data_path(root, rel)
        if full_path and os.path.exists(full_path):
            return full_path, rel
    return None, None


def _volume_axis_slices(
    volume_data,
    axis,
    slice_number,
    slice_dim,
    prefix=None,
    *,
    all_slices=False,
    full_range=False,
    upright=False,
    step=None,
):
    """ Thumbnails of slices along one axis, keyed by slice index.

    By default slice_number slices are taken from the middle half of the
    axis. full_range spreads them over the whole axis instead, first and
    last slice included.  step takes every step-th slice of the whole axis
    instead.  upright turns X slices from (Z, Y) to (Y, Z), so they line up
    with the rows of a Z slice in an orthogonal view.
    """
    import mrcfile
    import numpy as np
    from emtools.image import Thumbnail

    # volume_data is a path, or an open MRC to read several axes from one load
    opened = (mrcfile.open(volume_data, permissive=True)
              if isinstance(volume_data, (str, os.PathLike))
              else contextlib.nullcontext(volume_data))
    with opened as mrc:
        zdim, ydim, xdim = mrc.data.shape
        vol_thumb = Thumbnail(
            max_size=(slice_dim, slice_dim),
            output_format='base64',
            contrast_factor=1.5,
        )

        if axis == 'x':
            dim = xdim
            getter = ((lambda i: mrc.data[:, :, i].T) if upright
                      else (lambda i: mrc.data[:, :, i]))
            prefix = prefix or 'X slice: '
        elif axis == 'y':
            dim = ydim
            getter = lambda i: mrc.data[:, i, :]
            prefix = prefix or 'Y slice: '
        else:
            dim = zdim
            getter = lambda i: mrc.data[i, :, :]
            prefix = prefix or 'Z slice: '

        if all_slices:
            indices = list(range(dim))
        elif step:
            indices = list(range(0, dim, step))
        elif dim <= 1:
            indices = [0]
        elif full_range:
            indices = np.unique(np.round(
                np.linspace(0, dim - 1, min(slice_number, dim))).astype(int))
        else:
            count = min(slice_number, dim)
            if count <= 1:
                indices = [dim // 2]
            else:
                margin = np.round(dim / 4)
                indices = np.round(
                    np.linspace(margin, dim - margin, count),
                ).astype(int)

        slices = {str(int(i)): vol_thumb.from_array(getter(i)) for i in indices}
        return slices, prefix, [xdim, ydim, zdim]


def volume_density_source(root, rel_path, max_size=None):
    """ Request of the density of a volume (scaled grid and histogram, see
    emhub.data.volume_density) for emflow's VolumeViewer, which loads it
    when it needs it (3D volume tab, or the slices of a volume without
    slice images). max_size: longest side of the grid. """
    try:
        url = flask.url_for('api.fetch_volume_density')
    except RuntimeError:  # outside a request
        url = '/api/fetch_volume_density'
    payload = {'root': root, 'path': rel_path}
    if max_size:
        payload['maxSize'] = int(max_size)
    return {'path': url, 'payload': payload}


def _volume_dimensions(path):
    """[X, Y, Z] of a volume from its MRC header."""
    import mrcfile
    with mrcfile.mmap(path, permissive=True) as mrc:
        zdim, ydim, xdim = mrc.data.shape[-3:]
    return [int(xdim), int(ydim), int(zdim)]


def _volume_voxel_size(path):
    """Voxel size in Å as [x, y, z] from the MRC header, or None if unknown."""
    import mrcfile
    try:
        with mrcfile.mmap(path, permissive=True) as mrc:
            v = [float(mrc.voxel_size.x), float(mrc.voxel_size.y), float(mrc.voxel_size.z)]
    except Exception:
        return None
    return v if all(x > 0 for x in v) else None


def build_volume_image_slider_pane_content(
    volume_path,
    title=None,
    axes=('z',),
    axis_prefix=None,
    *,
    all_slices=False,
    slice_label_offset=0,
    full_range=False,
    upright=False,
):
    """Build image-slider pane content from a volume or tilt-series stack file."""
    axis_payload = {}
    dimensions = None
    for axis in axes:
        prefix = axis_prefix if axis == 'z' and axis_prefix else None
        slices, prefix, dimensions = _volume_axis_slices(
            volume_path,
            axis=axis,
            slice_number=32,
            slice_dim=512,
            prefix=prefix,
            all_slices=all_slices,
            full_range=full_range,
            upright=upright,
        )
        axis_payload[axis] = {
            'slices': slices,
            'sliderPrefix': prefix,
        }

    basename = os.path.basename(volume_path)
    if len(axis_payload) == 1:
        only_axis = next(iter(axis_payload.values()))
        payload = {
            'kind': 'imageSlider',
            'title': title or f'Slices — {basename}',
            'slices': only_axis['slices'],
            'sliderPrefix': only_axis['sliderPrefix'],
            'dimensions': dimensions,
        }
        if slice_label_offset:
            payload['sliceLabelOffset'] = slice_label_offset
        return payload

    payload = {
        'kind': 'imageSlider',
        'title': title or f'Slices — {basename}',
        'axes': axis_payload,
        'dimensions': dimensions,
    }
    if slice_label_offset:
        payload['sliceLabelOffset'] = slice_label_offset
    return payload


def build_image_slider_pane_content(full_path, root, title=None, axes=('z',)):
    """Build image-slider pane content from a tomogram referenced in a series STAR."""
    row_cells = _find_tomogram_row(full_path)
    if not row_cells:
        raise Exception('STAR file has no reconstructed tomogram column')

    vol_path, vol_rel = _resolve_tomogram_path(root, row_cells)
    if not vol_path:
        raise Exception('Reconstructed tomogram file not found for this series')

    return build_volume_image_slider_pane_content(
        vol_path,
        title=title or f'Slices — {os.path.basename(vol_rel or vol_path)}',
        axes=axes,
    )


def build_aligned_stack_slider_pane_content(root, stack_rel, title=None):
    """Build image-slider pane content from an aligned tilt-series stack (.mrc/.mrcs)."""
    stack_path = _resolve_data_path(root, stack_rel)
    if not stack_path or not os.path.exists(stack_path):
        raise Exception(f'Aligned tilt series stack not found: {stack_rel}')

    return build_volume_image_slider_pane_content(
        stack_path,
        title=title or stack_rel,
        axes=('z',),
        axis_prefix='Tilt: ',
        all_slices=True,
        slice_label_offset=1,
    )


def _tilt_image_path(root, image_rel):
    """The path of a tilt image given as 'path' or 'N@stack' (1-based) and
    its index in the stack (None for a single image)."""
    index = None
    if '@' in image_rel:
        index_str, image_rel = image_rel.split('@', 1)
        index = int(index_str) - 1
    image_path = _resolve_data_path(root, image_rel)
    if not image_path or not os.path.exists(image_path):
        raise Exception(f'Tilt image not found: {image_rel}')
    return image_path, index


def _tilt_image_size(root, image_rel):
    """[width, height] of a tilt image from its MRC header, or None."""
    import mrcfile

    try:
        image_path, _ = _tilt_image_path(root, image_rel)
        with mrcfile.open(image_path, header_only=True, permissive=True) as mrc:
            return [int(mrc.header.nx), int(mrc.header.ny)]
    except Exception:
        return None


def _read_tilt_image(root, image_rel):
    """Return the 2D array of a tilt image, given as 'path' or 'N@stack'
    (1-based), and its Å per pixel (None when the MRC header does not say)."""
    import mrcfile

    image_path, index = _tilt_image_path(root, image_rel)
    with mrcfile.mmap(image_path, permissive=True) as mrc:
        data = mrc.data
        if data.ndim == 3:
            data = data[index or 0]
        return data.copy(), _mrc_pixel_size(mrc)


# Per tilt values of emflow's TiltSeriesViewer: pane key -> per tilt series
# STAR column. Angles in degrees, shifts in Å, defocus in Å, dose in e/Å²
_TS_VIEWER_FIELDS = {
    'tiltAngle': TILT_ANGLE_X_COL,
    'xTilt': 'rlnTomoXTilt',
    'yTilt': 'rlnTomoYTilt',
    'zRot': 'rlnTomoZRot',
    'shiftX': 'rlnTomoXShiftAngst',
    'shiftY': 'rlnTomoYShiftAngst',
    'dose': 'rlnMicrographPreExposure',
    'defocusU': 'rlnDefocusU',
    'defocusV': 'rlnDefocusV',
    'ctfMaxResolution': 'rlnCtfMaxResolution',
}
_TS_VIEWER_IMAGE_SIZE = 512


def _finite_float(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if v == v and abs(v) != float('inf') else None


def _mrc_pixel_size(mrc):
    """Å per pixel of an open MRC, or None when the header does not say."""
    try:
        px = float(mrc.voxel_size.x)
    except Exception:
        return None
    return px if px > 0 else None


def _parse_coefficients(value):
    """The numbers of a STAR list value ('[1.0,2.0,...]'), or None."""
    if not value or value == 'None':
        return None
    try:
        return [float(v) for v in str(value).strip('[] ').split(',') if v.strip()]
    except ValueError:
        return None


def _series_global_row(star_path, tomo_name):
    """The row of a tilt series in the global STAR of the job that wrote its
    per tilt series STAR (<job>/tilt_series/<name>.star -> <job>/*.star with
    a 'global' table), or None."""
    from glob import glob
    job_dir = os.path.dirname(os.path.dirname(star_path))
    for path in sorted(glob(os.path.join(job_dir, '*.star'))):
        try:
            with StarFile(path) as sf:
                if 'global' not in sf.getTableNames():
                    continue
                for row in sf.iterTable('global', guessType=False):
                    if getattr(row, 'rlnTomoName', None) == tomo_name:
                        return row._asdict()
        except Exception:
            continue
    return None


def _series_deformation(root, star_path, tomo_name, rows, image_size, image_px):
    """The local alignment of a tilt series (RELION 2D deformations: type and
    grid size from its global STAR row, rlnTomoDeformationCoefficients per
    tilt), as {'type', 'gridSize', 'imageSize'}: imageSize is the size of
    the tilt images RELION deforms (full size, at rlnTomoTiltSeriesPixelSize),
    from the header of a tilt image, else from the size of the images sent.
    None without deformations."""
    if not any(_parse_coefficients(r.get('rlnTomoDeformationCoefficients')) for r in rows):
        return None
    g = _series_global_row(star_path, tomo_name) or {}
    dtype = g.get('rlnTomoDeformationType')
    gx = _finite_float(g.get('rlnTomoDeformationGridSizeX'))
    gy = _finite_float(g.get('rlnTomoDeformationGridSizeY'))
    if not dtype or not gx or not gy:
        return None
    full = None
    for r in rows:
        if full := _tilt_image_size(root, r.get('rlnMicrographName') or ''):
            break
    ts_px = _finite_float(g.get('rlnTomoTiltSeriesPixelSize'))
    if full is None and ts_px and image_px and image_size[0]:
        full = [round(image_size[0] * image_px / ts_px), round(image_size[1] * image_px / ts_px)]
    if full is None:
        return None
    return {'type': dtype, 'gridSize': [int(gx), int(gy)], 'imageSize': full}


def _stack_section_tilts(stack_path, tilts, angle_key):
    """ The tilt (one of the dicts in tilts) of each section of a tilt
    series stack, in stack order, or None if that cannot be told.

    The stack's angles are in the IMOD .tlt file beside it, and AreTomo and
    Warp may write them with the opposite sign to RELION's angles (angle_key
    of each tilt).  The sign is the one under which every section matches a
    tilt to within rounding; when both signs fit equally (a perfectly
    symmetric scheme) the order is ambiguous and None is returned.
    """
    tilts = [t for t in tilts if t.get(angle_key) is not None]
    if not stack_path or not tilts:
        return None
    tlt = os.path.splitext(stack_path)[0] + '.tlt'
    try:
        with open(tlt) as f:
            angles = [float(v) for v in f.read().split()]
    except (OSError, ValueError):
        return None
    if not angles or len(angles) > len(tilts):
        return None

    def match(sign):
        # Each section's nearest tilt, and the worst mismatch
        picks = [min(tilts, key=lambda t: abs(t[angle_key] - sign * a))
                 for a in angles]
        worst = max(abs(t[angle_key] - sign * a) for t, a in zip(picks, angles))
        return worst, picks

    (err_same, same), (err_flip, flip) = match(1), match(-1)
    best_err, best = min((err_same, same), (err_flip, flip), key=lambda m: m[0])
    other_err = max(err_same, err_flip)
    # Rounding is within 0.01 degree; a sign is only trusted if the other
    # one fits clearly worse, and every section must be a different tilt
    if best_err > 0.02 or other_err < 2 * best_err + 0.01:
        return None
    if len({id(t) for t in best}) != len(best):
        return None
    return best


def build_tilt_series_viewer_pane_content(root, star_rel=None, stack_rel=None,
                                          title=None, pixel_size=None):
    """Pane content of emflow's TiltSeriesViewer ({kind: 'tiltSeries'}): the
    tilt images sorted by tilt angle, each with its movie index, tilt angle,
    alignment (rlnTomoXTilt / YTilt / ZRot, X / Y shift in Å) and dose, defocus
    and CTF fit from the per tilt series STAR, so the viewer can show the
    images with the alignment applied or not.

    The images come from the tilt series stack (rlnTiltSeriesAligned: the
    unaligned stack Warp and AreTomo3 write for IMOD, with the .xf beside
    it), its sections matched to the STAR rows by the angles of its .tlt, or
    in STAR order when there is no .tlt and the counts agree; without a stack,
    from the tilt images of the STAR (rlnMicrographName). Without a STAR only
    the stack sections are shown. pixel_size: Å per pixel of the images when
    their MRC header does not say (rlnTomoTiltSeriesPixelSize).

    The local alignment, when the STAR has rlnTomoDeformationCoefficients,
    is sent as 'deformation' (see _series_deformation) and the coefficients
    of each tilt as its 'deformation'.
    """
    import mrcfile
    from emtools.image import Thumbnail

    rows, table_name, full_path = [], None, None
    if star_rel:
        full_path = project_file_path(root, star_rel)
        if not os.path.exists(full_path):
            raise Exception(f'STAR file not found: {star_rel}')
        with StarFile(full_path) as sf:
            table_name = _resolve_series_star_table_name(sf)
            if not table_name:
                raise Exception('STAR file has no tables')
            rows = [row._asdict() for row in sf.iterTable(table_name, guessType=False)]

    size = _TS_VIEWER_IMAGE_SIZE
    thumb = Thumbnail.Tilt(max_size=(size, size), output_format='base64')
    image_size = [None, None]

    def _image(array, source_px):
        """The base64 PNG of a tilt and the Å per pixel of it."""
        binned = Thumbnail.bin_array(array, size)
        encoded = thumb.from_array(binned)
        out_w = max(1, round(binned.shape[1] / (thumb.scale or 1)))
        out_h = max(1, round(binned.shape[0] / (thumb.scale or 1)))
        image_size[:] = [out_w, out_h]
        return encoded, (source_px * array.shape[1] / out_w) if source_px else None

    def _tilt(row, section=None):
        tilt = {key: _finite_float(row.get(col)) for key, col in _TS_VIEWER_FIELDS.items()}
        movie = _finite_float(row.get('rlnTomoTiltMovieIndex'))
        tilt['movieIndex'] = None if movie is None else int(movie)
        if coefficients := _parse_coefficients(row.get('rlnTomoDeformationCoefficients')):
            tilt['deformation'] = coefficients
        if section is not None:
            tilt['section'] = section
        return tilt

    tilts, image_px = [], None
    stack_path = _resolve_data_path(root, stack_rel) if stack_rel and stack_rel != 'None' else None
    if stack_path and os.path.exists(stack_path):
        with mrcfile.mmap(stack_path, permissive=True) as mrc:
            data = mrc.data if mrc.data.ndim == 3 else mrc.data[None]
            source_px = _mrc_pixel_size(mrc) or pixel_size
            n = data.shape[0]
            # The STAR row of each section: by the .tlt angles (Warp writes
            # rlnTomoYTilt there, AreTomo the nominal angle), else by order
            parsed = [dict(r, **{k: _finite_float(r.get(c)) for k, c in
                                 (('_yTilt', 'rlnTomoYTilt'), ('_nominal', TILT_ANGLE_X_COL))})
                      for r in rows]
            matched = (_stack_section_tilts(stack_path, parsed, '_yTilt')
                       or _stack_section_tilts(stack_path, parsed, '_nominal'))
            if matched is None and len(rows) == n:
                matched = rows
            for i in range(n):
                tilt = _tilt(matched[i] if matched else {}, section=i)
                tilt['image'], image_px = _image(data[i], source_px)
                tilts.append(tilt)
    elif rows:
        for row in rows:
            if not row.get('rlnMicrographName'):
                continue
            array, source_px = _read_tilt_image(root, row['rlnMicrographName'])
            tilt = _tilt(row)
            tilt['image'], image_px = _image(array, source_px or pixel_size)
            tilts.append(tilt)
        if not tilts:
            raise Exception(f'No tilt images (rlnMicrographName) in {star_rel}')
    else:
        raise Exception('Missing tilt series stack or STAR file')

    def _order(t):
        angle = t['tiltAngle'] if t['tiltAngle'] is not None else t['yTilt']
        return (angle is None, angle or 0.0, t.get('section', 0))

    tilts.sort(key=_order)
    # The table of a per tilt series STAR is named after the tilt series
    deformation = (_series_deformation(root, full_path, table_name, rows, image_size, image_px)
                   if rows else None)
    if deformation is None:
        for t in tilts:
            t.pop('deformation', None)
    axis = next((a for a in (_finite_float(r.get('rlnTomoNominalTiltAxisAngle')) for r in rows)
                 if a is not None), None)
    return {
        'kind': 'tiltSeries',
        'title': title or stack_rel or star_rel,
        'tilts': tilts,
        'imageSize': image_size,
        # Å per pixel of the images sent, for the shifts and the ruler
        'pixelSize': image_px,
        'tiltAxisAngle': axis,
        'hasAlignment': any(t['zRot'] is not None and t['shiftX'] is not None
                            and t['shiftY'] is not None for t in tilts),
        # Local alignment (2D deformation of each tilt), or None
        'deformation': deformation,
    }


def _grid_cell(title, build, *args, **kwargs):
    """Pane content of a grid cell, or an 'empty' cell with the error."""
    try:
        return build(*args, title=title, **kwargs)
    except Exception as e:
        return {'kind': 'empty', 'title': title, 'message': str(e)}


def build_tilt_series_grid_pane_content(root, row_cells, star_rel, row_label):
    """2 x 2 grid for a tilt series: the tilt series viewer (the stack, else
    the tilt images, with the alignment of the STAR) | tilt angles (dose vs
    tilt angle); motion | defocus plots."""
    stack_rel = resolve_row_aligned_stack_path(row_cells)
    if stack_rel or star_rel:
        slices = _grid_cell('Slices', build_tilt_series_viewer_pane_content,
                            root, star_rel, stack_rel,
                            pixel_size=_finite_float(row_cells.get('tsPixelSize')
                                                     or row_cells.get('rlnTomoTiltSeriesPixelSize')))
    else:
        slices = {'kind': 'empty', 'title': 'Slices',
                  'message': 'Missing tilt series stack or STAR file'}

    def _plot(title, build):
        if not star_rel:
            return {'kind': 'empty', 'title': title, 'message': 'Missing star file path'}
        full_path = project_file_path(root, star_rel)
        if not os.path.exists(full_path):
            return {'kind': 'empty', 'title': title,
                    'message': f'STAR file not found: {star_rel}'}
        return _grid_cell(title, build, full_path)

    return {
        'kind': 'grid',
        'title': f'Tilt series — {row_label}',
        'layout': '2x2',
        'cells': {
            'topLeft': slices,
            'topRight': _plot('Tilt angles', build_tilt_angles_plot_content),
            'bottomLeft': _plot('Motion', build_motion_plot_content),
            'bottomRight': _plot('Defocus', build_defocus_plot_content),
        },
    }


# VolumeViewer of a map (3D classes, species of a population): its iso-surface
# first and the slices drawn from the same density; no 3D planes, crosshair
# nor particles. Small blobs of noise ("dust") are hidden
MAP_VIEWER_CONFIG = {
    'tabs': {'view3d': False},
    'initialTab': 'volume3d',
    'tools': {'crosshair': False, 'particles': False},
    'defaults': {'iso': {'dust': 100}},
}

# Tomograms in the TableViewer (Tomograms, TomoCoordinates, TomoParticles):
# slices and 3D planes, no 3D volume tab
TOMOGRAM_VIEWER_CONFIG = {
    'tabs': {'volume3d': False},
}


def build_volume_viewer_pane_content(
    root,
    vol_rel,
    title=None,
    *,
    slices=True,
    density='lazy',
    max_voxels=None,
    max_size=None,
    viewer_config=None,
    coordinates=None,
):
    """ Pane content of a volume of the project for emflow's VolumeViewer.

    slices: X/Y/Z slice images (over the whole volume, X slices upright) for
        its Slices and 3D planes tabs. Without them, the viewer draws the
        slices from the density grid (fine for small maps, e.g. 3D classes).
    density: for its "3D volume" tab (iso-surface and histogram, see
        emhub.data.volume_density): 'lazy' sends the request, that the viewer
        loads when it needs it; 'inline' computes it now (the volume is
        then sent once, for all the tabs); None: no 3D volume tab.
    max_voxels: of the binned grid of an inline density.
    max_size: longest side of the grid (maps are Fourier scaled to it).
    viewer_config: VolumeViewerConfig (tabs, tools, defaults...).
    """
    vol_path = _resolve_data_path(root, vol_rel)
    if not vol_path or not os.path.exists(vol_path):
        raise Exception(f'Volume not found: {vol_rel}')
    if not slices and not density:
        raise Exception('A volume pane needs slices or its density')

    if slices:
        content = build_volume_image_slider_pane_content(
            vol_path,
            title=title or vol_rel,
            axes=('x', 'y', 'z'),
            full_range=True,
            upright=True,
        )
    else:
        content = {'kind': 'imageSlider', 'title': title or vol_rel,
                   'dimensions': _volume_dimensions(vol_path)}
    content['layout'] = 'volume'
    content['voxelSize'] = _volume_voxel_size(vol_path)
    if density == 'inline':
        from emhub.data.volume_density import load_volume_density
        content['density'] = load_volume_density(vol_path, max_voxels, max_size)
    elif density:
        content['density'] = volume_density_source(root, vol_rel, max_size)
    if viewer_config:
        content['viewerConfig'] = viewer_config
    if coordinates:
        content['coordinates'] = coordinates
    return content


def build_tomogram_volume_slider_pane_content(
    root,
    tomo_rel,
    title=None,
    *,
    coordinates=None,
):
    """ VolumeViewer pane of a reconstructed tomogram: its slices and 3D
    planes, without the 3D volume tab (no density is sent). """
    return build_volume_viewer_pane_content(
        root, tomo_rel, title=title, density=None,
        viewer_config=TOMOGRAM_VIEWER_CONFIG, coordinates=coordinates)


# Volume and VolumeMask outputs (emflow's volume viewer dialog): 3D volume
# first and the slices, as the mask wizard (VolumeMaskWizard) shows them
VOLUME_OUTPUT_VIEWER_CONFIG = {
    'tabs': {'view3d': False},
    'initialTab': 'volume3d',
    'tools': {'select': False, 'crosshair': False, 'particles': False},
    'defaults': {'iso': {'dust': 100}},
}
# Longest side of their density grid (maps are Fourier scaled to it)
VOLUME_OUTPUT_MAX_SIZE = 256


def _mask_source_map(root, mask_rel):
    """ The map a mask was created from, on the same box, or None: the input
    volume of a Relion mask (from volume) or the template next to a PyTom
    mask (<name>_mask.mrc -> <name>.mrc). """
    candidates = []
    job_star = _resolve_data_path(root, os.path.join(os.path.dirname(mask_rel), 'job.star'))
    if job_star and os.path.exists(job_star):
        try:
            values = RelionStar.read_jobstar(job_star)
        except Exception:
            values = {}
        if not values.get('relion_mask_create.denovo'):
            candidates.append(values.get('relion_mask_create.volume.i'))
    if mask_rel.endswith('_mask.mrc'):
        candidates.append(mask_rel[:-len('_mask.mrc')] + '.mrc')

    mask_dims = _volume_dimensions(_resolve_data_path(root, mask_rel))
    for rel in candidates:
        try:
            path = _resolve_data_path(root, rel) if rel else None
        except ValueError:
            continue
        if path and os.path.exists(path) and _volume_dimensions(path) == mask_dims:
            return rel
    return None


def build_volume_output_pane_content(root, rel_path, pointer_class='Volume'):
    """ VolumeViewer of a Volume output, or of a VolumeMask output: the map
    it was created from with the mask over it (or the mask alone if the map
    is not found). The density is loaded by the viewer and the slices are
    drawn from it. """
    vol_rel, config = rel_path, dict(VOLUME_OUTPUT_VIEWER_CONFIG)
    title = rel_path
    if pointer_class == 'VolumeMask' and (source := _mask_source_map(root, rel_path)):
        vol_rel = source
        config['mask'] = {
            'type': 'map',
            'density': volume_density_source(root, rel_path, VOLUME_OUTPUT_MAX_SIZE),
            'label': os.path.basename(rel_path),
        }
        title = f'Mask {rel_path} over {source}'
    return build_volume_viewer_pane_content(
        root, vol_rel, title=title, slices=False, density='lazy',
        max_size=VOLUME_OUTPUT_MAX_SIZE, viewer_config=config)


def resolve_table_view_type_hint(attrs, row_cells):
    """Best-effort path for resolving the table view type from a pane request."""
    return (
        attrs.get('outputPath')
        or attrs.get('starPath')
        or attrs.get('starFile')
        or attrs.get('path')
        or row_cells.get('starFilePath')
        or row_cells.get('starFile')
        or row_cells.get('rlnTomoTiltSeriesStarFile')
        or row_cells.get('alignedStackPath')
        or row_cells.get('alignedStack')
        or row_cells.get('rlnTiltSeriesAligned')
        or row_cells.get('tomogramPath')
        or row_cells.get('tomogram')
        or row_cells.get('rlnTomoReconstructedTomogram')
    )


def _resolve_row_path_value(row_cells, column_id=None, *, path_key, display_key, legacy_key=None):
    if column_id:
        mapped_key = _TABLE_PATH_CELL_FIELDS.get(column_id)
        if mapped_key:
            value = row_cells.get(mapped_key)
            if value:
                return value
        value = row_cells.get(column_id)
        if value and column_id not in _TABLE_PATH_CELL_FIELDS:
            return value
    value = row_cells.get(path_key)
    if value:
        return value
    value = row_cells.get(display_key)
    if value:
        return value
    if legacy_key:
        return row_cells.get(legacy_key)
    return None


def resolve_row_star_path(attrs, row_cells, column_id=None):
    """Resolve the per-series tilt-series STAR path from a pane request."""
    star_rel = attrs.get('starPath') or attrs.get('starFile') or attrs.get('path')
    if star_rel:
        return star_rel
    return _resolve_row_path_value(
        row_cells,
        column_id,
        path_key='starFilePath',
        display_key='starFile',
        legacy_key='rlnTomoTiltSeriesStarFile',
    )


def resolve_row_aligned_stack_path(row_cells, column_id=None):
    """Resolve the aligned tilt-series stack path from a table row."""
    return _resolve_row_path_value(
        row_cells,
        column_id,
        path_key='alignedStackPath',
        display_key='alignedStack',
        legacy_key='rlnTiltSeriesAligned',
    )


def resolve_row_tomogram_path(row_cells, column_id=None):
    """Resolve the reconstructed tomogram path from a table row."""
    path = _resolve_row_path_value(
        row_cells,
        column_id,
        path_key='tomogramPath',
        display_key='tomogram',
        legacy_key='rlnTomoReconstructedTomogram',
    )
    if path:
        return path
    return row_cells.get('rlnTomoReconstructedTomogramDenoised')


def build_series_star_pane_content(action_id, root, star_rel, row_label, type_key):
    """Build pane content for actions that read a per-series tilt-series STAR file."""
    full_path = project_file_path(root, star_rel)
    if not os.path.exists(full_path):
        raise Exception(f'STAR file not found: {star_rel}')

    if not action_allowed_for_series(type_key, action_id, full_path):
        raise Exception(
            f'Action {action_id!r} is not supported for {type_key}'
        )

    if action_id == 'tilt-angles':
        return build_tilt_angles_plot_content(
            full_path,
            title=f'Tilt angles — {row_label}',
        )

    if action_id == 'defocus':
        return build_defocus_plot_content(
            full_path,
            title=f'Defocus — {row_label}',
        )

    if action_id == 'motion':
        return build_motion_plot_content(
            full_path,
            title=f'Motion — {row_label}',
        )

    if action_id == 'metadata':
        return build_metadata_pane_content(star_rel, full_path)

    if action_id == 'slices':
        return build_image_slider_pane_content(
            full_path,
            root,
            title=f'Slices — {row_label}',
        )

    raise Exception(f'Unsupported table view action: {action_id}')


def processing_project_manager(root_abs):
    """ The emwrap ProjectManager of the processing project at root_abs,
    to launch jobs in it. """
    processing = get_processing_project(root_abs)
    if processing is None:
        raise Exception(f'Not a valid processing project: {root_abs}')

    pm = getattr(processing, 'project', None)
    if pm is None:
        from emwrap.base import ProjectManager
        pm = ProjectManager(root_abs)
    return pm


class ApiViewerHelper:
    @staticmethod
    def create_tomo_subset(root, pointer_class, star_path, subset_items, attrs=None):
        """Create and launch an emw-subset-ts job for the selected tomograms.

        attrs['excludeTilts'], optional, is {tomoName: [movie indices]}: tilts
        to leave out of those tomograms' tilt-series STAR files.
        """
        items = [str(item).strip() for item in (subset_items or []) if str(item).strip()]
        if not items:
            raise Exception('subsetItems must contain at least one tomogram name')

        root_abs = resolve_project_root(root)
        input_star = _resolve_data_path(root, star_path)
        if not input_star or not os.path.isfile(input_star):
            raise Exception(f'Input STAR file not found: {star_path}')

        try:
            input_set = os.path.relpath(input_star, root_abs)
        except ValueError:
            input_set = input_star
        input_set = Path.rmslash(input_set)

        pm = processing_project_manager(root_abs)

        params = {
            'input_set': input_set,
            'mode': '0',    # explicit tomogram names list
            'subset_tomo_names': ' '.join(items),
        }
        exclude = (attrs or {}).get('excludeTilts') or {}
        rows = [{'tomoName': name,
                 'excludedTilts': ' '.join(str(int(i)) for i in sorted(ids))}
                for name, ids in exclude.items() if ids and name in items]
        if rows:
            params['exclude_tilts'] = rows
        job = pm.runJob('emw-subset-ts', params)
        count = len(items)
        n_tilts = sum(len(r['excludedTilts'].split()) for r in rows)

        return {
            'success': True,
            'count': count,
            'excludedTilts': n_tilts,
            'jobId': job.id,
            'sourceFile': input_set,
            'message': (f'Launched {job.id} job to create a subset of {count} items'
                        + (f', excluding {n_tilts} tilts' if n_tilts else '')),
        }
