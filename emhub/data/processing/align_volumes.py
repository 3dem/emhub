# **************************************************************************
# *
# * Authors:     Daniel Marchan (danielmarchan3@gmail.com)
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

"""Results of an emw-align-volumes job (the references of a multi-reference
3D classification, aligned to a map in the frame of the particle poses) for
emflow's table viewer, from the job's alignment.star:

  - Overall: the cross-correlation (CC) of each reference with the map
    before and after the alignment, and of the next best solution (the best
    fit in another orientation, more than twice the angular step away: if
    its CC is close, the fit is ambiguous).
  - Similarity: the CC of every pair of references (and with the map of
    the poses), how similar the classes are. Jobs before the 'similarity'
    table: computed here from the written references (needs emwrap).
  - All references: the map of the poses (or the first reference) in the 3D
    volume viewer with every reference drawn over it, each one shown or
    hidden in its Maps panel.
  - A row per reference (class): its class number, name, input volume, CC
    before and after, rotation and shift; its 'volumes' shows the map of the
    poses, the reference and the input volume as it was.

    data = load_align_volumes(root, job_dir)
    table = build_align_volumes_table(data, title)
    pane = build_align_volumes_pane(root, data, action_id, row_cells)
"""

import os

from emtools.metadata import StarFile

from . import project_file_path

ALIGNMENT_STAR = 'alignment.star'
ACTION_OVERALL = {'id': 'overall', 'label': 'plots'}
ACTION_VOLUMES = {'id': 'volumes', 'label': 'volumes'}
ACTION_SIMILARITY = {'id': 'similarity', 'label': 'matrix'}
ACTION_ALL = {'id': 'all', 'label': '3D'}
OVERALL_ROW = 'overall'
SIMILARITY_ROW = 'similarity'
ALL_ROW = 'all'
SHOW_COLUMN = 'show'
# The next solution is close: the fit is ambiguous (e.g. a flat membrane,
# that can turn in its plane)
AMBIGUOUS_CC = 0.02

_MARGIN = {'l': 64, 'r': 24, 't': 24, 'b': 64}
# Sequential blue, light (low CC) to dark (high CC)
_CC_COLORSCALE = [[0, '#cde2fb'], [0.25, '#86b6ef'], [0.5, '#3987e5'],
                  [0.75, '#1c5cab'], [1, '#0d366b']]


def _float(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v


class AlignVolumes:
    def __init__(self, general, references, similarity=None):
        self.general = general  # dict of the 'general' table
        self.references = references  # [dict] of the 'references' table, class order
        # {(class a, class b): CC} of the 'similarity' table (jobs before it: {})
        self.similarity = similarity or {}

    @property
    def aligned(self):
        """ True if the volumes were aligned to a map (the CC columns). """
        return bool(self.general.get('emwAlignReference'))

    def get(self, class_number):
        for r in self.references:
            if str(r.get('rlnClassNumber')) == str(class_number):
                return r
        raise Exception(f'No reference of class {class_number!r}')


def can_compute_similarity():
    """ True if the similarity of the references can be computed here
    (emwrap, for jobs whose alignment.star has no 'similarity' table). """
    try:
        from emwrap.base import volume_align  # noqa: F401
    except ImportError:
        return False
    return True


def compute_similarity(root, data):
    """ {(class a, class b): CC} of the references, as emw-align-volumes
    computes it (low-passed and masked as the alignment, with the job's
    emwLowpass and emwMaskDiameter; else 25 Å and 90% of the box), for the
    jobs before the 'similarity' table. Kept in data.similarity. """
    if data.similarity:
        return data.similarity
    # Imported here: emwrap is only needed by the jobs before the table
    from emwrap.base import volume_align as va
    from emwrap.base.align_volumes import read_volume

    classes = [int(r.get('rlnClassNumber')) for r in data.references]
    volumes = [read_volume(project_file_path(root, r.get('rlnReferenceImage')))
               for r in data.references]
    angpix = _float(data.general.get('emwPixelSize')) or volumes[0][1]
    grid = va.SearchGrid(volumes[0][0], angpix, _float(data.general.get('emwLowpass')) or 25.0,
                         _float(data.general.get('emwMaskDiameter')))
    m = va.similarity_matrix(grid, [v for v, _ in volumes])
    data.similarity = {(a, b): round(float(m[i, j]), 4)
                       for i, a in enumerate(classes) for j, b in enumerate(classes)}
    return data.similarity


def load_align_volumes(root, job_dir):
    path = os.path.join(job_dir, ALIGNMENT_STAR)
    with StarFile(path) as sf:
        tables = sf.getTableNames()
        general = sf.getTable('general') if 'general' in tables else None
        references = sf.getTable('references')
        similarity = {}
        if 'similarity' in tables:
            for row in sf.iterTable('similarity'):
                similarity[(int(row.emwClassA), int(row.emwClassB))] = float(row.emwCc)
    general = general[0]._asdict() if general and len(general) else {}
    return AlignVolumes(general, [row._asdict() for row in references], similarity)


def _round(value, digits=3):
    v = _float(value)
    return None if v is None else round(v, digits)


def _shift_text(r):
    shift = [_float(r.get(f'emwShift{a}Angst')) or 0.0 for a in 'XYZ']
    norm = sum(s * s for s in shift) ** 0.5
    return f'{norm:0.1f}' if norm >= 0.05 else '0'


def _next_text(r):
    cc, angle = _float(r.get('emwNextCc')), _float(r.get('emwNextAngle'))
    if cc is None or cc < 0:
        return ''
    return f'{cc:0.3f} at {angle:0.0f}°'


def _status(r, aligned):
    if not int(_float(r.get('emwAligned')) or 0):
        return 'kept' if aligned else 'copied'
    cc, nxt = _float(r.get('emwCcAfter')), _float(r.get('emwNextCc'))
    if cc is not None and nxt is not None and nxt >= 0 and cc - nxt < AMBIGUOUS_CC:
        return 'aligned (ambiguous)'
    return 'aligned'


def build_align_volumes_table(data, title):
    """ TableViewerData with the Overall row (its plot shown when the table is
    opened) and a row per reference. """
    # Widths in px (the table shares the pane width in these proportions):
    # the 2nd best fit ('0.609 at 180°') is the longest value
    columns = [
        {'id': 'cls', 'label': 'Class', 'align': 'left', 'width': 110},
        {'id': 'name', 'label': 'Name', 'align': 'left', 'width': 130},
        {'id': 'source', 'label': 'Input volume', 'align': 'left', 'width': 130},
        {'id': 'status', 'label': 'Alignment', 'align': 'left', 'width': 120},
    ]
    if data.aligned:
        columns += [
            {'id': 'ccBefore', 'label': 'CC before', 'align': 'right', 'sortable': True, 'width': 80},
            {'id': 'ccAfter', 'label': 'CC after', 'align': 'right', 'sortable': True, 'width': 80},
            {'id': 'rotation', 'label': 'Rotation (°)', 'align': 'right', 'sortable': True,
             'width': 90},
            {'id': 'shift', 'label': 'Shift (Å)', 'align': 'right', 'sortable': True, 'width': 75},
            # The best fit in another orientation: its CC and its angle to the best
            {'id': 'next', 'label': '2nd best fit', 'align': 'right', 'width': 140},
        ]
    columns.append({'id': SHOW_COLUMN, 'label': 'Show', 'align': 'left', 'width': 80})

    rows = []
    if data.aligned:
        rows.append({'id': OVERALL_ROW, 'cells': {'cls': 'Overall'}, 'actions': [],
                     'defaultAction': dict(ACTION_OVERALL),
                     'cellContexts': {SHOW_COLUMN: {'actions': [dict(ACTION_OVERALL)]}}})
    if len(data.references) > 1 and (data.similarity or can_compute_similarity()):
        rows.append({'id': SIMILARITY_ROW, 'cells': {'cls': 'Similarity'}, 'actions': [],
                     'defaultAction': dict(ACTION_SIMILARITY),
                     'cellContexts': {SHOW_COLUMN: {'actions': [dict(ACTION_SIMILARITY)]}}})
    if len(data.references) > 1 or data.aligned:
        rows.append({'id': ALL_ROW, 'cells': {'cls': 'All references'}, 'actions': [],
                     'defaultAction': dict(ACTION_ALL),
                     'cellContexts': {SHOW_COLUMN: {'actions': [dict(ACTION_ALL)]}}})
    for r in data.references:
        k = r.get('rlnClassNumber')
        source = r.get('emwSourceImage', '')
        if int(_float(r.get('emwResampled')) or 0):
            source += (f" ({r.get('emwSourceBoxSize')} px, "
                       f"{_float(r.get('emwSourcePixelSize')):0.2f} Å/px)")
        cells = {
            'cls': k,
            'name': r.get('emwReferenceName', ''),
            'source': source,
            'status': _status(r, data.aligned),
            'ccBefore': _round(r.get('emwCcBefore')),
            'ccAfter': _round(r.get('emwCcAfter')),
            'rotation': _round(r.get('emwRotationAngle'), 1),
            'shift': _shift_text(r),
            'next': _next_text(r),
        }
        rows.append({'id': f'class{k}', 'cells': cells, 'actions': [],
                     'defaultAction': dict(ACTION_VOLUMES),
                     'cellContexts': {SHOW_COLUMN: {'actions': [dict(ACTION_VOLUMES)]}}})

    g = data.general
    info = f'{len(data.references)} references'
    if (box := g.get('emwBoxSize')) and (ps := _float(g.get('emwPixelSize'))):
        info += f', {box} px, {ps:0.3f} Å/px'
    if data.aligned:
        info += f", aligned to {g.get('emwAlignReference')}"
    first = rows[0]
    return {'title': f'{title} ({info})', 'columns': columns, 'rows': rows,
            'initialAction': {'rowId': first['id'],
                              'actionId': first['defaultAction']['id']}}


def build_overall_pane(data):
    """ CC with the map of each reference before and after the alignment,
    and of the next best solution (close to the best: an ambiguous fit). """
    xs = [f"{r.get('rlnClassNumber')}: {r.get('emwReferenceName', '')}"
          for r in data.references]

    def _values(key):
        values = [_float(r.get(key)) for r in data.references]
        return [None if v is None or v < -1 else v for v in values]

    nxt = [v if v is not None and v >= 0 else None for v in _values('emwNextCc')]
    traces = [
        {'type': 'bar', 'name': 'Before', 'x': xs, 'y': _values('emwCcBefore'),
         'hovertemplate': '%{x}: %{y:.3f}<extra>before</extra>'},
        {'type': 'bar', 'name': 'After', 'x': xs, 'y': _values('emwCcAfter'),
         'hovertemplate': '%{x}: %{y:.3f}<extra>after</extra>'},
        {'type': 'scatter', 'mode': 'markers', 'name': 'Next solution', 'x': xs,
         'y': nxt, 'marker': {'symbol': 'line-ew-open', 'size': 22, 'line': {'width': 2}},
         'hovertemplate': '%{x}: %{y:.3f}<extra>next solution</extra>'},
    ]
    layout = {'barmode': 'group', 'margin': _MARGIN,
              'yaxis': {'title': {'text': 'CC with the map of the poses'}},
              'legend': {'orientation': 'h', 'y': 1.08}}
    title = f"Alignment to {data.general.get('emwAlignReference')}"
    return {'kind': 'plotly', 'title': title, 'figure': {'data': traces, 'layout': layout}}


def map_class(data):
    """ The class number of the reference that is the map of the poses
    itself (its input, kept as it is), or None. """
    ref = os.path.normpath(str(data.general.get('emwAlignReference') or ''))
    if not data.aligned:
        return None
    for r in data.references:
        if (not int(_float(r.get('emwAligned')) or 0)
                and os.path.normpath(str(r.get('emwSourceImage') or '')) == ref):
            return int(r.get('rlnClassNumber'))
    return None


def build_similarity_pane(data):
    """ Heatmap of the CC of every pair of references (low-passed and masked
    as in the alignment), and with the map of the poses (CC after) if they
    were aligned: a reference that is the map is 'Class k (ref)', else the
    map is a row and column of its own. Short labels on the axes, the names
    in the hover. """
    classes = [int(r.get('rlnClassNumber')) for r in data.references]
    ref_class = map_class(data)
    labels = [f"Class {k}" + (' (ref)' if k == ref_class else '') for k in classes]
    names = [r.get('emwReferenceName', '') for r in data.references]
    z = [[data.similarity.get((a, b)) for b in classes] for a in classes]
    if data.aligned and ref_class is None:
        to_map = [_float(r.get('emwCcAfter')) for r in data.references]
        labels = ['Map (ref)'] + labels
        names = [str(data.general.get('emwAlignReference'))] + names
        z = [[1.0] + to_map] + [[cc] + row for cc, row in zip(to_map, z)]
    hover = [[f'{labels[i]}: {names[i]}<br>{labels[j]}: {names[j]}' for j in range(len(labels))]
             for i in range(len(labels))]

    values = [v for row in z for v in row if v is not None]
    zmin = max(0.0, int(min(values) * 10) / 10) if values else 0.0
    trace = {
        'type': 'heatmap', 'x': labels, 'y': labels, 'z': z,
        'zmin': zmin, 'zmax': 1.0, 'colorscale': _CC_COLORSCALE,
        'texttemplate': '%{z:.2f}', 'xgap': 2, 'ygap': 2, 'text': hover,
        'colorbar': {'title': {'text': 'CC'}, 'thickness': 12},
        'hovertemplate': '%{text}<br>CC %{z:.3f}<extra></extra>',
    }
    layout = {'margin': {'l': 110, 'r': 24, 't': 24, 'b': 64},
              'xaxis': {'side': 'bottom'},
              'yaxis': {'autorange': 'reversed', 'scaleanchor': 'x'}}
    g = data.general
    title = 'CC of the references with each other'
    if (lowpass := _float(g.get('emwLowpass'))) and (d := _float(g.get('emwMaskDiameter'))):
        title += f' (low-pass {lowpass:0.0f} Å, mask {d:0.0f} Å)'
    return {'kind': 'plotly', 'title': title, 'figure': {'data': [trace], 'layout': layout}}


def build_reference_volumes_pane(root, data, class_number):
    """ The map of the poses, the reference (aligned) and the input volume as
    it was, side by side (only the reference if it was not aligned). """
    # Imported here: the viewers are in the blueprints, that import this package
    from emhub.blueprints.api_viewers import (build_volume_viewer_pane_content,
                                              MAP_VIEWER_CONFIG)
    from emhub.blueprints.api_viewers_spa import CLASS3D_MAX_VOXELS

    r = data.get(class_number)
    name = r.get('emwReferenceName', '')
    aligned = int(_float(r.get('emwAligned')) or 0)
    cells = []
    if data.aligned:
        cells.append(('Map of the poses', data.general.get('emwAlignReference')))
    ref_title = f'Class {class_number}: {name}'
    if aligned and (cc := _float(r.get('emwCcAfter'))) is not None:
        ref_title += f' — aligned, CC {cc:0.3f}'
    cells.append((ref_title, r.get('rlnReferenceImage')))
    if aligned or int(_float(r.get('emwResampled')) or 0):
        title = 'Input volume'
        if (cc := _float(r.get('emwCcBefore'))) is not None:
            title += f', CC {cc:0.3f}'
        cells.append((title, r.get('emwSourceImage')))

    max_voxels = CLASS3D_MAX_VOXELS // len(cells)

    def _cell(title, volume):
        content = build_volume_viewer_pane_content(
            root, volume, title=title, slices=False, density='inline',
            max_voxels=max_voxels, viewer_config=MAP_VIEWER_CONFIG)
        dims = content.get('dimensions') or []
        if dims:
            box = f'{dims[0]}³' if len(set(dims)) == 1 else ' × '.join(map(str, dims))
            content['title'] = f'{title} · {box}'
        content['compact'] = True
        return content

    title = f'Class {class_number}: {name}'
    if len(cells) == 1:
        return dict(_cell(*cells[0]), title=title)
    slots = {2: ('left', 'right'), 3: ('topLeft', 'topRight', 'bottom')}[len(cells)]
    layout = 'cols' if len(cells) == 2 else 'span-bottom'
    return {'kind': 'grid', 'title': title, 'layout': layout,
            'cells': {slot: _cell(t, v) for slot, (t, v) in zip(slots, cells)}}


def build_all_references_pane(root, data):
    """ The map of the poses (the first reference without alignment) with
    every reference over it, in the 3D volume tab. """
    from emhub.blueprints.api_viewers import build_overlays_pane_content

    refs = [(f"Class {r.get('rlnClassNumber')}", r.get('rlnReferenceImage'))
            for r in data.references]
    if data.aligned:
        main, main_label = data.general.get('emwAlignReference'), 'Map of the poses'
        title = f'The references over the map of the poses ({main})'
        # A reference that is the map itself: not drawn twice
        if (k := map_class(data)) is not None:
            main_label = f'Class {k} (ref)'
            refs = [(label, path) for (label, path), r in zip(refs, data.references)
                    if int(r.get('rlnClassNumber')) != k]
    else:
        (main_label, main), refs = refs[0], refs[1:]
        title = f'The references over class 1 ({main})'
    return build_overlays_pane_content(root, main, refs, title=title, main_label=main_label)


def build_align_volumes_pane(root, data, action_id, row_cells):
    if action_id == ACTION_OVERALL['id']:
        return build_overall_pane(data)
    if action_id == ACTION_SIMILARITY['id']:
        compute_similarity(root, data)
        return build_similarity_pane(data)
    if action_id == ACTION_ALL['id']:
        return build_all_references_pane(root, data)
    if action_id == ACTION_VOLUMES['id']:
        return build_reference_volumes_pane(root, data, row_cells.get('cls'))
    raise Exception(f'Unknown action {action_id!r}')
