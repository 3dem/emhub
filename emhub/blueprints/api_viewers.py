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

from emtools.metadata import StarFile, RelionStar
from emtools.utils import Path

from emhub.data.processing import resolve_project_root


# --- Shared table column / field / action definitions ---

_TOMO_NAME_COL = {'id': 'tomoName', 'label': 'Tomo name', 'align': 'left'}
_STAR_FILE_COL = {'id': 'starFile', 'label': 'Metadata', 'align': 'left'}
_PIXEL_SIZE_COL = {'id': 'pixelSize', 'label': 'Pixel size (Å/px)', 'align': 'right'}
_TS_PIXEL_SIZE_COL = {'id': 'tsPixelSize', 'label': 'TS pixel size (Å/px)', 'align': 'right'}
_ALIGNED_STACK_COL = {'id': 'alignedStack', 'label': 'Aligned stack', 'align': 'left'}
_TOMOGRAM_COL = {'id': 'tomogram', 'label': 'Tomogram', 'align': 'left'}
_NCOORDS_COL = {'id': 'nCoords', 'label': 'Coordinates', 'align': 'right'}

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
    computed_cell_fields=None,
):
    """Build a table-view spec for global tilt-series / tomogram STAR outputs."""
    columns = [_TOMO_NAME_COL, _STAR_FILE_COL]
    cell_fields = dict(_TILT_SERIES_GLOBAL_CELL_FIELDS)
    actions = [_ACTION_METADATA]

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
    return spec


def _tomocoordinates_table_spec():
    """Table spec for optimisation_set.star (tomograms + particles coordinates)."""
    spec = _tilt_series_table_spec(
        'Tomo coordinates',
        with_ts_pixel_size=True,
        with_aligned_stack=True,
        with_tomogram=True,
        computed_cell_fields={'pixelSize': _format_tomo_pixel_size},
    )
    spec['columns'].insert(1, _NCOORDS_COL)
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
    'tiltseries': _tilt_series_table_spec('Tilt series', with_ts_pixel_size=True),
    'tiltseriesaligned': _tilt_series_table_spec(
        'Aligned tilt series',
        with_ts_pixel_size=True,
        with_aligned_stack=True,
    ),
    'tomograms': _tilt_series_table_spec(
        'Tomograms',
        with_ts_pixel_size=True,
        with_aligned_stack=True,
        with_tomogram=True,
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
    return {'id': action['id'], 'label': action['label']}


def _table_view_column_actions(spec):
    """Attach static column-bound actions to column definitions."""
    columns = []
    for col in spec['columns']:
        col_def = dict(col)
        col_actions = [
            _table_view_action_payload(action)
            for action in spec['actions']
            if action.get('column') == col['id']
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
                os.path.join(resolve_project_root(root), star_rel))
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
        columns = _table_view_column_actions(spec)

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
    if not rel_path:
        return None
    if os.path.isabs(rel_path):
        if rel_path.startswith('~'):
            return os.path.abspath(os.path.expanduser(rel_path))
        return rel_path
    return os.path.join(resolve_project_root(root), rel_path)


def _resolve_tomogram_path(root, row_cells):
    for col in TOMOGRAM_COLUMNS:
        rel = row_cells.get(col)
        if not rel:
            continue
        full_path = _resolve_data_path(root, rel)
        if full_path and os.path.exists(full_path):
            return full_path, rel
    return None, None


def _volume_axis_slices(volume_data, axis, slice_number, slice_dim, prefix=None):
    import mrcfile
    import numpy as np
    from emtools.image import Thumbnail

    with mrcfile.open(volume_data, permissive=True) as mrc:
        zdim, ydim, xdim = mrc.data.shape
        vol_thumb = Thumbnail(
            max_size=(slice_dim, slice_dim),
            output_format='base64',
            contrast_factor=1.5,
        )

        if axis == 'x':
            dim = xdim
            getter = lambda i: mrc.data[:, :, i]
            prefix = prefix or 'X slice: '
        elif axis == 'y':
            dim = ydim
            getter = lambda i: mrc.data[:, i, :]
            prefix = prefix or 'Y slice: '
        else:
            dim = zdim
            getter = lambda i: mrc.data[i, :, :]
            prefix = prefix or 'Z slice: '

        count = min(slice_number, dim)
        if count <= 1:
            indices = [dim // 2]
        else:
            margin = np.round(dim / 4)
            indices = np.round(np.linspace(margin, dim - margin, count)).astype(int)

        slices = {str(int(i)): vol_thumb.from_array(getter(i)) for i in indices}
        return slices, prefix, [xdim, ydim, zdim]


def build_volume_image_slider_pane_content(
    volume_path,
    title=None,
    axes=('z',),
    axis_prefix=None,
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
        )
        axis_payload[axis] = {
            'slices': slices,
            'sliderPrefix': prefix,
        }

    basename = os.path.basename(volume_path)
    if len(axis_payload) == 1:
        only_axis = next(iter(axis_payload.values()))
        return {
            'kind': 'imageSlider',
            'title': title or f'Slices — {basename}',
            'slices': only_axis['slices'],
            'sliderPrefix': only_axis['sliderPrefix'],
            'dimensions': dimensions,
        }

    return {
        'kind': 'imageSlider',
        'title': title or f'Slices — {basename}',
        'axes': axis_payload,
        'dimensions': dimensions,
    }


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
    )


def build_tomogram_volume_slider_pane_content(
    root,
    tomo_rel,
    title=None,
    *,
    coordinates=None,
):
    """Build three-axis volume sliders for a reconstructed tomogram."""
    tomo_path = _resolve_data_path(root, tomo_rel)
    if not tomo_path or not os.path.exists(tomo_path):
        raise Exception(f'Tomogram not found: {tomo_rel}')

    content = build_volume_image_slider_pane_content(
        tomo_path,
        title=title or tomo_rel,
        axes=('x', 'y', 'z'),
    )
    content['layout'] = 'volume'
    if coordinates:
        content['coordinates'] = coordinates
    return content


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
    full_path = os.path.join(resolve_project_root(root), star_rel)
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
