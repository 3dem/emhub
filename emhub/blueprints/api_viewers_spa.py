# **************************************************************************
# *
# * Authors:     J.M. de la Rosa Trevin (delarosatrevin@gmail.com)
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
# **************************************************************************

"""Table-viewer panes for SPA outputs (Movies, Micrographs, MultiClasses2D
and Particles).

Same table view API used for tilt series (see api_viewers.py), returning
pane contents that are rendered generically by the viewer (text, image,
html and plotly), so no viewer specific code is needed:
    - Movies: table of movies, with the row metadata (movie images are
      not read, to keep it light for large sessions).
    - Micrographs: table of micrographs with CTF values, and the micrograph
      with picked coordinates and the PSD (as in the session dashboard),
      the CTF profile, the motion and the row metadata.
    - MultiClasses2D: table of 2D classification batches, and the 2D class
      averages of each batch (as in the session dashboard).
    - Particles: table of micrographs with their number of particles, and
      the particles coordinates over the micrograph and a grid with some of
      the particles images.
"""

import html
import os

from emtools.metadata import StarFile
from emtools.utils import Path

from .api_viewers import (
    _resolve_data_path,
    _build_plotly_scatter_figure,
    _table_view_action_payload,
    _table_view_column_actions,
)


_ACTION_MICROGRAPH = {'id': 'micrograph', 'label': 'micrograph', 'column': 'micrograph'}
_ACTION_CTF = {'id': 'ctf', 'label': 'CTF'}
_ACTION_MOTION = {'id': 'motion', 'label': 'motion'}
_ACTION_ROW_METADATA = {'id': 'metadata', 'label': 'metadata'}
_ACTION_CLASSES2D = {'id': 'classes2d', 'label': 'classes'}
_ACTION_COORDINATES = {'id': 'coordinates', 'label': 'coordinates', 'column': 'micrograph'}
_ACTION_PARTICLES = {'id': 'particles', 'label': 'particles', 'column': 'stack'}

# Particles preview grid (columns x rows)
PARTICLES_GRID = (5, 5)

# Columns and how cell values are computed from the STAR row (dict)
SPA_TABLE_VIEW_SPECS = {
    'movies': {
        'title': 'Movies',
        'table': 'movies',
        'columns': [
            {'id': 'index', 'label': '#', 'align': 'right'},
            {'id': 'movie', 'label': 'Movie', 'align': 'left'},
            {'id': 'opticsGroup', 'label': 'Optics group', 'align': 'right'},
        ],
        'path_cells': {'movie': 'rlnMicrographMovieName'},
        'value_cells': {'opticsGroup': ('rlnOpticsGroup', None, None)},
        'actions': [_ACTION_ROW_METADATA],
    },
    'micrographs': {
        'title': 'Micrographs',
        'table': 'micrographs',
        'columns': [
            {'id': 'index', 'label': '#', 'align': 'right'},
            {'id': 'micrograph', 'label': 'Micrograph', 'align': 'left'},
            {'id': 'defocusU', 'label': 'Defocus U (µm)', 'align': 'right'},
            {'id': 'defocusV', 'label': 'Defocus V (µm)', 'align': 'right'},
            {'id': 'astigmatism', 'label': 'Astig. (µm)', 'align': 'right'},
            {'id': 'resolution', 'label': 'Resolution (Å)', 'align': 'right'},
            {'id': 'fom', 'label': 'FOM', 'align': 'right'},
            {'id': 'particles', 'label': 'Particles', 'align': 'right'},
        ],
        'path_cells': {'micrograph': 'rlnMicrographName'},
        # cell id -> (STAR column, scale, decimals)
        'value_cells': {
            'defocusU': ('rlnDefocusU', 1e-4, 2),
            'defocusV': ('rlnDefocusV', 1e-4, 2),
            'astigmatism': ('rlnCtfAstigmatism', 1e-4, 3),
            'resolution': ('rlnCtfMaxResolution', 1, 2),
            'fom': ('rlnCtfFigureOfMerit', 1, 3),
            'particles': ('rlnCoordinatesNumber', None, None),
        },
        'actions': [_ACTION_MICROGRAPH, _ACTION_CTF, _ACTION_MOTION, _ACTION_ROW_METADATA],
    },
    # Batches of 2D classes (e.g. from emw-rln2d), one row per batch
    'multiclasses2d': {
        'title': '2D classes',
        'table': 'classes2d',
        'columns': [
            {'id': 'index', 'label': '#', 'align': 'right'},
            {'id': 'batch', 'label': 'Batch', 'align': 'left'},
            {'id': 'classes', 'label': 'Classes', 'align': 'right'},
            {'id': 'particles', 'label': 'Particles', 'align': 'right'},
            {'id': 'starFile', 'label': 'Model', 'align': 'left'},
        ],
        'path_cells': {'starFile': 'modelStar'},
        'value_cells': {
            'batch': ('batchId', None, None),
            'classes': ('classesCount', None, None),
            'particles': ('particlesCount', None, None),
        },
        'actions': [_ACTION_CLASSES2D],
        # Show the classes when clicking on a batch row
        'default_action': _ACTION_CLASSES2D,
        'pixel_size': 'pixelSize',
    },
    # Particles are grouped by micrograph (one row per micrograph), since
    # there might be too many particles to list them (see build_particles_table)
    'particles': {
        'title': 'Particles',
        'table': 'particles',
        'columns': [
            {'id': 'index', 'label': '#', 'align': 'right'},
            {'id': 'micrograph', 'label': 'Micrograph', 'align': 'left'},
            {'id': 'particles', 'label': 'Particles', 'align': 'right'},
            {'id': 'stack', 'label': 'Stack', 'align': 'left'},
        ],
        'actions': [_ACTION_COORDINATES, _ACTION_PARTICLES],
    },
}

# STAR columns that are kept in the row cells, to build the panes
_ROW_STAR_COLUMNS = (
    'rlnMicrographMovieName', 'rlnMicrographName', 'rlnCtfImage',
    'rlnMicrographCoordinates', 'rlnMicrographMetadata', 'rlnOpticsGroup',
    'rlnDefocusU', 'rlnDefocusV', 'rlnDefocusAngle', 'rlnCtfAstigmatism',
    'rlnCtfMaxResolution', 'rlnCtfFigureOfMerit', 'rlnCoordinatesNumber',
    # MultiClasses2D
    'batchId', 'pixelSize', 'dataStar', 'classesStack',
)

# ctffind *_avrot.txt lines (after the comments), the first one is the x axis
_CTF_PROFILE_LINES = {
    0: 'Spatial frequency (1/Å)',
    2: 'Rotational average',
    3: 'CTF fit',
    4: 'Cross-correlation',
}


def resolve_spa_table_view_type(pointer_class, star_path=None):
    """Return 'movies', 'micrographs', 'multiclasses2d' or 'particles' from the output datatype (e.g. from
    RELION_OUTPUT_NODES.star) or from the tables of the STAR file, or None. """
    key = (pointer_class or '').replace(' ', '').lower()
    if key in SPA_TABLE_VIEW_SPECS:
        return key
    if key or not star_path or not os.path.isfile(star_path):
        return None
    with StarFile(star_path) as sf:
        tables = sf.getTableNames()
    for type_key, spec in SPA_TABLE_VIEW_SPECS.items():
        if spec['table'] in tables:
            return type_key
    return None


def _format_value(value, scale, decimals):
    if value in (None, ''):
        return ''
    if scale is None:
        return value
    try:
        return round(float(value) * scale, decimals)
    except (TypeError, ValueError):
        return value


def _optics_by_group(sf):
    """Return {optics group: optics row dict} from the STAR file optics table."""
    if 'optics' not in sf.getTableNames():
        return {}
    return {str(row.rlnOpticsGroup): row._asdict()
            for row in sf.iterTable('optics', guessType=False)}


def _pixel_size(optics):
    for label in ['rlnMicrographPixelSize', 'rlnMicrographOriginalPixelSize']:
        if value := optics.get(label):
            return float(value)
    return None


def build_spa_table(full_path, type_key):
    """Build TableViewerPane rows from a SPA STAR file."""
    if type_key == 'particles':
        return build_particles_table(full_path)

    spec = SPA_TABLE_VIEW_SPECS[type_key]
    columns = _table_view_column_actions(spec)
    row_actions = [_table_view_action_payload(a)
                   for a in spec['actions'] if not a.get('column')]
    default_action = spec.get('default_action')

    with StarFile(full_path) as sf:
        optics = _optics_by_group(sf)
        rows = []
        for i, row in enumerate(sf.iterTable(spec['table'], guessType=False), 1):
            star_cells = row._asdict()
            cells = {'index': i}
            for cell_id, col in spec['path_cells'].items():
                value = star_cells.get(col, '')
                cells[f'{cell_id}Path'] = value
                cells[cell_id] = os.path.basename(value)
            for cell_id, (col, scale, decimals) in spec['value_cells'].items():
                cells[cell_id] = _format_value(star_cells.get(col), scale, decimals)
            # Keep the STAR values needed to build the panes of this row
            cells.update({col: star_cells[col] for col in _ROW_STAR_COLUMNS
                          if col in star_cells})
            row = {'id': i, 'cells': cells, 'actions': row_actions}
            if default_action:
                row['defaultAction'] = _table_view_action_payload(default_action)
            rows.append(row)

    title = f"{spec['title']} ({len(rows)} items"
    ps = None
    if optics:
        ps = _pixel_size(next(iter(optics.values())))
    elif rows and (ps_col := spec.get('pixel_size')):
        ps = _format_value(rows[0]['cells'].get(ps_col), 1, 3)
    if ps:
        title += f", {float(ps):0.3f} Å/px"
    return {'title': title + ')', 'columns': columns, 'rows': rows}


# ----------------------- Panes ---------------------------------------
def build_spa_pane_content(action_id, root, type_key, row_cells, output_path=None,
                           row_label=None):
    """Build the pane content for an action on a SPA table row."""
    actions = {a['id'] for a in SPA_TABLE_VIEW_SPECS[type_key]['actions']}
    if action_id not in actions:
        raise Exception(f'Action {action_id!r} is not supported for {type_key}')

    label = (row_cells.get('batch') or row_label or row_cells.get('micrograph')
             or row_cells.get('movie') or '')

    if action_id == 'metadata':
        return build_row_metadata_pane_content(root, row_cells, output_path, label)
    if action_id == 'micrograph':
        return build_micrograph_pane_content(root, row_cells, output_path)
    if action_id == 'ctf':
        return build_ctf_profile_plot_content(root, row_cells)
    if action_id == 'motion':
        return build_micrograph_motion_plot_content(root, row_cells)
    if action_id == 'classes2d':
        return build_classes2d_pane_content(root, row_cells, label)
    if action_id == 'coordinates':
        return build_particles_coordinates_pane_content(root, row_cells, output_path)
    if action_id == 'particles':
        return build_particles_grid_pane_content(root, row_cells, output_path)

    raise Exception(f'Unsupported table view action: {action_id}')


def _row_path(root, row_cells, cell_id, star_col):
    """Full path of a file referenced in a row, or None if missing."""
    rel = row_cells.get(f'{cell_id}Path') or row_cells.get(star_col)
    path = _resolve_data_path(root, rel)
    return path if path and os.path.exists(path) else None


def _require_row_path(root, row_cells, cell_id, star_col, label):
    if path := _row_path(root, row_cells, cell_id, star_col):
        return path
    rel = row_cells.get(f'{cell_id}Path') or row_cells.get(star_col)
    raise Exception(f'{label} not found: {rel}')


def build_row_metadata_pane_content(root, row_cells, output_path, label):
    """Text with the STAR values of the row and its optics group."""
    lines = [f'# {label}', '']
    lines += [f'{k:<32} {v}' for k, v in row_cells.items() if k.startswith('rln')]

    full_path = _resolve_data_path(root, output_path) if output_path else None
    if full_path and os.path.exists(full_path):
        with StarFile(full_path) as sf:
            optics = _optics_by_group(sf).get(str(row_cells.get('rlnOpticsGroup')))
        if optics:
            lines += ['', '# Optics group', '']
            lines += [f'{k:<32} {v}' for k, v in optics.items()]

    return {'kind': 'text', 'title': f'Metadata — {label}', 'text': '\n'.join(lines)}


def _mrc_2d(path):
    """2D data of an MRC image (first slice of stacks, e.g. ctffind outputs)."""
    import mrcfile
    with mrcfile.open(path, permissive=True) as mrc:
        data = mrc.data
        return data[0] if data.ndim == 3 else data


def _coordinates(root, row_cells):
    """Picked coordinates (x, y) of the micrograph, from its coordinates STAR."""
    path = _resolve_data_path(root, row_cells.get('rlnMicrographCoordinates'))
    if not path or not os.path.exists(path):
        return []
    with StarFile(path) as sf:
        table = sf.getTableNames()[0] if sf.getTableNames() else ''
        return [(float(r.rlnCoordinateX), float(r.rlnCoordinateY))
                for r in sf.iterTable(table, guessType=False)]


# Coordinates display, as in the session dashboard (micrograph card)
COORDINATES_COLOR = '#00ff00'
COORDINATES_MODES = ('none', 'dot', 'circle')  # switch options
COORDINATES_DEFAULT_MODE = 'dot'
# Attribute of the page <html> element with the selected mode, so it is kept
# when showing other micrographs (each one is a new pane)
_COORDS_ATTR = 'data-emh-pts'


def _coordinates_switch(n):
    """Switch (none, dot, circle) to show the coordinates, with the same
    look than in the session dashboard (switch-field class and icons of the
    EMhub page). Scripts are not executed in the html pane, so each option
    sets the selected mode as an attribute of the page <html> element, and
    CSS rules based on it show the selected coordinates and option. Return
    (style, switch html). """
    icons = {'none': 'fa-times-circle', 'dot': 'fa-dot-circle', 'circle': 'fa-circle'}
    titles = {'none': 'Hide particles', 'dot': 'Particles as dots',
              'circle': 'Particles as circles'}
    labels = ''.join(
        f'<label class="emh-pts-opt-{m}" title="{titles[m]}" '
        f'onclick="document.documentElement.setAttribute(\'{_COORDS_ATTR}\', \'{m}\')">'
        f'<i class="far {icons[m]}"></i></label>'
        for m in COORDINATES_MODES)

    def _selected(m):
        """Selectors for mode m being selected (default if no attribute)."""
        sel = [f'html[{_COORDS_ATTR}="{m}"]']
        if m == COORDINATES_DEFAULT_MODE:
            sel.append(f'html:not([{_COORDS_ATTR}])')
        return sel

    hidden = [f'{sel} .emh-pts-{g}' for m in COORDINATES_MODES
              for g in ('dot', 'circle') if g != m for sel in _selected(m)]
    active = [f'{sel} .emh-pts-opt-{m}' for m in COORDINATES_MODES for sel in _selected(m)]
    style = (f'<style>{", ".join(hidden)} {{ display: none; }} '
             f'{", ".join(active)} {{ background-color: #d2edc2; box-shadow: none; }}</style>')

    header = (f'<span style="font-weight:bold;margin-right:8px">Particles: {n}</span>'
              if n else '<span style="color:#666;margin-right:8px">No particles</span>')
    switch = (f'<div style="display:flex;align-items:center">{header}'
              f'<div class="switch-field">{labels}</div></div>')
    return style, switch


def _micrograph_html(mic, coords, values, psd_path=None, max_size=768):
    """HTML with the micrograph thumbnail and the coordinates (x, y in
    micrograph pixels) over it, with a switch to show them as dots, circles
    or not at all, and on the side the PSD (optional) and a table with the
    given (label, value) pairs. """
    from emtools.image import Thumbnail

    micArray = _mrc_2d(mic)
    ys, xs = micArray.shape
    micThumb = Thumbnail.Micrograph(max_size=(max_size, max_size))
    micData = micThumb.from_array(micArray)
    w, h = round(xs / micThumb.scale), round(ys / micThumb.scale)

    # Coordinates scaled to the micrograph display, drawn as dots and as
    # circles (sizes in thumbnail pixels as in the dashboard), the switch
    # shows only one of them
    scaled = [(x / micThumb.scale, y / micThumb.scale) for x, y in coords]
    dots = ''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2"/>' for x, y in scaled)
    circles = ''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="10"/>' for x, y in scaled)
    style, switch = _coordinates_switch(len(coords))

    psd = ''
    if psd_path and os.path.exists(psd_path):
        psdData = Thumbnail.Psd(max_size=(256, 256)).from_array(_mrc_2d(psd_path))
        psd = (f'<img src="data:image/png;base64,{psdData}" alt="PSD" '
               f'style="width:256px;max-width:100%;display:block;margin-bottom:8px"/>')

    values = list(values) + [('Size', f'{xs} x {ys} px')]
    rows = ''.join(f'<tr><td style="padding:2px 12px 2px 0;color:#666">{k}</td>'
                   f'<td style="padding:2px 0;text-align:right">{html.escape(str(v))}</td></tr>'
                   for k, v in values)

    return (
        f'{style}<div style="font-family:sans-serif;font-size:13px">'
        f'{switch}'
        '<div style="display:flex;flex-wrap:wrap;gap:16px;'
        'align-items:flex-start;margin-top:8px">'
        f'<svg viewBox="0 0 {w} {h}" style="max-width:{w}px;width:100%;height:auto;flex:1 1 400px">'
        f'<image href="data:image/png;base64,{micData}" width="{w}" height="{h}"/>'
        f'<g class="emh-pts-dot" fill="{COORDINATES_COLOR}" stroke="none">{dots}</g>'
        f'<g class="emh-pts-circle" fill="none" stroke="{COORDINATES_COLOR}" '
        f'stroke-width="1.5">{circles}</g>'
        '</svg>'
        '<div style="flex:0 0 auto">'
        f'{psd}<table style="border-collapse:collapse">{rows}</table>'
        '</div></div></div>'
    )


def build_micrograph_pane_content(root, row_cells, output_path=None):
    """HTML with the micrograph (and picked coordinates), the PSD and the CTF
    values, similar to the micrograph card in the session dashboard. """
    mic = _require_row_path(root, row_cells, 'micrograph', 'rlnMicrographName', 'Micrograph')
    coords = _coordinates(root, row_cells)
    psd_path = _resolve_data_path(root, row_cells.get('rlnCtfImage', '').replace(':mrc', ''))

    def _value(col, scale=1, decimals=2, unit=''):
        value = _format_value(row_cells.get(col), scale, decimals)
        return f'{value} {unit}'.strip() if value != '' else '-'

    values = [
        ('Defocus U', _value('rlnDefocusU', 1e-4, 2, 'µm')),
        ('Defocus V', _value('rlnDefocusV', 1e-4, 2, 'µm')),
        ('Defocus angle', _value('rlnDefocusAngle', 1, 1, '°')),
        ('Astigmatism', _value('rlnCtfAstigmatism', 1e-4, 3, 'µm')),
        ('Resolution', _value('rlnCtfMaxResolution', 1, 2, 'Å')),
        ('FOM', _value('rlnCtfFigureOfMerit', 1, 3)),
    ]
    return {'kind': 'html', 'title': os.path.basename(mic),
            'html': _micrograph_html(mic, coords, values, psd_path)}


def _ctf_profile_path(root, row_cells):
    """ctffind *_avrot.txt file of the micrograph CTF image."""
    ctf = row_cells.get('rlnCtfImage', '').replace(':mrc', '')
    for suffix in ['.mrc', '.ctf']:
        if ctf.endswith(suffix):
            path = _resolve_data_path(root, ctf[:-len(suffix)] + '_avrot.txt')
            if path and os.path.exists(path):
                return path
    raise Exception(f'CTF profile (*_avrot.txt) not found for: {ctf or "micrograph"}')


def build_ctf_profile_plot_content(root, row_cells):
    """Plot the ctffind rotational average, CTF fit and cross-correlation."""
    path = _ctf_profile_path(root, row_cells)
    with open(path) as f:
        lines = [[float(v) for v in line.split()]
                 for line in f if line.strip() and not line.startswith('#')]
    if len(lines) < max(_CTF_PROFILE_LINES) + 1:
        raise Exception(f'Unexpected CTF profile format: {path}')

    freq = lines[0]
    traces = [{
        'type': 'scatter', 'mode': 'lines', 'x': freq, 'y': lines[i],
        'line': {'width': 1.5}, 'name': name,
    } for i, name in _CTF_PROFILE_LINES.items() if i]

    figure = _build_plotly_scatter_figure(
        traces, xaxis_title=_CTF_PROFILE_LINES[0], yaxis_title='', show_legend=True)
    return {'kind': 'plotly',
            'title': f"CTF — {row_cells.get('micrograph') or os.path.basename(path)}",
            'figure': figure}


def _motion_star_path(root, row_cells):
    """Motion STAR file (MotionCor shifts) of the micrograph: from
    rlnMicrographMetadata or next to the micrograph with .star extension."""
    if path := _resolve_data_path(root, row_cells.get('rlnMicrographMetadata')):
        if os.path.exists(path):
            return path
    if mic := row_cells.get('micrographPath') or row_cells.get('rlnMicrographName'):
        path = _resolve_data_path(root, Path.replaceExt(mic, '.star'))
        if path and os.path.exists(path):
            return path
    raise Exception('Motion metadata (STAR) not found for this micrograph')


def build_micrograph_motion_plot_content(root, row_cells):
    """Plot the global motion trajectory of the micrograph frames (Å)."""
    path = _motion_star_path(root, row_cells)
    with StarFile(path) as sf:
        if 'global_shift' not in sf.getTableNames():
            raise Exception(f'No global_shift table in: {path}')
        general = sf.getTable('general', guessType=False)
        shifts = [(float(r.rlnMicrographShiftX), float(r.rlnMicrographShiftY))
                  for r in sf.iterTable('global_shift', guessType=False)]

    # Shifts are in pixels of the (unbinned) movie
    ps = 1.0
    if general and general.hasColumn('rlnMicrographOriginalPixelSize'):
        ps = float(general[0].rlnMicrographOriginalPixelSize)
    xs = [x * ps for x, _ in shifts]
    ys = [y * ps for _, y in shifts]

    traces = [{
        'type': 'scatter', 'mode': 'lines+markers', 'x': xs, 'y': ys,
        'text': [f'Frame {i}' for i in range(1, len(shifts) + 1)],
        'marker': {'size': 5}, 'line': {'width': 1.5}, 'name': 'Trajectory',
    }]
    figure = _build_plotly_scatter_figure(
        traces, xaxis_title='Shift X (Å)', yaxis_title='Shift Y (Å)')
    figure['layout']['yaxis']['scaleanchor'] = 'x'  # same scale in both axes
    return {'kind': 'plotly',
            'title': f"Motion — {row_cells.get('micrograph') or os.path.basename(path)}",
            'figure': figure}


def load_classes2d(model_star, stack, particles=None, max_size=128):
    """Return the 2D classes of a Relion model STAR file (model_classes
    table), sorted by size, with the averages (base64 PNG) from the
    classes stack. The size is the number of particles of each class,
    computed from the class distribution and the total of particles. The
    selection is read from the '<model_star>.selection' file (list of
    selected class ids), as saved from the session dashboard. """
    import json
    import mrcfile
    from emtools.image import Thumbnail

    selection = []
    if os.path.exists(model_star + '.selection'):
        with open(model_star + '.selection') as f:
            selection = json.load(f)

    thumb = Thumbnail(max_size=(max_size, max_size), output_format='base64')
    classes = []
    with StarFile(model_star) as sf:
        rows = list(sf.iterTable('model_classes', guessType=False))
    with mrcfile.open(stack, permissive=True) as mrc:
        data = mrc.data if mrc.data.ndim == 3 else mrc.data[None, :, :]
        for row in rows:
            cls_id = int(row.rlnReferenceImage.split('@')[0])
            dist = float(row.rlnClassDistribution)
            classes.append({
                'id': cls_id,
                'distribution': dist,
                'size': round(dist * particles) if particles else None,
                'average': thumb.from_array(data[cls_id - 1]),
                'selected': not selection or cls_id in selection,
            })
    classes.sort(key=lambda c: c['distribution'], reverse=True)
    return classes, bool(selection)


def build_classes2d_pane_content(root, row_cells, label=None):
    """HTML with the 2D class averages of a batch (row of a MultiClasses2D),
    sorted by size, similar to the 2D classes in the session dashboard. """
    model = _require_row_path(root, row_cells, 'starFile', 'modelStar', 'Model STAR')
    stack = _resolve_data_path(root, row_cells.get('classesStack'))
    if not stack or not os.path.exists(stack):
        # Same iteration files of the model STAR
        stack = model.replace('_model.star', '_classes.mrcs')
    if not os.path.exists(stack):
        raise Exception(f'Classes stack not found: {row_cells.get("classesStack") or stack}')

    try:
        particles = int(row_cells.get('particles') or 0)
    except (TypeError, ValueError):
        particles = 0
    if not particles:
        if data := _resolve_data_path(root, row_cells.get('dataStar')):
            if os.path.exists(data):
                with StarFile(data) as sf:
                    particles = sf.getTableSize('particles')

    classes, has_selection = load_classes2d(model, stack, particles)
    label = label or row_cells.get('batch') or os.path.basename(os.path.dirname(model))

    def _box(c):
        size = c['size'] if c['size'] is not None else f"{c['distribution'] * 100:0.1f}%"
        opacity = '1' if c['selected'] else '0.35'
        return (
            f'<div style="width:104px;text-align:center;opacity:{opacity}">'
            f'<img src="data:image/png;base64,{c["average"]}" alt="class {c["id"]}" '
            'style="width:100px;height:100px;display:block;margin:0 auto;background:#000"/>'
            f'<div style="font-size:11px;color:#666">size: {size}, id: {c["id"]:03d}</div>'
            '</div>')

    def _summary(items, prefix):
        n = sum(c['size'] or 0 for c in items)
        text = f'<b>{prefix}</b> {len(items)} classes'
        if particles:
            text += f', {n} particles'
        return f'<div style="margin:8px 0 6px 0">{text}</div>'

    def _grid(items):
        return ('<div style="display:flex;flex-wrap:wrap;gap:6px">'
                + ''.join(_box(c) for c in items) + '</div>')

    content = '<div style="font-family:sans-serif;font-size:13px">'
    content += _summary(classes, 'Total:')
    if has_selection:
        selected = [c for c in classes if c['selected']]
        unselected = [c for c in classes if not c['selected']]
        content += _summary(selected, 'Selected:') + _grid(selected)
        content += _summary(unselected, 'Unselected:') + _grid(unselected)
    else:
        content += _grid(classes)
    content += '</div>'

    ps = _format_value(row_cells.get('pixelSize'), 1, 3)
    title = f'2D classes — {label}'
    if ps != '':
        title += f' ({ps} Å/px)'
    return {'kind': 'html', 'title': title, 'html': content}


# ----------------------- Particles -----------------------------------
def _image_name(image_name):
    """Return (index, stack) from a rlnImageName value (e.g. 3@stack.mrcs)."""
    index, _, stack = image_name.partition('@')
    return int(index), stack


def build_particles_table(full_path):
    """Table with one row per micrograph, with its number of particles
    and particles stack. """
    spec = SPA_TABLE_VIEW_SPECS['particles']
    micrographs = {}  # micrograph -> {'particles': n, 'stack': stack}
    total = 0

    with StarFile(full_path) as sf:
        optics = _optics_by_group(sf)
        for row in sf.iterTable('particles', guessType=False):
            total += 1
            mic = micrographs.setdefault(row.rlnMicrographName, {'particles': 0})
            mic['particles'] += 1
            if 'stack' not in mic:
                mic['stack'] = _image_name(row.rlnImageName)[1]

    rows = []
    for i, (micPath, mic) in enumerate(micrographs.items(), 1):
        cells = {
            'index': i,
            'micrograph': os.path.basename(micPath),
            'micrographPath': micPath,
            'particles': mic['particles'],
            'stack': os.path.basename(mic['stack']),
            'stackPath': mic['stack'],
        }
        rows.append({'id': i, 'cells': cells, 'actions': []})

    title = f"{spec['title']} ({total} items, {len(rows)} micrographs"
    if optics:
        if ps := next(iter(optics.values())).get('rlnImagePixelSize'):
            title += f", {float(ps):0.3f} Å/px"
    return {'title': title + ')',
            'columns': _table_view_column_actions(spec),
            'rows': rows}


def _micrograph_particles(root, output_path, mic_path):
    """Rows (dicts) of the particles of a micrograph in the output STAR."""
    full_path = _resolve_data_path(root, output_path) if output_path else None
    if not full_path or not os.path.exists(full_path):
        raise Exception(f'Particles STAR file not found: {output_path}')
    with StarFile(full_path) as sf:
        return [row._asdict() for row in sf.iterTable('particles', guessType=False)
                if row.rlnMicrographName == mic_path]


def build_particles_coordinates_pane_content(root, row_cells, output_path):
    """HTML with the particles coordinates (x, y) over the micrograph. """
    mic = _require_row_path(root, row_cells, 'micrograph', 'rlnMicrographName', 'Micrograph')
    particles = _micrograph_particles(root, output_path, row_cells['micrographPath'])
    coords = [(float(p['rlnCoordinateX']), float(p['rlnCoordinateY']))
              for p in particles if 'rlnCoordinateX' in p]
    values = [('Stack', row_cells.get('stack') or '-')]
    return {'kind': 'html', 'title': f'Particles — {os.path.basename(mic)}',
            'html': _micrograph_html(mic, coords, values)}


def build_particles_grid_pane_content(root, row_cells, output_path, grid=PARTICLES_GRID):
    """Image with a grid of some particles of the micrograph (evenly spaced
    in its list of particles), reading only them from the particles stack. """
    import mrcfile
    import numpy as np
    import PIL.Image
    from emtools.image import Thumbnail

    stack = _require_row_path(root, row_cells, 'stack', 'rlnImageName', 'Particles stack')
    particles = _micrograph_particles(root, output_path, row_cells['micrographPath'])
    indexes = [_image_name(p['rlnImageName'])[0] for p in particles]

    cols, rows = grid
    if len(indexes) > cols * rows:
        indexes = [indexes[int(i)] for i in np.linspace(0, len(indexes) - 1, cols * rows)]

    with mrcfile.mmap(stack, mode='r', permissive=True) as mrc:
        data = mrc.data if mrc.data.ndim == 3 else mrc.data[np.newaxis]
        images = [PIL.Image.fromarray(Thumbnail._array_to_uint8(
                  np.asarray(data[i - 1], dtype=np.float32)))
                  for i in indexes if 0 < i <= data.shape[0]]
    if not images:
        raise Exception(f'No particles found in stack: {row_cells.get("stack")}')

    montage = Thumbnail._montage_grid(images, cols, pad=2)
    thumb = Thumbnail(max_size=(768, 768), output_format='base64')
    return {
        'kind': 'image',
        'title': f'{row_cells.get("stack")} — {len(images)} of {len(particles)} particles',
        'src': f'data:image/png;base64,{thumb.from_pil(montage)}',
        'alt': row_cells.get('stack') or 'Particles',
    }
