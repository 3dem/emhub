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
import time

from emhub.data.processing import resolve_processing_path
from emhub.data.processing.otf_cryoet import (
    OtfSession, STAGES, STATUS_OK, STATUS_SUSPECT, STATUS_BAD,
    STATUS_RUNNING, STATUS_FAILED, COL_TILT_ANGLE, COL_PRE_EXPOSURE)


ENTRY_TYPE = 'tomo_processing'

# How long without a new movie before the session is called stalled rather
# than idle.  A tilt series takes a few minutes, so this is deliberately
# generous; the point is to distinguish "between tilt series" from
# "something broke and nobody noticed".
STALL_SECONDS = 15 * 60

STATUS_STYLE = {
    STATUS_OK:      {'label': 'Good', 'color': '#2e9e8f', 'order': 3},
    STATUS_SUSPECT: {'label': 'Suspect', 'color': '#d9a13b', 'order': 1},
    STATUS_BAD:     {'label': 'Poor', 'color': '#c9603f', 'order': 0},
    STATUS_FAILED:  {'label': 'Job failed', 'color': '#a33d22', 'order': 0},
    STATUS_RUNNING: {'label': 'Running', 'color': '#8b99a4', 'order': 2},
    None:           {'label': 'No data', 'color': '#c2c9ce', 'order': 4},
}

# The four session trends, stacked on a shared x axis.  Each one is
# (key on the TiltSeriesMetrics, stat to take, label, unit, scale).
TRENDS = [
    ('motion', 'mean', 'Accumulated motion', 'Å', 1.0),
    ('defocus', 'median', 'Defocus', 'µm', 1e-4),
    ('ctfRes', 'mean', 'CTF fit resolution', 'Å', 1.0),
    ('shiftRoughness', None, 'Alignment shift roughness', 'Å', 1.0),
]

# Per-tilt strips in the detail view, all sharing the tilt axis.
TILT_STRIPS = [
    ('rlnAccumMotionTotal', 'Accumulated motion', 'Å'),
    ('rlnAccumMotionEarly', 'Early motion', 'Å'),
    ('rlnDefocusU', 'Defocus', 'Å'),
    ('rlnCtfMaxResolution', 'CTF fit resolution', 'Å'),
    ('rlnCtfFigureOfMerit', 'CTF figure of merit', ''),
    ('rlnTomoZRot', 'Refined tilt axis', '°'),
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


def _fingerprint_svg(ts, limit=8.0):
    """ Per-tilt CTF fit as a small inline strip, one step per tilt.

    Drawn server side rather than with a chart library: there is one of
    these per table row and a long session has hundreds of rows.  The
    viewBox is in tilt-index units so every coordinate is a small integer,
    and it is one filled polygon plus a mark per flagged tilt.  Written as
    one rect per tilt it was by far the largest thing in the refreshed
    html; this form is about a fifth of the size.
    """
    tilts = sorted(ts.tilts, key=lambda t: t.get(COL_TILT_ANGLE) or 0)
    if not tilts:
        return ''
    n = len(tilts)

    def _y(res):
        return round(100 - min(1.0, max(0.02, (res - 3.0) / limit)) * 100)

    pts, marks = [], []
    for i, t in enumerate(tilts):
        res = t.get('rlnCtfMaxResolution')
        if res is None:
            continue
        y = _y(res)
        pts.append(f'{i},{y} {i + 1},{y}')

        if t.get('excluded'):
            color = STATUS_STYLE[STATUS_BAD]['color']
        elif res > 6.0:
            color = STATUS_STYLE[STATUS_SUSPECT]['color']
        else:
            continue
        marks.append(f'<rect x="{i}" y="{y}" width="1" height="{100 - y}" '
                     f'fill="{color}"/>')

    if not pts:
        return ''

    return (f'<svg width="150" height="22" viewBox="0 0 {n} 100" '
            f'preserveAspectRatio="none" class="otf-fingerprint">'
            f'<polygon points="0,100 {" ".join(pts)} {n},100" '
            f'fill="{STATUS_STYLE[STATUS_OK]["color"]}" fill-opacity="0.55"/>'
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

        Accepts entry_id / tomo_session_id / project_id, because the
        dashboard is reachable both from the tomo project list (which passes
        an entry id) and from a project page (which passes a project id).
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
                    'since': None, 'sinceStr': '--'}
        since = max(0.0, time.time() - last)
        if since < 3 * 60:
            key, label = 'acquiring', 'Acquiring'
        elif since < STALL_SECONDS:
            key, label = 'idle', 'Idle'
        else:
            key, label = 'stalled', 'Stalled'
        return {'key': key, 'label': label, 'since': since,
                'sinceStr': _elapsed_str(since)}

    def _trend_series(ts_list):
        """ Build the shared-x data for the four stacked trend plots. """
        x = list(range(1, len(ts_list) + 1))
        names = [t.tomoName for t in ts_list]
        colors = [STATUS_STYLE[t.status]['color'] for t in ts_list]

        series = []
        for key, stat, label, unit, scale in TRENDS:
            values = []
            for t in ts_list:
                raw = getattr(t, key, None)
                if isinstance(raw, dict):
                    raw = raw.get(stat)
                values.append(raw * scale if isinstance(raw, float) else None)
            series.append({
                'key': key,
                'label': label,
                'unit': unit,
                'y': values,
                'median': _rolling_median(values),
            })
        # x, colours and names are identical for all four plots, so they are
        # sent once rather than four times.
        return {'x': x, 'colors': colors, 'names': names, 'plots': series}

    def _table_rows(ts_list, sort='worst', limit=150):
        rows = []
        for t in ts_list:
            style = STATUS_STYLE[t.status]
            rows.append({
                'tomoName': t.tomoName,
                'status': t.status,
                'statusLabel': style['label'],
                'statusColor': style['color'],
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
                'nTiltsOverCtfLimit': t.nTiltsOverCtfLimit,
                'tiltAxis': t.tiltAxis,
                'shiftRoughness': t.shiftRoughness,
                'fingerprint': _fingerprint_svg(t),
            })

        if sort == 'recent':
            rows.reverse()
        else:  # worst first, then by how bad the CTF fit is
            rows.sort(key=lambda r: (
                r['statusOrder'],
                -(r['ctfRes'].get('mean') or 0)))
        return rows[:limit], len(rows)

    def _load(**kwargs):
        """ Open the session for this entry, or return the reason it failed.

        A dashboard that 500s mid-session is worse than one that explains
        itself, so a missing or half written project is reported as content.
        """
        entry = _resolve_entry(**kwargs)
        data = entry.extra.get('data', {})
        raw_path = data.get('processing_path', '')
        path = resolve_processing_path(raw_path)

        info = {
            'entry': entry.json() if hasattr(entry, 'json') else None,
            'entry_id': entry.id,
            'project_id': entry.project_id,
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

    def _staff(entry):
        """ Owner and collaborators of the project holding this entry. """
        dm = dc.app.dm
        project = dm.get_project_by(id=entry.project_id)
        if project is None:
            return None, []
        owner = project.user
        collaborators = [u for u in getattr(project, 'collaborators', [])]
        return owner, collaborators

    # ---------------------------------------------------------------- page
    @dc.content
    def otf_dashboard(**kwargs):
        info = _load(**kwargs)
        data = {
            'entry_id': info['entry_id'],
            'project_id': info['project_id'],
            'title': info['title'],
            'processing_path': info['processing_path'],
            'error': info['error'],
            'refresh_seconds': int(kwargs.get('refresh_seconds', 30)),
        }
        data.update(otf_dashboard_content(**kwargs))
        return data

    # ------------------------------------------------------ refreshed part
    @dc.content
    def otf_dashboard_content(**kwargs):
        info = _load(**kwargs)
        if info['error'] or info['session'] is None:
            return {
                'error': info['error'],
                'title': info['title'],
                'entry_id': info['entry_id'],
                'summary': None, 'stages': [], 'rows': [], 'nRowsTotal': 0,
                'trends': {'x': [], 'colors': [], 'names': [], 'plots': []},
                'state': {'key': 'unknown', 'label': 'Unavailable',
                          'sinceStr': '--'},
                'counters': [], 'updated': time.strftime('%H:%M:%S'),
            }

        session = info['session']
        summary = session.summary()
        ts_list = session.tilt_series()
        by_status = summary['byStatus']

        owner, collaborators = _staff(
            dc.app.dm.get_entry_by(id=info['entry_id']))

        counters = [
            {'label': 'imported', 'value': summary['nImported']},
            {'label': 'reconstructed', 'value': summary['nProcessed']},
            {'label': 'running',
             'value': by_status.get(STATUS_RUNNING, 0)},
            {'label': 'need a look', 'value': summary['nNeedALook'],
             'color': STATUS_STYLE[STATUS_SUSPECT]['color']},
            {'label': 'job failures',
             'value': by_status.get(STATUS_FAILED, 0),
             'color': STATUS_STYLE[STATUS_FAILED]['color']},
        ]

        # Stage bars, with the lag against the previous stage.  The lag is
        # what makes the bottleneck visible: import at 180 and alignment at
        # 40 is obvious here and invisible in a table of counts.
        stages = []
        prev_done = None
        for st in summary['stages']:
            lag = None if prev_done is None else max(0, prev_done - st['done'])
            stages.append(dict(
                st,
                lag=lag,
                percent=(100.0 * st['done'] / st['total']) if st['total'] else 0,
                bottleneck=bool(lag and lag > 8),
            ))
            prev_done = st['done']

        rows, n_rows_total = _table_rows(
            ts_list, sort=kwargs.get('sort', 'worst'),
            limit=int(kwargs.get('limit', 150)))

        return {
            'error': None,
            'title': info['title'],
            'entry_id': info['entry_id'],
            'processing_path': info['processing_path'],
            'owner': owner.name if owner else '',
            'staff': ', '.join(u.name for u in collaborators),
            'summary': summary,
            'state': _session_state(summary),
            'counters': counters,
            'stages': stages,
            'trends': _trend_series(ts_list),
            'rows': rows,
            'nRowsTotal': n_rows_total,
            'filter': kwargs.get('filter', 'all'),
            'sort': kwargs.get('sort', 'worst'),
            'updated': time.strftime('%H:%M:%S'),
            'status_style': STATUS_STYLE,
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

        strips = []
        for col, label, unit in TILT_STRIPS:
            values = [t.get(col) for t in tilts]
            if not any(v is not None for v in values):
                continue   # stage has not run yet, so leave the strip out
            strips.append({'key': col, 'label': label, 'unit': unit,
                           'values': values})

        style = STATUS_STYLE[ts.status]
        return {
            'error': None,
            'entry_id': info['entry_id'],
            'project_id': info['project_id'],
            'sessionTitle': info['title'],
            'tomoName': ts.tomoName,
            'status': ts.status,
            'statusLabel': style['label'],
            'statusColor': style['color'],
            'reasons': ts.reasons,
            'failedAt': ts.failedAt,
            'stage': ts.stage,
            'nTilts': ts.nTilts,
            'nUsed': ts.nUsed,
            'pixelSize': ts.pixelSize,
            'tsPixelSize': ts.tsPixelSize,
            'tiltSeriesStar': ts.tiltSeriesStar,
            'alignedStack': ts.alignedStack,
            'tomogram': ts.tomogram,
            'metrics': ts.json(),
            'order': order,
            'tilts': tilts,
            'strips': strips,
            'xLabel': ('Acquisition order' if order == 'acq'
                       else 'Nominal stage tilt angle (°)'),
            'x': [(t.get('acqOrder', 0) + 1) if order == 'acq'
                  else t.get(COL_TILT_ANGLE) for t in tilts],
            'doses': [t.get(COL_PRE_EXPOSURE) for t in tilts],
        }
