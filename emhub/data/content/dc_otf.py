# **************************************************************************
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# **************************************************************************
""" Content functions for the on-the-fly CryoET dashboard.

The dashboard shows one session at a time: a tomo_processing entry whose
extra['data']['processing_path'] points at a RELION 5 project being written
by emwrap while the microscope is still collecting.

    otf_dashboard          the page, rendered once
    otf_dashboard_content  the part that refreshes, fetched over ajax
    otf_tiltseries         per tilt series detail
"""

import os
import re
import time

from PIL import Image

from emhub.data.processing import resolve_processing_path
from emhub.data.processing.otf_cryoet import (
    OtfSession, TiltSeriesMetrics, STAGES, STATUS_OK, STATUS_SUSPECT, STATUS_BAD,
    STATUS_RUNNING, STATUS_FAILED, STATUSES_NEED_REVIEW, COL_TILT_ANGLE,
    COL_PRE_EXPOSURE, COL_MOVIE_INDEX, COL_CTF_CORRELATION, COL_IMAGE_TEXTURE,
    COL_DARK_AREA, COL_MATCH_PEAK, COL_FIELD_SHIFT, _measured, _early_is_total)
from emtools.image.tilt_qc import REASON_LABELS


ENTRY_TYPE = 'tomo_processing'

# How long without a new movie before the session is called stalled rather
# than idle.  A tilt series takes a few minutes, so this is deliberately
# generous; the point is to distinguish "between tilt series" from
# "something broke and nobody noticed".
STALL_SECONDS = 15 * 60

# One colour language across the dashboard: blue is data and interaction,
# green good, amber needs review, red critical (poor data, unusable tilts,
# processing failures), grey waiting or unavailable.  Colour is never the
# only cue: each status also has a shape, as dots and plot markers.
# 'var(--otf-...)' colours are the dashboard's theme variables
# (otf_dashboard.html), so they follow its dark mode.
DATA_COLOR = '#0d6efd'   # blue, for data marks (the theme primary reads purple)
INK_COLOR = 'var(--otf-ink)'   # #2e2f39 in light mode
GOOD_COLOR, REVIEW_COLOR, BAD_COLOR = '#2ec551', '#f59e0b', '#ef172c'
WAITING_COLOR = '#adb5bd'
# The same colours as CSS variables (--otf-data, ...), set once on the page,
# for the CSS and scripts that cannot take them from the data
PALETTE = {'data': DATA_COLOR, 'good': GOOD_COLOR, 'review': REVIEW_COLOR,
           'bad': BAD_COLOR, 'waiting': WAITING_COLOR}
STATUS_STYLE = {
    STATUS_OK:      {'label': 'Good', 'color': GOOD_COLOR,
                     'shape': 'circle', 'order': 3},
    STATUS_SUSPECT: {'label': 'Needs review', 'color': REVIEW_COLOR,
                     'shape': 'triangle', 'order': 1},
    STATUS_BAD:     {'label': 'Poor', 'color': BAD_COLOR,
                     'shape': 'diamond', 'order': 0},
    STATUS_FAILED:  {'label': 'Processing failed', 'color': BAD_COLOR,
                     'shape': 'square', 'order': 0},
    STATUS_RUNNING: {'label': 'Processing', 'color': WAITING_COLOR,
                     'shape': 'ring', 'order': 2},
    None:           {'label': 'No data', 'color': '#d3d3d3',
                     'shape': 'circle', 'order': 4},
}
# The Plotly marker for each shape; the page draws the same shapes in CSS
PLOT_SYMBOL = {'circle': 'circle', 'triangle': 'triangle-up',
               'diamond': 'diamond', 'square': 'square', 'ring': 'circle-open'}

# Short stage names for the pipeline flow at the top of the page; the full
# label is in its tooltip
STAGE_SHORT = {'import': 'Import', 'motioncorr': 'Motion correction',
               'ctf': 'CTF estimation', 'align': 'Alignment',
               'tomogram': 'Tomogram'}

# The four session trends, stacked on a shared x axis.  Each one is
# (key on the TiltSeriesMetrics, stat to take, label, unit, scale, help).
TRENDS = [
    ('motion', 'mean', 'Accumulated motion', 'Å', 1.0,
     'Mean over the tilts of the beam-induced motion in each tilt movie.'),
    ('defocus', 'median', 'Defocus', 'µm', 1e-4,
     'Median defocus over the tilts.'),
    ('ctfRes', 'mean', 'CTF fit resolution', 'Å', 1.0,
     'Mean over the tilts of the resolution the CTF fit reaches; lower is better.'),
    ('shiftRoughness', None, 'Alignment shift roughness', 'Å', 1.0,
     'How irregular the alignment shifts are from one tilt to the next, '
     'ordered by tilt angle. Stage drift is smooth, so a high value suggests '
     'tilts that were mis-registered. Not used for triage until calibrated.'),
]

# Per-tilt strips in the detail view, all sharing the tilt axis:
# (column, label, unit, scale).  All drawn as points: defocus and tilt axis
# have no natural zero, and mixing bars and points in one stack reads as
# different kinds of data.
TILT_STRIPS = [
    ('rlnAccumMotionTotal', 'Accumulated motion', 'Å', 1.0),
    ('rlnAccumMotionEarly', 'Early motion', 'Å', 1.0),
    ('rlnDefocusU', 'Defocus', 'µm', 1e-4),
    ('rlnCtfMaxResolution', 'CTF fit resolution', 'Å', 1.0),
    (COL_CTF_CORRELATION, 'CTF profile correlation', '', 1.0),
    ('rlnCtfFigureOfMerit', 'CTF figure of merit', '', 1.0),
    # Image content, relative to the series where noted (see otf_cryoet)
    (COL_IMAGE_TEXTURE, 'Image texture', '% of series median', 100.0),
    (COL_DARK_AREA, 'Black area above series median', '% of field', 100.0),
    (COL_MATCH_PEAK, 'Match with the tilt before', 'phase correlation', 1.0),
    (COL_FIELD_SHIFT, 'Field shift from first tilt', '% of field', 100.0),
    ('rlnTomoZRot', 'Refined tilt axis', '°', 1.0),
]


def _rolling_median(values, window=7):
    """ Rolling median that keeps None holes, so a gap in the data does not
    shift the line sideways. """
    out = []
    half = window // 2
    for i in range(len(values)):
        chunk = [v for v in values[max(0, i - half):i + half + 1]
                 if v is not None]
        if not chunk:
            out.append(None)
            continue
        chunk.sort()
        n = len(chunk)
        out.append(chunk[n // 2] if n % 2
                   else 0.5 * (chunk[n // 2 - 1] + chunk[n // 2]))
    return out


# What the row fingerprint is drawn from, in order of preference.  CTF fit
# resolution is the most informative, but emwrap does not always report it,
# and a blank column is worse than a less pointed one.  Each entry is
# (column, low, high, label) where low/high bound the drawn range.
FINGERPRINT_SOURCES = [
    ('rlnCtfMaxResolution', 3.0, 11.0, 'CTF fit'),
    ('rlnDefocusU', 15000.0, 60000.0, 'defocus'),
    ('rlnAccumMotionTotal', 0.0, 40.0, 'motion'),
]
# Keys set by TiltSeriesMetrics._judge_tilts in t['reject'] / t['offTarget']
TILT_FLAG_LABELS = dict(REASON_LABELS, ctf='CTF fit', early='early motion')
# The per-tilt flags each detail strip shows.  Each strip is colored by its
# own metric only, so a tilt bad in one metric reads differently from a
# tilt bad in all of them.
STRIP_FLAG_KEYS = {
    'rlnAccumMotionTotal': ('motion',), 'rlnAccumMotionEarly': ('early',),
    'rlnDefocusU': ('defocus', 'astigmatism'),
    'rlnCtfMaxResolution': ('ctf',), COL_CTF_CORRELATION: ('ctfcorr',),
    'rlnCtfFigureOfMerit': ('fom',),
    COL_IMAGE_TEXTURE: ('blank',), COL_DARK_AREA: ('blacked',),
    # A different field also needs a low normalised correlation, so a low
    # peak alone stays blue
    COL_MATCH_PEAK: ('field',), COL_FIELD_SHIFT: ('shifted',),
}


# Tilt QC of one tilt in one metric: within target, off target, unusable,
# as (colour, Plotly marker), the shapes matching the tilt series statuses
TILT_QC_STYLE = {
    'excluded': (STATUS_STYLE[None]['color'], PLOT_SYMBOL['circle']),
    'unusable': (BAD_COLOR, PLOT_SYMBOL['diamond']),
    'offTarget': (REVIEW_COLOR, PLOT_SYMBOL['triangle']),
    'within': (DATA_COLOR, PLOT_SYMBOL['circle']),
}


def _tilt_qc(tilt, keys=None):
    """ excluded (dropped by processing), unusable, offTarget or within,
    judged on the flags in keys only, or on all of them. """
    def flagged(name):
        flags = tilt.get(name, [])
        return bool(flags) if keys is None else any(k in flags for k in keys)
    if tilt.get('excluded'):
        return 'excluded'
    if flagged('reject'):
        return 'unusable'
    if flagged('offTarget'):
        return 'offTarget'
    return 'within'


def _strip_style(tilt, keys):
    return TILT_QC_STYLE[_tilt_qc(tilt, keys)]


def _movie_index(tilt):
    movie = tilt.get(COL_MOVIE_INDEX)
    return None if movie is None else int(movie)


# Which per-tilt target (see TiltSeriesMetrics._judge_tilts) each column has
FINGERPRINT_TARGET_KEY = {'rlnCtfMaxResolution': 'ctf',
                          'rlnAccumMotionTotal': 'motion'}


def _tilt_label(tilt):
    """ A tilt named as everywhere in the tilt series window. """
    parts = []
    if (movie := _movie_index(tilt)) is not None:
        parts.append(f'Movie index {movie}')
    if (angle := tilt.get(COL_TILT_ANGLE)) is not None:
        parts.append(f'tilt {angle + 0.0:.1f}°'.replace('-0.0°', '0.0°'))
    return ' · '.join(parts)


def _dropped_label(tilt):
    """ Where processing dropped a tilt, e.g. 'dropped at alignment'. """
    stage = STAGE_SHORT.get(tilt.get('droppedAt'), 'a later stage')
    return f'dropped at {stage[0].lower()}{stage[1:]}'


def _tilts_tip(ts):
    """ Tooltip for the tilts used: tilts listed at each stage and the
    movies processing dropped (deselected or disabled in Warp, say). """
    if not ts.tiltCounts:
        return ''
    tip = ' → '.join(f'{STAGE_SHORT.get(k, k)} {n}' for k, n in ts.tiltCounts.items())
    dropped = {}
    for t in ts.tilts:
        if t.get('excluded'):
            movie = _movie_index(t)
            name = (f'movie {movie}' if movie is not None
                    else os.path.basename(t.get('rlnMicrographMovieName', '')))
            dropped.setdefault(t.get('droppedAt'), []).append(name)
    for stage, names in dropped.items():
        tip += (f'; {len(names)} dropped at {STAGE_SHORT.get(stage, stage)}: '
                + ', '.join(names))
    return tip


def _natural_key(name):
    """ Sort key that puts TS_2 before TS_10. """
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r'(\d+)', name)]


# Rows per page of the tilt series table
TABLE_PAGE_SIZE = 150

# Table columns that can be sorted by: key -> value of a table row
SORT_KEYS = {
    'name': lambda r: _natural_key(r['tomoName']),
    'status': lambda r: r['statusOrder'],
    'tilts': lambda r: r['nUsed'],
    'motion': lambda r: r['motion'].get('mean'),
    'early': lambda r: r['motionEarly'].get('mean'),
    'defocus': lambda r: r['defocus'].get('median'),
    'ctf': lambda r: r['ctfRes'].get('mean'),
    'axis': lambda r: r['tiltAxis'].get('mean'),
    'roughness': lambda r: r['shiftRoughness'],
    'stage': lambda r: list(STAGES).index(r['stage']) if r['stage'] in STAGES else None,
}


def _stage_dots(ts):
    """ One dot per pipeline stage for the table: done, processing,
    failed or waiting, and a tooltip saying which is which. """
    dots, tip = [], []
    for key, spec in STAGES.items():
        if ts.status == STATUS_FAILED and ts.failedAt == key:
            state = 'failed'
        elif ts.status == STATUS_RUNNING and ts.stage == key:
            state = 'processing'
        elif key in ts.stagesSeen:
            state = 'done'
        else:
            state = 'waiting'
        dots.append(state)
        tip.append(f'{spec["label"]}: {state}')
    return dots, '; '.join(tip)


def _fingerprint_source(ts):
    """ Pick the first fingerprint column that this series actually has,
    skipping the ones written as placeholder zeros. """
    for col, low, high, label in FINGERPRINT_SOURCES:
        if any(_measured(t.get(col), col) is not None for t in ts.tilts):
            return col, low, high, label
    return None


def _fingerprint_svg(ts):
    """ A per-tilt metric as a small inline strip, one step per tilt.

    Drawn server side rather than with a chart library: there is one of
    these per table row and a long session has hundreds of rows.  The
    viewBox is in tilt-index units so every coordinate is a small integer,
    and it is one filled polygon plus a mark per flagged tilt.  Written as
    one rect per tilt it was by far the largest thing in the refreshed
    html; this form is about a fifth of the size.
    """
    source = _fingerprint_source(ts)
    if source is None:
        return ''
    col, low, high, label = source

    tilts = sorted(ts.tilts, key=lambda t: t.get(COL_TILT_ANGLE) or 0)
    n = len(tilts)
    if not n:
        return ''
    span = high - low

    def _y(value):
        return round(100 - min(1.0, max(0.02, (value - low) / span)) * 100)

    pts, marks = [], []
    for i, t in enumerate(tilts):
        value = _measured(t.get(col), col)
        if value is None:
            continue
        y = _y(value)
        pts.append(f'{i},{y} {i + 1},{y}')

        if t.get('excluded'):
            color = WAITING_COLOR     # dropped during processing
        elif t.get('reject'):
            color = STATUS_STYLE[STATUS_BAD]['color']
        elif FINGERPRINT_TARGET_KEY.get(col) in t.get('offTarget', []):
            color = STATUS_STYLE[STATUS_SUSPECT]['color']
        else:
            continue
        marks.append(f'<rect x="{i}" y="{y}" width="1" height="{100 - y}" '
                     f'fill="{color}"/>')

    if not pts:
        return ''

    return (f'<svg width="150" height="22" viewBox="0 0 {n} 100" '
            f'preserveAspectRatio="none" class="otf-fingerprint" '
            f'title="per-tilt {label}">'
            f'<polygon points="0,100 {" ".join(pts)} {n},100" '
            f'fill="{DATA_COLOR}" fill-opacity="0.45"/>'
            f'{"".join(marks)}'
            # Mark the zero tilt, so the shape of the series is readable.
            f'<line x1="{n / 2:.1f}" y1="0" x2="{n / 2:.1f}" y2="100" '
            f'stroke="#8b99a4" stroke-width="0.2" stroke-dasharray="4 4"/>'
            f'</svg>')


def _elapsed_str(seconds):
    if seconds is None:
        return '--'
    seconds = int(seconds)
    if seconds < 60:
        return f'{seconds}s'
    if seconds < 3600:
        return f'{seconds // 60}m'
    return f'{seconds // 3600}h {(seconds % 3600) // 60:02d}m'


def register_content(dc):

    def _resolve_entry(**kwargs):
        """ Find the tomo_processing entry for this dashboard.

        Accepts entry_id / tomo_session_id / otf_entry_id / project_id,
        because the dashboard is reachable both from the tomo project list
        (which passes an entry id) and from a project page (which passes a
        project id).
        """
        dm = dc.app.dm

        for key in ('entry_id', 'tomo_session_id', 'otf_entry_id'):
            if value := kwargs.get(key):
                entry = dm.get_entry_by(id=int(value))
                if entry is not None and entry.type == ENTRY_TYPE:
                    return entry

        # Fall back to the entries of a project, newest first.  A session
        # dashboard needs one entry; if a project has several, the most
        # recently modified one is the session in progress.
        if pid := kwargs.get('project_id'):
            entries = dm.get_entries(
                condition=f"type='{ENTRY_TYPE}' AND project_id={int(pid)}")
            if entries:
                def _mtime(e):
                    path = resolve_processing_path(
                        e.extra.get('data', {}).get('processing_path', ''))
                    pipeline = os.path.join(path or '', 'default_pipeline.star')
                    return (os.path.getmtime(pipeline)
                            if os.path.exists(pipeline) else 0)
                return max(entries, key=_mtime)

        raise Exception(
            'Expecting entry_id of a tomo_processing entry, or a project_id '
            'that contains one.')

    def _session_state(summary):
        """ acquiring / idle / stalled, plus how long since the last movie.

        The most common confusion with an on-the-fly view is not knowing
        whether a flat trend means the microscope stopped, the import worker
        died, or the pipeline is simply between tilt series.  So the state is
        stated rather than left to be inferred.
        """
        last = summary.get('lastImport')
        if last is None:
            return {'key': 'unknown', 'label': 'No imports yet',
                    'since': None, 'sinceStr': '--',
                    'help': 'The import job has not written any output yet.'}
        since = max(0.0, time.time() - last)
        import_status = next((st['jobStatus'] for st in summary['stages']
                              if st['key'] == 'import'), None) or ''
        if import_status.lower() not in ('running', 'scheduled'):
            key, label = 'ended', 'Not acquiring'
            help_text = (f'The import job is not running (status: '
                         f'{import_status or "unknown"}), so no new tilt '
                         f'series will arrive.')
        elif since < 3 * 60:
            key, label = 'acquiring', 'Acquiring'
            help_text = 'A new movie arrived in the last 3 minutes.'
        elif since < STALL_SECONDS:
            key, label = 'idle', 'Idle'
            help_text = ('No new movie for a few minutes: usually the '
                         'microscope moving to the next tilt series.')
        else:
            key, label = 'stalled', 'Stalled'
            help_text = (f'The import job is running but no new movie has '
                         f'arrived for over {STALL_SECONDS // 60} minutes. '
                         f'Check the microscope and the import job.')
        return {'key': key, 'label': label, 'since': since,
                'sinceStr': _elapsed_str(since), 'help': help_text}

    def _trend_series(ts_list):
        """ Build the shared-x data for the four stacked trend plots. """
        x = list(range(1, len(ts_list) + 1))
        names = [t.tomoName for t in ts_list]
        colors = [STATUS_STYLE[t.status]['color'] for t in ts_list]
        symbols = [PLOT_SYMBOL[STATUS_STYLE[t.status]['shape']] for t in ts_list]
        statuses = [STATUS_STYLE[t.status]['label'] for t in ts_list]

        series = []
        for key, stat, label, unit, scale, help_text in TRENDS:
            values = []
            for t in ts_list:
                raw = getattr(t, key, None)
                if isinstance(raw, dict):
                    raw = raw.get(stat)
                values.append(raw * scale if isinstance(raw, float) else None)
            # A metric the pipeline does not report would draw an empty
            # axis, which reads as "measured and flat" rather than "not
            # measured".  Leave it out and say so in the notice instead.
            if not any(v is not None for v in values):
                continue
            series.append({
                'key': key,
                'label': label,
                'unit': unit,
                'help': help_text,
                'y': values,
                'median': _rolling_median(values),
            })
        # x, markers and names are identical for all four plots, so they are
        # sent once rather than four times.
        return {'x': x, 'colors': colors, 'symbols': symbols, 'names': names,
                'statuses': statuses, 'plots': series}

    def _table_rows(ts_list, sort='worst', filter='all', page=1, page_size=TABLE_PAGE_SIZE):
        """ One page of the table, sorted and filtered over all the tilt
        series first, so every row can be reached in order.  Rows are sent
        a page at a time because each carries its fingerprint svg and the
        content is re-sent on every refresh.  Returns the rows, how many
        rows there are in all, the page (kept within range) and the number
        of pages. """
        if filter == 'attn':
            ts_list = [t for t in ts_list if t.status in STATUSES_NEED_REVIEW]
        n_pages = max(1, -(-len(ts_list) // page_size))
        page = min(max(1, page), n_pages)
        rows = []
        for t in ts_list:
            style = STATUS_STYLE[t.status]
            rows.append({
                'ts': t,
                'tomoName': t.tomoName,
                'status': t.status,
                'statusLabel': style['label'],
                'statusColor': style['color'],
                'statusShape': style['shape'],
                'statusOrder': style['order'],
                'reasons': t.reasons,
                'failedAt': t.failedAt,
                'stage': t.stage,
                'stageLabel': STAGES[t.stage]['label'] if t.stage else '',
                'nTilts': t.nTilts,
                'nUsed': t.nUsed,
                'motion': t.motion,
                'motionEarly': t.motionEarly,
                'defocus': t.defocus,
                'ctfRes': t.ctfRes,
                'nCtfOffTarget': t.nCtfOffTarget,
                'nRejected': t.nRejected,
                'tiltAxis': t.tiltAxis,
                'shiftRoughness': t.shiftRoughness,
            })

        column = sort.lstrip('-')
        if sort == 'recent':
            rows.reverse()
        elif column in SORT_KEYS:
            # A column, '-' for descending; rows without a value go last
            # either way
            key = SORT_KEYS[column]
            known = [r for r in rows if key(r) is not None]
            rows = (sorted(known, key=key, reverse=sort.startswith('-'))
                    + [r for r in rows if key(r) is None])
        else:  # worst first, then by how bad the CTF fit is
            rows.sort(key=lambda r: (
                r['statusOrder'],
                -(r['ctfRes'].get('mean') or 0)))
        start = (page - 1) * page_size
        rows_page = rows[start:start + page_size]
        # What only a shown row needs, the svg above all
        for r in rows_page:
            t = r.pop('ts')
            r['stageDots'], r['stageTip'] = _stage_dots(t)
            r['tiltsTip'] = _tilts_tip(t)
            # The page counts the tilts left after curation from these and
            # its selection, which changes without a refresh
            r['usedMovies'] = sorted(m for x in t.tilts if not x.get('excluded')
                                     and (m := _movie_index(x)) is not None)
            r['fingerprint'] = _fingerprint_svg(t)
        return rows_page, len(rows), page, n_pages

    def _load(**kwargs):
        """ Open the session for this entry, or return the reason it failed.

        A dashboard that 500s mid-session is worse than one that explains
        itself, so a missing project, or one that is not a RELION project,
        is reported as content.  The star files are read later, and
        tolerate files being written as they are read (otf_cryoet).
        """
        entry = _resolve_entry(**kwargs)
        data = entry.extra.get('data', {})
        raw_path = data.get('processing_path', '')
        path = resolve_processing_path(raw_path)

        info = {
            'entry': entry,
            'project': dc.app.dm.get_project_by(id=entry.project_id),
            'entry_id': entry.id,
            'title': entry.title or os.path.basename(path or ''),
            'processing_path': raw_path,
            'error': None,
            'session': None,
        }

        if not path or not os.path.exists(path):
            info['error'] = f'Processing path not found: {raw_path}'
            return info
        try:
            info['session'] = OtfSession(
                path, thresholds=data.get('otf_thresholds'))
        except Exception as e:
            info['error'] = str(e)
        return info

    def _staff(project):
        """ Owner and collaborators of the project holding the entry. """
        if project is None:
            return None, []
        users = (dc.app.dm.get_user_by(id=int(uid)) for uid in project.collaborators_ids)
        return project.user, [u for u in users if u is not None]

    def _can_edit(project):
        """ Whether the current user may change the session's selection:
        the project's owner, its collaborators or a manager (the same check
        as the api's otf_save_selection). """
        return project is not None and bool(dc.app.user.can_edit_project(project))

    def _int(kwargs, key, default):
        try:
            return int(kwargs.get(key, default))
        except (TypeError, ValueError):
            return default

    def _selection_state(session):
        """ The stored selection, without its export history. """
        sel = session.selection()
        return {k: sel[k] for k in ('deselected', 'excludedTilts', 'proposedTilts',
                                    'reviewed', 'updated', 'updatedBy')}

    # ---------------------------------------------------------------- page
    @dc.content
    def otf_dashboard(**kwargs):
        # The page around the content; a refresh asks for the content only
        return dict(otf_dashboard_content(**kwargs),
                    refresh_seconds=max(10, _int(kwargs, 'refresh_seconds', 30)),
                    palette=PALETTE, proposalLabels=TILT_FLAG_LABELS)

    # ------------------------------------------------------ refreshed part
    @dc.content
    def otf_dashboard_content(**kwargs):
        info = _load(**kwargs)
        if info['error'] or info['session'] is None:
            # The content shows the error alone
            return {'error': info['error'], 'title': info['title'],
                    'entry_id': info['entry_id'],
                    'processing_path': info['processing_path'],
                    'updated': time.strftime('%H:%M:%S')}

        session = info['session']
        summary = session.summary()
        ts_list = session.tilt_series()
        by_status = summary['byStatus']

        owner, collaborators = _staff(info['project'])

        # Icon color and, for text, a darker shade where the icon color is
        # too light to read on white (the same color in dark mode).
        color = {k: v['color'] for k, v in STATUS_STYLE.items()}
        counters = [
            {'label': 'imported', 'value': summary['nImported'],
             'icon': 'fa-file-import', 'color': INK_COLOR,
             # Series left out of processing (a subset) are not listed
             'note': (f"{summary['nQueued']} selected for processing"
                      if summary['nQueued'] < summary['nImported'] else None)},
            {'label': 'reconstructed', 'value': summary['nProcessed'],
             'icon': 'fa-cube', 'color': DATA_COLOR},
            {'label': 'processing', 'value': by_status.get(STATUS_RUNNING, 0),
             'icon': 'fa-cog', 'color': color[STATUS_RUNNING],
             'text': 'var(--otf-secondary)'},
            {'label': 'needs review', 'value': summary['nNeedALook'],
             'icon': 'fa-exclamation-triangle', 'color': color[STATUS_SUSPECT],
             'text': 'var(--otf-warn-text)'},
            {'label': 'processing failures', 'value': by_status.get(STATUS_FAILED, 0),
             'icon': 'fa-times-circle', 'color': color[STATUS_FAILED]},
        ]

        # Stage bars, with the lag against the previous stage.  The lag is
        # what makes the bottleneck visible: import at 180 and alignment at
        # 40 is obvious here and invisible in a table of counts.  Tilt series
        # the stage failed on are not behind: they will not come, and the
        # next stage never receives them.
        stages = []
        prev_done = None
        for st in summary['stages']:
            # Measured against what the stage's job received, when known: a
            # job run on a subset is not behind on the rest
            base = None if prev_done is None else min(prev_done, st['total'], st['received'] or st['total'])
            lag = None if base is None else max(0, base - st['done'] - st['failed'])
            stages.append(dict(
                st,
                short=STAGE_SHORT.get(st['key'], st['label']),
                lag=lag,
                percent=(100.0 * st['done'] / st['total']) if st['total'] else 0,
                running=(st['jobStatus'] or '').lower() == 'running',
                bottleneck=bool(lag and lag > 8),
            ))
            prev_done = st['done']

        show_early = any(
            t.motionEarly['mean'] is not None and not _early_is_total(
                t.values('rlnAccumMotionEarly'), t.values('rlnAccumMotionTotal'))
            for t in ts_list)

        rows, n_rows_total, page, n_pages = _table_rows(
            ts_list, sort=kwargs.get('sort', 'worst'),
            filter=kwargs.get('filter', 'all'),
            page=_int(kwargs, 'page', 1))
        # The column header names what the fingerprints show, the same on
        # every page
        fingerprint_label = next(
            (src[3] for t in ts_list if (src := _fingerprint_source(t))), None)

        return {
            'error': None,
            'title': info['title'],
            'entry_id': info['entry_id'],
            'processing_path': info['processing_path'],
            'owner': owner.name if owner else '',
            'staff': ', '.join(u.name for u in collaborators),
            'notReported': summary['notReported'],
            'warnings': summary['warnings'],
            'state': _session_state(summary),
            'counters': counters,
            'stages': stages,
            'trends': _trend_series(ts_list),
            'rows': rows,
            'nRowsTotal': n_rows_total,
            'page': page,
            'nPages': n_pages,
            'firstRow': (page - 1) * TABLE_PAGE_SIZE + 1,
            'showEarly': show_early,
            'fingerprintLabel': fingerprint_label,
            'filter': kwargs.get('filter', 'all'),
            'sort': kwargs.get('sort', 'worst'),
            'updated': time.strftime('%H:%M:%S'),
            'legend': [STATUS_STYLE[s] for s in (STATUS_OK, STATUS_SUSPECT,
                                                 STATUS_BAD, STATUS_FAILED,
                                                 STATUS_RUNNING)],
            # Selection: the stored state, every tilt series with its status
            # (the table may show only some), and the statuses to select by
            'selection': _selection_state(session),
            'canEdit': _can_edit(info['project']),
            'allSeries': [{'name': t.tomoName, 'status': t.status} for t in ts_list],
            'selectBy': [dict(STATUS_STYLE[s], key=s) for s in (STATUS_OK, STATUS_SUSPECT,
                                                               STATUS_BAD, STATUS_FAILED)],
        }

    # ---------------------------------------------------------- detail view
    @dc.content
    def otf_tiltseries(**kwargs):
        info = _load(**kwargs)
        tomo_name = kwargs.get('tomo_name')
        if info['error'] or info['session'] is None:
            return {'error': info['error'], 'tomoName': tomo_name,
                    'entry_id': info['entry_id']}

        session = info['session']
        ts = next((t for t in session.tilt_series()
                   if t.tomoName == tomo_name), None)
        if ts is None:
            return {'error': f'No tilt series named {tomo_name}',
                    'tomoName': tomo_name, 'entry_id': info['entry_id']}

        order = kwargs.get('order', 'angle')
        tilts = sorted(
            ts.tilts,
            key=lambda t: (t.get('acqOrder', 0) if order == 'acq'
                           else (t.get(COL_TILT_ANGLE) or 0)))

        th = session.thresholds
        ctf_th = th['ctfMaxResolution']

        def pct(v):       # a limit turned off (None) draws no guide
            return None if v is None else 100 * v
        # Dashed guides per strip: the target and the reject limit.  The CTF
        # target follows the tilt angle, so it is a line rather than a level.
        guides = {
            'rlnAccumMotionTotal': (th['motionTotal']['target'],
                                    th['motionTotal']['reject']),
            'rlnAccumMotionEarly': (th['motionEarly']['flag'], None),
            'rlnCtfMaxResolution': (
                [TiltSeriesMetrics.ctf_target(t.get(COL_TILT_ANGLE), ctf_th)
                 for t in tilts] if None not in (ctf_th.get('lowTarget'), ctf_th.get('highTarget'))
                else None, ctf_th.get('reject')),
            COL_CTF_CORRELATION: (th['ctfCorrelation']['target'],
                                  th['ctfCorrelation']['reject']),
            # In the strips' units (percent where the scale is 100)
            COL_IMAGE_TEXTURE: (None, pct(th['imageTexture'].get('reject'))),
            COL_DARK_AREA: (None, pct(th['darkArea'].get('reject'))),
            COL_MATCH_PEAK: (None, th['neighbourMatch'].get('peak')),
            COL_FIELD_SHIFT: (None, pct(th['fieldShift'].get('reject'))),
        }

        strips = []
        for col, label, unit, scale in TILT_STRIPS:
            # Placeholder zeros are gaps: not measured
            values = [_measured(t.get(col), col) for t in tilts]
            if not any(v is not None for v in values):
                continue   # not measured, or the stage has not run yet
            if col == 'rlnAccumMotionEarly' and _early_is_total(
                    values, [_measured(t.get('rlnAccumMotionTotal'), 'rlnAccumMotionTotal')
                             for t in tilts]):
                continue
            target, reject = guides.get(col, (None, None))
            styles = [_strip_style(t, STRIP_FLAG_KEYS.get(col, ())) for t in tilts]
            strips.append({'key': col, 'label': label, 'unit': unit,
                           'values': [None if v is None else v * scale
                                      for v in values],
                           'colors': [c for c, _ in styles],
                           'symbols': [m for _, m in styles],
                           'target': target, 'reject': reject})

        # One note and one filmstrip entry per tilt, in plot order; a tilt
        # without a jpeg keeps its slot so the strip stays aligned with the
        # plots.
        notes, thumbs = [], []
        # Why the curation rule proposes leaving a tilt out, for the 'auto'
        # tag of the tilts an accepted proposal unticked
        proposal = ts.proposed_exclusions()
        for t in tilts:
            qc = _tilt_qc(t)
            if qc == 'excluded':
                note, border, qc = _dropped_label(t), WAITING_COLOR, 'dropped'
            elif qc == 'unusable':
                note = 'unusable: ' + ', '.join(TILT_FLAG_LABELS[k] for k in t['reject'])
                border = STATUS_STYLE[STATUS_BAD]['color']
            elif qc == 'offTarget':
                note = 'off target: ' + ', '.join(TILT_FLAG_LABELS[k] for k in t['offTarget'])
                border = STATUS_STYLE[STATUS_SUSPECT]['color']
            else:
                note, border = '', 'transparent'
            notes.append(note)

            angle = t.get(COL_TILT_ANGLE)
            ctf_parts = []
            if (d := t.get('rlnDefocusU')) is not None:
                ctf_parts.append(f'defocus {d / 1e4:.2f} µm')
            if (a := t.get('rlnCtfAstigmatism')) is not None:
                ctf_parts.append(f'astigmatism {a / 1e4:.3f} µm')
            if (r := t.get('rlnCtfMaxResolution')) is not None and r > 0:
                ctf_parts.append(f'fit to {r:.1f} Å')
            thumbs.append({
                'ctf': ' · '.join(ctf_parts),
                'image': session.tilt_thumbnail(t),
                'medium': session.tilt_thumbnail(t, 'medium'),
                'ps': session.tilt_thumbnail(t, 'ps'),
                'profile': session.tilt_thumbnail(t, 'ctf'),
                'border': border,
                'dropped': bool(t.get('excluded')),
                # For selecting tilts: the subset job excludes them by movie
                # index from the motion correction output, so a tilt dropped
                # there is not in it and cannot be selected
                'qc': qc,
                'movie': _movie_index(t),
                'proposal': ', '.join(TILT_FLAG_LABELS.get(f, f)
                                      for f in proposal.get(_movie_index(t), [])),
                'selectable': (t.get(COL_MOVIE_INDEX) is not None and
                               t.get('droppedAt') not in ('motioncorr', 'ctf')),
                'label': '' if angle is None else f'{round(angle)}°',
            })
        images = [thumb['image'] for thumb in thumbs if thumb['image']]
        if not images:
            thumbs = []
        # The images of a tilt series share one size; telling the browser
        # lets it lay out the filmstrip before they load, so scrolling to the
        # selected tilt lands on it
        thumb_size = None
        if images:
            try:
                with Image.open(session.join(images[0]['path'])) as im:
                    thumb_size = im.size
            except OSError:
                pass

        stack_tilts = session.aligned_stack_tilts(ts)

        style = STATUS_STYLE[ts.status]
        return {
            'error': None,
            'entry_id': info['entry_id'],
            'tomoName': ts.tomoName,
            'status': ts.status,
            'statusLabel': style['label'],
            'statusColor': style['color'],
            'statusShape': style['shape'],
            'reasons': ts.reasons,
            'notReported': ts.notReported,
            'failedAt': ts.failedAt,
            'nTilts': ts.nTilts,
            'nUsed': ts.nUsed,
            'pixelSize': ts.pixelSize,
            'tsPixelSize': ts.tsPixelSize,
            # The tomogram's voxel, from RELION's binning of the original pixel
            'tomoPixelSize': (ts.pixelSize * ts.tomoBinning
                              if ts.pixelSize and ts.tomoBinning else None),
            # The aligned stack's sections named by their tilt, when the
            # stack's angles tell which is which
            'stackLabels': (None if stack_tilts is None
                            else [_tilt_label(t) for t in stack_tilts]),
            'tiltSeriesStar': ts.tiltSeriesStar,
            'alignedStack': ts.alignedStack,
            'tomogram': ts.tomogram,
            'order': order,
            'strips': strips,
            'xLabel': ('Acquisition order' if order == 'acq'
                       else 'Nominal stage tilt angle (°)'),
            'x': [(t.get('acqOrder', 0) + 1) if order == 'acq'
                  else t.get(COL_TILT_ANGLE) for t in tilts],
            'doses': [t.get(COL_PRE_EXPOSURE) for t in tilts],
            'angles': [t.get(COL_TILT_ANGLE) for t in tilts],
            'movieIndex': [_movie_index(t) for t in tilts],
            'tiltNotes': notes,
            'thumbs': thumbs,
            'thumbSize': thumb_size,
            'hasDropped': any(t.get('excluded') for t in tilts),
            'canEdit': _can_edit(info['project']),
        }
