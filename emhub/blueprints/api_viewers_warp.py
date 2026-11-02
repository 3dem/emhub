"""Table viewer of a Warp/M population (WarpPopulation output).

The table has one row per volume (3D .mrc) of each species of the population
(the sharpened map first). Its panes:

- volume (selecting a row): the volume in emflow's VolumeViewer (scaled to at
  most WARP_MAX_SIZE voxels per side, loaded by the viewer) above the FSC
  curves and the local resolution histogram of its species.
- refinement: the species summary and its refinement history (resolution
  and B-factor of each round, see emhub.data.warp_m.refinement_history).
- series: per tilt series particles, score gain and time of the last M
  refinement (from its logs), to find the series that refine badly.
"""

import html
import os

from emtools.metadata import StarFile, WarpPopulation

from emhub.data.processing import resolve_project_root
from emhub.data import warp_m

from .api_viewers import (
    _resolve_data_path,
    _table_view_action_payload,
    _table_view_column_actions,
    build_volume_viewer_pane_content,
    MAP_VIEWER_CONFIG,
)

# Longest side of the volumes sent to the viewer: the maps of the later
# refinements may be big
WARP_MAX_SIZE = 256

_ACTION_VOLUME = {'id': 'volume', 'label': 'volume', 'column': 'volume'}
_ACTION_REFINEMENT = {'id': 'refinement', 'label': 'refinement'}
_ACTION_SERIES = {'id': 'series', 'label': 'tilt series'}

WARP_TABLE_VIEW_SPECS = {
    'warppopulation': {
        'title': 'Population',
        'columns': [
            {'id': 'species', 'label': 'Species', 'align': 'left', 'sortable': True},
            {'id': 'volume', 'label': 'Volume', 'align': 'left'},
            {'id': 'box', 'label': 'Box', 'align': 'right'},
            {'id': 'pixelSize', 'label': 'Å/px', 'align': 'right'},
            {'id': 'resolution', 'label': 'Resolution (Å)', 'align': 'right', 'sortable': True},
            {'id': 'particles', 'label': 'Particles', 'align': 'right', 'sortable': True},
        ],
        'actions': [_ACTION_VOLUME, _ACTION_REFINEMENT, _ACTION_SERIES],
        # Show the volume (and FSC) when clicking on a row
        'default_action': _ACTION_VOLUME,
    },
}

_FONT = '"Lucida Grande", "Lucida Sans Unicode", Verdana, Arial, Helvetica, sans-serif'

# Highcharts 10 colors, as in the previous FSC plot (create_hc_fscplot)
_FSC_SERIES = [
    ('wrpFSCUnmasked', '#7cb5ec'),
    ('wrpFSCRandomized', '#434348'),
    ('wrpFSCCorrected', '#90ed7d'),
    ('wrpFSCMasked', '#f7a35c'),
]


def resolve_warp_table_view_type(pointer_class, path=None):
    """'warppopulation' for a WarpPopulation output (or a .population file)."""
    key = (pointer_class or '').replace(' ', '').lower()
    if key in WARP_TABLE_VIEW_SPECS:
        return key
    if not key and path and path.endswith('.population'):
        return 'warppopulation'
    return None


def _volume_header(path):
    """ ([X, Y, Z], voxel size) of a 3D MRC, or None for an image/stack. """
    import mrcfile
    try:
        with mrcfile.mmap(path, permissive=True) as mrc:
            shape = mrc.data.shape
            vs = float(mrc.voxel_size.x)
    except Exception:
        return None
    if len(shape) != 3 or shape[0] <= 1:
        return None
    return [int(shape[2]), int(shape[1]), int(shape[0])], (vs if vs > 0 else None)


def _volume_order(name):
    """ The sharpened map first, then the filtered ones, then the others. """
    for i, suffix in enumerate(('_filtsharp', '_filt', '_denoised', '_half1', '_half2')):
        if name.endswith(suffix + '.mrc'):
            return i, name
    return 10, name


def build_warp_population_table(full_path, root):
    """ One row per 3D volume of each species of the population. """
    spec = WARP_TABLE_VIEW_SPECS['warppopulation']
    root_abs = resolve_project_root(root)
    wp = WarpPopulation(full_path)
    folder = os.path.dirname(full_path)
    rows = []
    for species in wp.Species:
        species_file = os.path.join(folder, species['path'])
        species_dir = os.path.dirname(species_file)
        if not os.path.isdir(species_dir):
            continue
        params = warp_m.species_params(species_file)
        name = params.get('Name') or species['name']
        fsc = os.path.join(species_dir, f'{name}_fsc.star')
        stats = warp_m.particles_stats(os.path.join(species_dir, f'{name}_particles.star'))
        row_actions = [_table_view_action_payload(a) for a in (_ACTION_REFINEMENT, _ACTION_SERIES)]
        try:
            resolution = round(float(params.get('GlobalResolution')), 2)
        except (TypeError, ValueError):
            resolution = ''
        volumes = sorted((f for f in os.listdir(species_dir) if f.endswith('.mrc')),
                         key=_volume_order)
        species_cells = {
            'species': name,
            'fscPath': os.path.relpath(fsc, root_abs) if os.path.exists(fsc) else '',
            'pixelSize': params.get('PixelSize', ''),
            'resolution': resolution,
            'particles': stats['total'] if stats else '',
            'populationPath': os.path.relpath(full_path, root_abs),
            'speciesPath': os.path.relpath(species_file, root_abs),
        }
        n_rows = len(rows)
        for volume in volumes:
            path = os.path.join(species_dir, volume)
            header = _volume_header(path)
            if not header:
                continue
            dims, vs = header
            cells = dict(
                species_cells,
                volume=volume,
                volumePath=os.path.relpath(path, root_abs),
                box=' × '.join(str(d) for d in dims) if len(set(dims)) > 1 else f'{dims[0]}³',
                pixelSize=round(vs, 4) if vs else species_cells['pixelSize'],
            )
            rows.append({'id': len(rows) + 1, 'cells': cells, 'actions': row_actions,
                         'defaultAction': _table_view_action_payload(spec['default_action'])})
        if len(rows) == n_rows:
            # No maps (e.g. removed): the species still has its other panes
            rows.append({'id': len(rows) + 1,
                         'cells': dict(species_cells, volume='(no maps)', volumePath='', box=''),
                         'actions': row_actions})

    n = len(wp.Species)
    n_volumes = sum(1 for r in rows if r['cells']['volumePath'])
    title = f"{spec['title']} {wp.Name} ({n} species, {n_volumes} volumes)"
    return {'title': title,
            'columns': _table_view_column_actions(spec),
            'rows': rows}


def build_warp_fsc_plot_content(full_path, title=None):
    """ Plotly FSC curves of a species (its *_fsc.star), with the look of
    the previous Highcharts plot: resolution reversed on X, the 0.5 and
    0.143 thresholds dashed, legend below (as it was in narrow places). """
    table = StarFile.getTableFromFile('', full_path, guessType=False)
    x = []
    ys = {label: [] for label, _ in _FSC_SERIES}
    for row in table:
        try:
            r = float(row.wrpResolution)
        except (TypeError, ValueError):
            continue
        if r < 20:   # also skips the Infinity of the first row
            x.append(r)
            for label, _ in _FSC_SERIES:
                ys[label].append(float(getattr(row, label)))

    traces = [{
        'type': 'scatter',
        'mode': 'lines+markers',
        'name': label,
        'x': x,
        'y': ys[label],
        'line': {'color': color, 'width': 2},
        'marker': {'color': color, 'size': 6},
        'hovertemplate': ('<b>%{fullData.name}</b><br>Resolution: %{x:.2f} Å'
                          '<br>FSC: %{y:.3f}<extra></extra>'),
    } for label, color in _FSC_SERIES]

    def threshold(y):
        return {'type': 'line', 'xref': 'paper', 'x0': 0, 'x1': 1, 'y0': y, 'y1': y,
                'line': {'color': '#999999', 'width': 1, 'dash': 'dash'}}

    return {
        'kind': 'plotly',
        'title': title or os.path.basename(full_path),
        'figure': {
            'data': traces,
            'layout': _layout(
                'Fourier Shell Correlation',
                {'title': {'text': 'Resolution (Å)'}, 'autorange': 'reversed'},
                {'title': {'text': 'FSC'}, 'range': [-0.25, 1.25]},
                shapes=[threshold(0.5), threshold(0.143)],
                # Below the plot, as the Highcharts plot did in narrow places
                # (the plot shares the pane with the volume)
                legend={'orientation': 'h', 'x': 0.5, 'xanchor': 'center',
                        'y': -0.22, 'yanchor': 'top'},
                margin={'l': 64, 'r': 16, 't': 48, 'b': 84}),
        },
    }


def build_warp_pane_content(action_id, root, row_cells):
    """ The pane of an action on a row (see the module doc). """
    if action_id == 'volume':
        return build_warp_volume_pane_content(root, row_cells)
    if action_id == 'refinement':
        return build_warp_refinement_pane_content(root, row_cells)
    if action_id == 'series':
        return build_warp_series_pane_content(root, row_cells)
    raise Exception(f'Action {action_id!r} is not supported for a population')


def build_warp_volume_pane_content(root, row_cells):
    """ The volume of the row (VolumeViewer, loaded by the viewer) above
    the FSC curves and the local resolution of its species. """
    volume = row_cells.get('volumePath')
    if not volume:
        return {'kind': 'empty', 'title': row_cells.get('species', ''),
                'message': 'This species has no maps; see its refinement and tilt series'}
    name = row_cells.get('volume') or os.path.basename(volume)
    try:
        top = build_volume_viewer_pane_content(
            root, volume, title=name, slices=False, density='lazy',
            max_size=WARP_MAX_SIZE, viewer_config=MAP_VIEWER_CONFIG)
    except Exception as e:
        top = {'kind': 'empty', 'title': name, 'message': str(e)}

    species = row_cells.get('species', '')
    fsc = _resolve_data_path(root, row_cells.get('fscPath'))
    if fsc and os.path.exists(fsc):
        res = row_cells.get('resolution')
        title = f'FSC — {species}' + (f' ({res} Å)' if res else '')
        try:
            bottom = build_warp_fsc_plot_content(fsc, title=title)
        except Exception as e:
            bottom = {'kind': 'empty', 'title': 'FSC', 'message': str(e)}
    else:
        bottom = {'kind': 'empty', 'title': 'FSC', 'message': f'No FSC file for {species}'}

    localres = None
    if species_file := _resolve_data_path(root, row_cells.get('speciesPath')):
        bins = warp_m.local_resolution(_species_file_path(species_file, '_localres.star'))
        if bins:
            localres = build_warp_localres_plot_content(bins, title=f'Local resolution — {species}')
    if not localres:
        return {'kind': 'grid', 'title': f'{species} — {name}', 'layout': 'rows',
                'cells': {'top': top, 'bottom': bottom}}
    return {'kind': 'grid', 'title': f'{species} — {name}', 'layout': 'span-top',
            'cells': {'top': top, 'bottomLeft': bottom, 'bottomRight': localres}}


def _species_file_path(species_file, suffix):
    """ A file of a species (e.g. '_particles.star') next to its .species. """
    name = warp_m.species_params(species_file).get('Name') \
        or os.path.splitext(os.path.basename(species_file))[0]
    return os.path.join(os.path.dirname(species_file), f'{name}{suffix}')


def _layout(title, xaxis, yaxis, **kwargs):
    """ Plotly layout with the look of the FSC plot. """
    axis = {'linecolor': '#ccd6eb', 'tickcolor': '#ccd6eb', 'ticks': 'outside',
            'zeroline': False, 'title': {'font': {'color': '#666666'}}}
    return dict({
        'title': {'text': title, 'x': 0.01, 'xanchor': 'left',
                  'font': {'size': 18, 'color': '#333333'}},
        'font': {'family': _FONT, 'size': 12, 'color': '#666666'},
        'xaxis': dict(axis, showgrid=False, **xaxis),
        'yaxis': dict(axis, showgrid=True, gridcolor='#e6e6e6', showline=False, ticks='', **yaxis),
        'margin': {'l': 64, 'r': 16, 't': 48, 'b': 52},
        'plot_bgcolor': '#ffffff',
        'paper_bgcolor': '#ffffff',
    }, **kwargs)


def build_warp_localres_plot_content(bins, title=None):
    """ Bars of the voxels per local resolution (Å, reversed as in the FSC). """
    total = sum(n for _, n in bins) or 1
    # Median local resolution (bins from low to high resolution)
    acc, median = 0, None
    for res, n in bins:
        acc += n
        if median is None and acc >= total / 2:
            median = res
    labels = [f'{res:.2f}' for res, _ in bins]
    return {
        'kind': 'plotly',
        'title': title or 'Local resolution',
        'figure': {
            'data': [{
                'type': 'bar', 'x': labels, 'y': [n for _, n in bins],
                'marker': {'color': '#7cb5ec'},
                'customdata': [round(100 * n / total, 1) for _, n in bins],
                'hovertemplate': 'Resolution: %{x} Å<br>Voxels: %{y} (%{customdata}%)<extra></extra>',
            }],
            'layout': _layout(
                'Local resolution' + (f' (median {median:.2f} Å)' if median else ''),
                {'title': {'text': 'Resolution (Å)'}, 'type': 'category', 'nticks': 10},
                {'title': {'text': 'Voxels'}},
                showlegend=False, bargap=0.05),
        },
    }


def _html_table(columns, rows, align=None):
    """ A small HTML table; columns are labels, rows lists of cell values. """
    align = align or {}
    th = ''.join(f'<th style="text-align:{align.get(i, "left")};padding:3px 8px;'
                 f'border-bottom:1px solid #ccd6eb;white-space:nowrap">{html.escape(str(c))}</th>'
                 for i, c in enumerate(columns))
    trs = ''.join(
        '<tr>' + ''.join(
            f'<td style="text-align:{align.get(i, "left")};padding:2px 8px;'
            f'border-bottom:1px solid #eef1f6;white-space:nowrap">{html.escape(str(v))}</td>'
            for i, v in enumerate(r)) + '</tr>'
        for r in rows)
    return ('<table style="border-collapse:collapse;font-family:sans-serif;font-size:12px">'
            f'<thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>')


def _fmt(value, digits=2):
    return '—' if value is None or value == '' else (
        f'{value:.{digits}f}' if isinstance(value, float) else str(value))


def _row_paths(root, row_cells):
    population = _resolve_data_path(root, row_cells.get('populationPath'))
    species = _resolve_data_path(root, row_cells.get('speciesPath'))
    if not population or not species or not os.path.exists(species):
        raise Exception('Missing population or species file')
    return population, species


def build_warp_refinement_pane_content(root, row_cells):
    """ The summary of the species and its refinement history: the
    resolution and B-factor of each round (plot) and the rounds (table). """
    population, species_file = _row_paths(root, row_cells)
    params = warp_m.species_params(species_file)
    name = params.get('Name', '')
    stats = warp_m.particles_stats(_species_file_path(species_file, '_particles.star'))
    history = warp_m.refinement_history(population, species_file, resolve_project_root(root))

    # Summary
    def p(key, unit=''):
        v = params.get(key)
        return f'{v}{unit}' if v not in (None, '') else '—'
    halves = ''
    if stats and stats['halves']:
        halves = ' (' + ' / '.join(f'{n}' for _, n in sorted(stats['halves'].items())) + ' in the halves)'
    mask = 'manual' if params.get('MaskUseManual') == 'True' else \
        f"automatic (threshold {p('MaskAutoThreshold')}, {p('MaskAutoResolution', ' Å')})"
    summary = [
        ('Species', name),
        ('Resolution', p('GlobalResolution', ' Å')),
        ('B-factor', p('GlobalBFactor', ' Å²')),
        ('Symmetry', p('Symmetry')),
        ('Pixel size', p('PixelSize', ' Å')),
        ('Diameter', p('DiameterAngstrom', ' Å')),
        ('Molecular weight', p('MolecularWeightkDa', ' kDa')),
        ('Particles', f"{stats['total']}{halves}" if stats else '—'),
        ('Tilt series', len(stats['series']) if stats and stats['series'] else '—'),
        ('Temporal samples', f"{p('TemporalResolutionMovement')} (movement), "
                             f"{p('TemporalResolutionRotation')} (rotation)"),
        ('Mask', mask),
        ('Denoised at', p('DenoisedAtResolution', ' Å') if params.get('ApplyDenoising') == 'True' else 'no'),
        ('Version', f"{p('Version')} (previous {p('PreviousVersion')})"),
    ]
    summary_html = _html_table(['', ''], [(k, v) for k, v in summary])

    # History: a point per new map
    with_emwrap = any(s.get('job') for s in history)
    points = [s for i, s in enumerate(history)
              if s['resolution'] is not None
              and (i == 0 or s['version'] != history[i - 1]['version'])]
    labels = [s.get('job', '').split('/')[-1] or s['version'] for s in points]
    hover = ['<br>'.join(filter(None, [s.get('job') or s['version'], s.get('program'),
                                       ' '.join(s.get('refined') or [])]))
             for s in points]
    plot = {
        'kind': 'plotly',
        'title': f'Refinement history — {name}',
        'figure': {
            'data': [
                {'type': 'scatter', 'mode': 'lines+markers', 'name': 'Resolution (Å)',
                 'x': labels, 'y': [s['resolution'] for s in points], 'text': hover,
                 'line': {'color': '#7cb5ec', 'width': 2}, 'marker': {'size': 7},
                 'hovertemplate': '%{text}<br>Resolution: %{y:.2f} Å<extra></extra>'},
                {'type': 'scatter', 'mode': 'lines+markers', 'name': 'B-factor (Å²)', 'yaxis': 'y2',
                 'x': labels, 'y': [s['bfactor'] for s in points], 'text': hover,
                 'line': {'color': '#434348', 'width': 1.5, 'dash': 'dot'}, 'marker': {'size': 5},
                 'hovertemplate': '%{text}<br>B-factor: %{y:.0f} Å²<extra></extra>'},
            ],
            'layout': _layout(
                'Resolution per round',
                {'title': {'text': 'Job' if with_emwrap else 'Species version'}, 'type': 'category'},
                {'title': {'text': 'Resolution (Å)'}},
                yaxis2={'title': {'text': 'B-factor (Å²)', 'font': {'color': '#666666'}},
                        'overlaying': 'y', 'side': 'right', 'showgrid': False, 'zeroline': False},
                legend={'orientation': 'h', 'x': 1, 'xanchor': 'right', 'y': 1.02,
                        'yanchor': 'bottom'},
                margin={'l': 64, 'r': 64, 't': 48, 'b': 52}),
        },
    }

    columns = ['Job', 'Program', 'Options', 'Resolution (Å)', 'B-factor', 'Time', 'Version'] \
        if with_emwrap else ['Version', 'Resolution (Å)', 'B-factor']
    rows = []
    for s in reversed(history):   # latest first
        res, bf = _fmt(s['resolution']), _fmt(s['bfactor'], 0)
        if with_emwrap:
            options = ', '.join(s.get('refined') or []) or (
                'reconstruction only' if s.get('program') == 'M refinement' else '')
            rows.append([s.get('job', ''), s.get('program', ''), options, res, bf,
                         s.get('elapsed', ''), s['version']])
        else:
            rows.append([s['version'], res, bf])
    right = {3: 'right', 4: 'right', 5: 'right'} if with_emwrap else {1: 'right', 2: 'right'}
    history_html = _html_table(columns, rows, right)

    return {'kind': 'grid', 'title': f'Refinement — {name}', 'layout': 'span-top',
            'cells': {
                'top': plot,
                'bottomLeft': {'kind': 'html', 'title': f'Species — {name}', 'html': summary_html},
                'bottomRight': {'kind': 'html', 'title': 'Rounds (latest first)', 'html': history_html},
            }}


def build_warp_series_pane_content(root, row_cells):
    """ Per tilt series of the last M refinement: particles, score gain and
    time (plot and table, the lowest gains first). """
    population, species_file = _row_paths(root, row_cells)
    name = warp_m.species_params(species_file).get('Name', '')
    logs, logs_population = warp_m.find_refinement_logs(population)
    if not logs:
        return {'kind': 'empty', 'title': f'Tilt series — {name}',
                'message': 'No M refinement logs (refinement_temp/logs) for this population'}
    stats = warp_m.particles_stats(_species_file_path(species_file, '_particles.star'))
    rows = warp_m.series_refinement(logs, stats['series'] if stats else None)
    rows = [r for r in rows if r['gain'] is not None]
    if not rows:
        return {'kind': 'empty', 'title': f'Tilt series — {name}',
                'message': 'The refinement logs have no scores'}
    rows.sort(key=lambda r: r['gain'])
    job = os.path.dirname(os.path.dirname(logs_population))
    source = os.path.relpath(job, resolve_project_root(root))
    plot = {
        'kind': 'plotly',
        # The job of the logs (an emwrap job: e.g. WarpMCore/job088)
        'title': 'Tilt series refinement' + (
            f' — {source}' if os.path.exists(os.path.join(job, 'job.star')) else ''),
        'figure': {
            'data': [{
                'type': 'scatter', 'mode': 'markers',
                'x': [r['particles'] for r in rows], 'y': [r['gain'] for r in rows],
                'text': [r['name'] for r in rows],
                'marker': {'size': 7, 'color': [r['seconds'] for r in rows],
                           'colorscale': 'Viridis', 'showscale': True,
                           'colorbar': {'title': {'text': 'Time (s)'}, 'thickness': 12},
                           'line': {'width': 0.5, 'color': '#434348'}},
                'hovertemplate': ('<b>%{text}</b><br>Particles: %{x}<br>'
                                  'Score gain: %{y:.2f}%<br>Time: %{marker.color:.0f} s<extra></extra>'),
            }],
            'layout': _layout(
                f'Score gain per tilt series ({len(rows)} series)',
                {'title': {'text': 'Particles'}},
                {'title': {'text': 'Score gain (%)'}},
                showlegend=False),
        },
    }
    table = _html_table(
        ['Tilt series', 'Particles', 'Start score', 'Final score', 'Gain (%)', 'Time (s)'],
        [[r['name'], _fmt(r['particles']), _fmt(r['start'], 1), _fmt(r['final'], 1),
          _fmt(r['gain']), _fmt(r['seconds'], 0)] for r in rows],
        {1: 'right', 2: 'right', 3: 'right', 4: 'right', 5: 'right'})
    return {'kind': 'grid', 'title': f'Tilt series — {name}', 'layout': 'rows',
            'cells': {
                'top': plot,
                'bottom': {'kind': 'html', 'title': 'Tilt series (lowest gain first)', 'html': table},
            }}
