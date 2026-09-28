# **************************************************************************
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# **************************************************************************
""" Write a synthetic RELION 5 on-the-fly tomography project.

Used to exercise emhub.data.processing.otf_cryoet without access to a real
session.  The layout mirrors what emwrap produces: External/jobNNN folders
for emw-import-ts, emw-warp-mctf, emw-warp-tsalign and emw-warp-ctfrec, a
default_pipeline.star tying them together, one global star file per job and
one per-tilt-series star file per tilt series.

    python -m emhub.tests.make_otf_project /tmp/fake_otf --tilt-series 40
"""

import os
import random
import argparse

from emtools.metadata import StarFile, Table, RelionStar


N_TILTS = 41
TILT_STEP = 3
DOSE_PER_TILT = 3.1
PIXEL_SIZE = 1.3
TS_PIXEL_SIZE = 2.6

JOBS = [
    ('External/job001', 'emw-import-ts', 'Succeeded'),
    ('External/job002', 'emw-warp-mctf', 'Succeeded'),
    ('External/job003', 'emw-warp-tsalign', 'Succeeded'),
    ('External/job004', 'emw-warp-ctfrec', 'Succeeded'),
]

GLOBAL_COLS = [
    'rlnTomoName', 'rlnTomoTiltSeriesStarFile', 'rlnVoltage',
    'rlnSphericalAberration', 'rlnAmplitudeContrast',
    'rlnMicrographOriginalPixelSize', 'rlnTomoHand',
    'rlnOpticsGroupName', 'rlnTomoTiltSeriesPixelSize',
]

TILT_COLS_IMPORT = list(RelionStar.TOMO_FRAME_SERIES_COLUMNS)
TILT_COLS_MCTF = TILT_COLS_IMPORT + [
    'rlnMicrographName', 'rlnMicrographMetadata',
    'rlnAccumMotionTotal', 'rlnAccumMotionEarly', 'rlnAccumMotionLate',
    'rlnCtfImage', 'rlnDefocusU', 'rlnDefocusV', 'rlnCtfAstigmatism',
    'rlnDefocusAngle', 'rlnCtfFigureOfMerit', 'rlnCtfMaxResolution',
    'rlnCtfIceRingDensity',
]
TILT_COLS_ALIGN = TILT_COLS_MCTF + list(RelionStar.TOMO_ALIGNMENT_COLUMNS)


def _dose_symmetric_order(n):
    """ Acquisition order for a dose-symmetric scheme starting at zero. """
    mid = n // 2
    order = [mid]
    for k in range(1, mid + 1):
        if mid + k < n:
            order.append(mid + k)
        if mid - k >= 0:
            order.append(mid - k)
    return order


def _tilt_rows(ts_index, cols, rng):
    """ Per-tilt values, with a session-wide drift so the dashboard has
    something to show: a step at tilt series 40 and a slow degradation
    after 60. """
    drift = max(0.0, (ts_index - 60) / 40.0)
    step = 1.0 if ts_index > 40 else 0.0
    order = _dose_symmetric_order(N_TILTS)
    acq_of = {j: k for k, j in enumerate(order)}

    rows = []
    for j in range(N_TILTS):
        angle = -60 + TILT_STEP * j
        acq = acq_of[j]
        ct = 1.0 / max(0.2, abs(__import__('math').cos(angle * 3.14159 / 180)))
        dose = DOSE_PER_TILT * (acq + 1)

        values = {
            'rlnMicrographMovieName': f'frames/TS_{ts_index+1:04d}_{j:03d}.eer',
            'rlnTomoTiltMovieFrameCount': 8,
            'rlnTomoNominalStageTiltAngle': round(angle, 2),
            'rlnTomoNominalTiltAxisAngle': 85.0,
            'rlnMicrographPreExposure': round(dose, 3),
            'rlnTomoNominalDefocus': -3.0,
        }

        if 'rlnAccumMotionTotal' in cols:
            total = (4.2 + 2.9 * acq / 40 + 1.5 * drift + 0.9 * step) \
                    * (0.85 + 0.3 * rng.random()) * ct ** 0.35
            early = (1.1 + 0.6 * drift) * (0.7 + 0.6 * rng.random())
            defU = 26000 + 3400 * (ts_index % 7) / 7 + angle * 118 \
                   + 900 * (rng.random() - 0.5)
            astig = 420 + 1500 * drift * rng.random()
            res = (3.6 + 1.25 * (ct - 1) + 1.5 * drift + 0.35 * step) \
                  * (0.92 + 0.18 * rng.random())
            values.update({
                'rlnMicrographName': f'{JOBS[1][0]}/tilt_images/TS_{ts_index+1:04d}_{j:03d}.mrc',
                'rlnMicrographMetadata': f'{JOBS[1][0]}/motion/TS_{ts_index+1:04d}_{j:03d}.star',
                'rlnAccumMotionTotal': round(total, 4),
                'rlnAccumMotionEarly': round(early, 4),
                'rlnAccumMotionLate': round(max(0.0, total - early), 4),
                'rlnCtfImage': f'{JOBS[1][0]}/ctf/TS_{ts_index+1:04d}_{j:03d}.ctf:mrc',
                'rlnDefocusU': round(defU, 2),
                'rlnDefocusV': round(defU - astig, 2),
                'rlnCtfAstigmatism': round(astig, 2),
                'rlnDefocusAngle': round(rng.random() * 180, 2),
                'rlnCtfFigureOfMerit': round(0.18 - 0.05 * drift, 4),
                'rlnCtfMaxResolution': round(res, 3),
                'rlnCtfIceRingDensity': round(0.02 + 0.03 * drift, 4),
            })

        if 'rlnTomoXTilt' in cols:
            # Stage drift is smooth: a slow trajectory across tilt angle plus
            # a small amount of jitter, which grows with the session drift.
            # Independent random shifts would make every series look badly
            # aligned, which is not what a real stage does.
            jitter = 1.5 + 12.0 * drift
            values.update({
                'rlnTomoXTilt': 0.0,
                'rlnTomoYTilt': round(angle, 3),
                'rlnTomoZRot': round(85.2 + 1.9 * drift * (rng.random() - 0.3), 3),
                'rlnTomoXShiftAngst': round(
                    38 * __import__('math').sin(angle / 42.0)
                    + jitter * (rng.random() - 0.5), 3),
                'rlnTomoYShiftAngst': round(
                    -24 * __import__('math').cos(angle / 55.0)
                    + jitter * (rng.random() - 0.5), 3),
            })

        rows.append([values.get(c, 0) for c in cols])
    return rows


def write_project(path, n_ts=40, seed=42):
    rng = random.Random(seed)
    os.makedirs(path, exist_ok=True)

    stage_defs = [
        # Filenames and node type labels as emwrap actually writes them.
        (JOBS[0], 'tilt_series.star', TILT_COLS_IMPORT,
         'TomogramGroupMetadata.star.emwrap.TiltSeries'),
        (JOBS[1], 'tilt_series.star', TILT_COLS_MCTF,
         'TomogramGroupMetadata.star.emwrap.TiltSeriesAligned'),
        (JOBS[2], 'aligned_tilt_series.star', TILT_COLS_ALIGN,
         'TomogramGroupMetadata.star.emwrap.tsalign'),
        (JOBS[3], 'tomograms.star', TILT_COLS_ALIGN,
         'TomogramGroupMetadata.star.relion.tomo.Tomograms'),
    ]

    names = [f'TS_{i+1:04d}' for i in range(n_ts)]
    # One tilt series that alignment cannot process, and one still running.
    failed_at_align = names[n_ts // 2] if n_ts > 4 else None

    for (job_id, jobtype, _), star_name, cols, _node in stage_defs:
        job_dir = os.path.join(path, job_id)
        os.makedirs(os.path.join(job_dir, 'tilt_series'), exist_ok=True)

        stage_names = names
        if failed_at_align and jobtype in ('emw-warp-tsalign', 'emw-warp-ctfrec'):
            stage_names = [n for n in names if n != failed_at_align]

        global_table = Table(GLOBAL_COLS)
        for i, name in enumerate(names):
            ts_star = f'{job_id}/tilt_series/{name}.star'
            global_table.addRowValues(
                name, ts_star, 300.0, 2.7, 0.07,
                PIXEL_SIZE, -1, 'optics1', TS_PIXEL_SIZE)

            tilt_table = Table(cols)
            for row in _tilt_rows(i, cols, rng):
                tilt_table.addRowValues(*row)
            with StarFile(os.path.join(path, ts_star), 'w') as sf:
                sf.writeTable(name, tilt_table)

        # Tomogram job also carries the aligned stack and tomogram columns
        if jobtype == 'emw-warp-ctfrec':
            gt = Table(GLOBAL_COLS + ['rlnTiltSeriesAligned',
                                      'rlnTomoReconstructedTomogram',
                                      'rlnTomoTomogramBinning'])
            for i, name in enumerate(stage_names):
                gt.addRowValues(
                    name, f'{job_id}/tilt_series/{name}.star', 300.0, 2.7, 0.07,
                    PIXEL_SIZE, -1, 'optics1', TS_PIXEL_SIZE,
                    f'{JOBS[2][0]}/stacks/{name}.mrcs',
                    f'{job_id}/tomograms/rec_{name}.mrc', 4.0)
            global_table = gt
        elif jobtype == 'emw-warp-tsalign':
            gt = Table(GLOBAL_COLS + ['rlnTiltSeriesAligned'])
            for i, name in enumerate(stage_names):
                gt.addRowValues(
                    name, f'{job_id}/tilt_series/{name}.star', 300.0, 2.7, 0.07,
                    PIXEL_SIZE, -1, 'optics1', TS_PIXEL_SIZE,
                    f'{job_id}/stacks/{name}.mrcs')
            global_table = gt

        with StarFile(os.path.join(job_dir, star_name), 'w') as sf:
            sf.writeTable('global', global_table)

        # Series this stage could not process, as emwrap records them.
        if failed_at_align and jobtype == 'emw-warp-tsalign':
            ft = Table(GLOBAL_COLS + ['rlnTiltSeriesAligned'])
            ft.addRowValues(
                failed_at_align,
                f'{job_id}/tilt_series/{failed_at_align}.star', 300.0, 2.7,
                0.07, PIXEL_SIZE, -1, 'optics1', TS_PIXEL_SIZE, 'None')
            with StarFile(os.path.join(job_dir, 'failed_tilt_series.star'), 'w') as sf:
                sf.writeTable('global', ft)

    _write_pipeline(path, stage_defs)
    return path


def _write_pipeline(path, stage_defs):
    tables = RelionStar.pipeline_tables()

    tables['processes'] = Table(['rlnPipeLineProcessName',
                                 'rlnPipeLineProcessAlias',
                                 'rlnPipeLineProcessTypeLabel',
                                 'rlnPipeLineProcessStatusLabel'])
    for (job_id, jobtype, status), _star, _cols, _node in stage_defs:
        tables['processes'].addRowValues(job_id + '/', 'None', jobtype, status)

    for (job_id, jobtype, _st), star_name, _cols, node_type in stage_defs:
        node = f'{job_id}/{star_name}'
        tables['nodes'].addRowValues(node, node_type, 0)
        tables['output_edges'].addRowValues(job_id + '/', node)
        if jobtype == 'emw-warp-tsalign':
            failed_node = f'{job_id}/failed_tilt_series.star'
            tables['nodes'].addRowValues(
                failed_node, node_type + '-failed', 0)
            tables['output_edges'].addRowValues(job_id + '/', failed_node)

    prev_node = None
    for (job_id, _jt, _st), star_name, _cols, _node in stage_defs:
        if prev_node:
            tables['input_edges'].addRowValues(prev_node, job_id + '/')
        prev_node = f'{job_id}/{star_name}'

    general = Table(['rlnPipeLineJobCounter'])
    general.addRowValues(len(stage_defs) + 1)

    with StarFile(os.path.join(path, 'default_pipeline.star'), 'w') as sf:
        sf.writeTable('pipeline_general', general)
        for name in ('processes', 'nodes', 'input_edges', 'output_edges'):
            sf.writeTable('pipeline_' + name, tables[name])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('path', help='Where to write the fake project')
    p.add_argument('--tilt-series', type=int, default=40, dest='n_ts')
    p.add_argument('--seed', type=int, default=42)
    args = p.parse_args()
    write_project(args.path, n_ts=args.n_ts, seed=args.seed)
    print(f'Wrote fake OTF project with {args.n_ts} tilt series to {args.path}')


if __name__ == '__main__':
    main()
