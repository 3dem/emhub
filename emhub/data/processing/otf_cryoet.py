# **************************************************************************
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# **************************************************************************
""" Reader for on-the-fly CryoET sessions.

Walks a RELION 5 tomography project, locates the jobs of the OTF pipeline
(import -> motion correction -> CTF -> tilt series alignment -> tomogram)
and computes the metrics needed by the OTF dashboard.

Nothing in this module depends on Flask, so it can be used from a worker,
a script or the test suite.  Run it standalone for a quick check:

    python -m emhub.data.processing.otf_cryoet /path/to/project
"""

import os
import sys
import json
import math
import argparse
from glob import glob
from collections import OrderedDict

from emtools.metadata import StarFile, RelionStar


# --------------------------------------------------------------------------
# Pipeline definition
# --------------------------------------------------------------------------
# Stages are ordered: each one consumes the output of the previous.  The job
# types are the ones emwrap registers in default_pipeline.star.  Alternative
# job types for the same stage are listed together, so a project that used
# emw-warp-aretomo instead of emw-warp-tsalign still resolves.
STAGES = OrderedDict([
    ('import',    {'label': 'Tilt series movies imported',
                   'jobtypes': ['emw-import-ts']}),
    ('motioncorr', {'label': 'Motion correction',
                    'jobtypes': ['emw-warp-mctf']}),
    ('ctf',        {'label': 'CTF estimation',
                    'jobtypes': ['emw-warp-mctf']}),
    ('align',      {'label': 'Tilt series alignment',
                    'jobtypes': ['emw-warp-tsalign', 'emw-warp-aretomo']}),
    ('tomogram',   {'label': 'Tomogram reconstruction',
                    'jobtypes': ['emw-warp-ctfrec']}),
])

# emw-warp-mctf does motion correction and CTF in one job, so both stages
# point at it.  Keep the distinction in the UI: the metrics differ.
SHARED_STAGE_JOBS = {'motioncorr', 'ctf'}

# The global star file each emwrap job writes.  The pipeline output nodes are
# the primary source; this is the fallback for a job that has produced its
# star file but has not registered the node yet, which happens while the job
# is still running -- exactly the case the dashboard cares about.
JOB_OUTPUT_STAR = {
    'emw-import-ts': 'tilt_series.star',
    'emw-warp-mctf': 'tilt_series.star',
    'emw-warp-tsalign': 'aligned_tilt_series.star',
    'emw-warp-aretomo': 'aligned_tilt_series.star',
    'emw-warp-ctfrec': 'tomograms.star',
}

# Every emwrap tilt series job writes the series it could not process to a
# separate star file, so a per tilt series failure is recorded explicitly
# rather than inferred from missing output.
FAILED_STAR = 'failed_tilt_series.star'

# RELION 5 per-tilt columns we read.  Everything is optional: a job that did
# not run yet simply leaves the column out, and the metric comes back as None.
COL_TILT_ANGLE = 'rlnTomoNominalStageTiltAngle'
COL_PRE_EXPOSURE = 'rlnMicrographPreExposure'
COL_MICROGRAPH = 'rlnMicrographName'

MOTION_COLS = ['rlnAccumMotionTotal', 'rlnAccumMotionEarly', 'rlnAccumMotionLate']
CTF_COLS = ['rlnDefocusU', 'rlnDefocusV', 'rlnCtfAstigmatism',
            'rlnCtfMaxResolution', 'rlnCtfFigureOfMerit', 'rlnCtfIceRingDensity']
ALIGN_COLS = ['rlnTomoXTilt', 'rlnTomoYTilt', 'rlnTomoZRot',
              'rlnTomoXShiftAngst', 'rlnTomoYShiftAngst']

# Global (per tilt series) columns.
COL_TOMO_NAME = 'rlnTomoName'
COL_TS_STAR = 'rlnTomoTiltSeriesStarFile'
COL_TS_PIXEL_SIZE = 'rlnTomoTiltSeriesPixelSize'
COL_PIXEL_SIZE = 'rlnMicrographOriginalPixelSize'
COL_ALIGNED_STACK = 'rlnTiltSeriesAligned'
COL_TOMOGRAM = 'rlnTomoReconstructedTomogram'
COL_TOMOGRAM_DENOISED = 'rlnTomoReconstructedTomogramDenoised'
COL_TOMO_BINNING = 'rlnTomoTomogramBinning'

# Columns that emwrap writes as a literal 0 when the value was never
# measured.  As of emwrap devel, updateMctfTsDict hardcodes the accumulated
# motion columns (there is a FIXME to parse them from the Warp movie xml) and
# lets the CTF quality columns fall through a defaultdict(lambda: 0), so only
# the defocus values come from the xml.  A whole series of exact zeros for a
# quantity that cannot physically be zero means "not reported", and must not
# be shown as a perfect score or used to flag the series.
PLACEHOLDER_ZERO_COLS = {
    'rlnAccumMotionTotal', 'rlnAccumMotionEarly', 'rlnAccumMotionLate',
    'rlnCtfMaxResolution', 'rlnCtfFigureOfMerit', 'rlnCtfIceRingDensity',
}

# Default triage thresholds.  Facilities are expected to override these from
# the dashboard configuration; they are not meant to be universal.
DEFAULT_THRESHOLDS = {
    'motionTotalMax': {'suspect': 26.0, 'bad': 40.0},
    'ctfMaxResolutionMean': {'suspect': 5.3, 'bad': 6.4},
    'ctfMaxResolutionTiltCount': {'suspect': 6, 'bad': 12},  # n tilts over the limit
    'ctfMaxResolutionTiltLimit': 6.0,
    'tiltsUsedFraction': {'suspect': 0.90, 'bad': 0.80},
    'tiltAxisStd': {'suspect': 1.0, 'bad': 2.5},        # degrees
    # Shift roughness is reported but deliberately not used to flag a
    # series.  On a real AreTomo session it came out between 67 and 113 A on
    # every tilt series, which flagged all of them; the smooth synthetic
    # trajectory it was tuned against was not representative.  Set this to a
    # dict of limits once calibrated against a session known to be good.
    'shiftRoughness': {},
}

STATUS_OK = 'ok'
STATUS_SUSPECT = 'suspect'
STATUS_BAD = 'bad'
STATUS_RUNNING = 'running'
STATUS_FAILED = 'failed'


# --------------------------------------------------------------------------
# Small statistics helpers.  All of them tolerate None and empty input.
# --------------------------------------------------------------------------
def _clean(values):
    return [v for v in values if v is not None and not math.isnan(v)]


def _mean(values):
    v = _clean(values)
    return sum(v) / len(v) if v else None


def _std(values):
    v = _clean(values)
    if len(v) < 2:
        return 0.0 if v else None
    m = sum(v) / len(v)
    return math.sqrt(sum((x - m) ** 2 for x in v) / len(v))


def _median(values):
    v = sorted(_clean(values))
    if not v:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else 0.5 * (v[n // 2 - 1] + v[n // 2])


def _max(values):
    v = _clean(values)
    return max(v) if v else None


def _stats(values):
    """ mean/std/median/min/max in one dict, or None values if no data. """
    v = _clean(values)
    if not v:
        return {'n': 0, 'mean': None, 'std': None,
                'median': None, 'min': None, 'max': None}
    return {'n': len(v), 'mean': _mean(v), 'std': _std(v),
            'median': _median(v), 'min': min(v), 'max': max(v)}


def _stats_measured(values, column=None):
    """ As _stats, but a column known to be written as a placeholder zero
    reports as having no data when every value is exactly zero. """
    st = _stats(values)
    if (column in PLACEHOLDER_ZERO_COLS and st['n']
            and st['min'] == 0.0 and st['max'] == 0.0):
        return {'n': 0, 'mean': None, 'std': None, 'median': None,
                'min': None, 'max': None, 'notReported': True}
    st['notReported'] = False
    return st


def _float(cells, key):
    try:
        return float(cells[key])
    except (KeyError, TypeError, ValueError):
        return None


# --------------------------------------------------------------------------
# Job discovery
# --------------------------------------------------------------------------
class OtfJob:
    """ One job of the OTF pipeline, with its output star files resolved
    from the pipeline nodes rather than guessed from file names. """

    def __init__(self, project, job_id, jobtype, status, alias=None):
        self.project = project
        self.id = job_id                 # e.g. 'External/job020'
        self.jobtype = jobtype           # e.g. 'emw-warp-mctf'
        self.status = status             # RELION status label
        self.alias = alias
        self.outputs = []                # [(nodeName, nodeType)]

    @property
    def path(self):
        return self.project.join(self.id)

    @property
    def failed(self):
        return (self.status or '').lower() in ('failed', 'aborted')

    @property
    def running(self):
        return (self.status or '').lower() in ('running', 'scheduled')

    def output_star(self):
        """ Return the job's main global star file, project relative.

        Failed-series nodes are skipped: they are a separate output and are
        handled by failed_star().  If the node is not registered yet, fall
        back to the filename the job type is known to write.
        """
        for name, ntype in self.outputs:
            if not name.endswith('.star'):
                continue
            if 'failed' in name.lower() or 'failed' in (ntype or '').lower():
                continue
            return name

        if known := JOB_OUTPUT_STAR.get(self.jobtype):
            rel = os.path.join(self.id, known)
            if os.path.exists(self.project.join(rel)):
                return rel
        return None

    def failed_star(self):
        """ Return the job's failed tilt series star file, if it has one. """
        for name, ntype in self.outputs:
            if name.endswith('.star') and (
                    'failed' in name.lower() or 'failed' in (ntype or '').lower()):
                return name
        # emw-warp-mctf writes the file but does not register it as a node.
        rel = os.path.join(self.id, FAILED_STAR)
        return rel if os.path.exists(self.project.join(rel)) else None

    def run_info(self):
        """ emwrap writes an info.json per job with run timings. """
        info_path = os.path.join(self.path, 'info.json')
        if os.path.exists(info_path):
            try:
                with open(info_path) as f:
                    return json.load(f)
            except (ValueError, OSError):
                pass
        return {}

    def __repr__(self):
        return f'OtfJob({self.id}, {self.jobtype}, {self.status})'


# --------------------------------------------------------------------------
# Per-tilt-series metrics
# --------------------------------------------------------------------------
class TiltSeriesMetrics:
    """ Metrics for one tilt series, gathered across all pipeline stages.

    `tilts` holds the raw per-tilt values so the detail view can plot them
    without re-reading the star files.  The summary attributes are what the
    overview table and the session trends use.
    """

    def __init__(self, tomo_name):
        self.tomoName = tomo_name
        self.tilts = []              # list of dicts, one per tilt image
        self.stage = None            # last stage this TS reached
        self.stagesSeen = set()      # stages whose output lists this series
        self.failedAt = None         # stage whose job could not process it
        self.status = None
        self.reasons = []            # why it is suspect/bad
        # Paths, filled in as the stages produce them
        self.tiltSeriesStar = None
        self.alignedStack = None
        self.tomogram = None
        self.pixelSize = None
        self.tsPixelSize = None
        self.tomoBinning = None

    # -- per-tilt access ---------------------------------------------------
    def values(self, key, used_only=True):
        return [t.get(key) for t in self.tilts
                if not (used_only and t.get('excluded'))]

    @property
    def nTilts(self):
        return len(self.tilts)

    @property
    def nUsed(self):
        return sum(1 for t in self.tilts if not t.get('excluded'))

    # -- summaries ---------------------------------------------------------
    def summarize(self, thresholds=None):
        """ Compute the summary metrics and the triage status. """
        th = dict(DEFAULT_THRESHOLDS)
        th.update(thresholds or {})

        self.motion = _stats_measured(
            self.values('rlnAccumMotionTotal'), 'rlnAccumMotionTotal')
        self.motionEarly = _stats_measured(
            self.values('rlnAccumMotionEarly'), 'rlnAccumMotionEarly')
        self.defocus = _stats(self.values('rlnDefocusU'))
        self.astigmatism = _stats(self.values('rlnCtfAstigmatism'))
        self.ctfRes = _stats_measured(
            self.values('rlnCtfMaxResolution'), 'rlnCtfMaxResolution')
        self.ctfFom = _stats_measured(
            self.values('rlnCtfFigureOfMerit'), 'rlnCtfFigureOfMerit')
        self.iceThickness = _stats_measured(
            self.values('rlnCtfIceRingDensity'), 'rlnCtfIceRingDensity')

        self.notReported = sorted(
            name for name, st in (
                ('Accumulated motion', self.motion),
                ('Early motion', self.motionEarly),
                ('CTF fit resolution', self.ctfRes),
                ('CTF figure of merit', self.ctfFom),
                ('Ice ring density', self.iceThickness))
            if st.get('notReported'))

        self._alignment_metrics()

        # Defocus handedness / eucentricity: fit defocus against tilt angle
        # and keep the residual.  The trend itself is expected physics, the
        # scatter around it is what indicates a problem.
        self.defocusTrend = self._defocus_trend()

        limit = th['ctfMaxResolutionTiltLimit']
        self.nTiltsOverCtfLimit = (
            None if self.ctfRes.get('notReported') else
            sum(1 for v in _clean(self.values('rlnCtfMaxResolution'))
                if v > limit))

        self._classify(th)
        return self

    def _alignment_metrics(self):
        """ Alignment quality from the Relion 5 columns that emwrap actually
        writes.

        emw-warp-tsalign stores only rlnTomoXTilt / YTilt / ZRot and the two
        shifts; there is no residual column, and the AreTomo .aln scores are
        not carried into the Relion metadata.  So quality has to be derived:

        tiltAxis   spread of the refined tilt axis (rlnTomoZRot) across the
                   tilts.  AreTomo refines one value per tilt and they should
                   agree; scatter means the alignment is not converging.
        shift      magnitude of the in plane shift, mean and max.  Large
                   values are normal on a drifting stage, so this is context
                   rather than a verdict.
        shiftRough rms of the second difference of the shift trajectory
                   ordered by tilt angle.  Stage drift is smooth, so a rough
                   trajectory means individual tilts were mis-registered.
                   This is the closest honest stand-in for a residual.
        tiltDev    rms deviation of the refined tilt (rlnTomoYTilt) from the
                   nominal stage tilt angle.
        """
        self.tiltAxis = _stats(self.values('rlnTomoZRot'))

        tilts = [t for t in self.tilts if not t.get('excluded')]
        tilts = [t for t in tilts if t.get(COL_TILT_ANGLE) is not None]
        tilts.sort(key=lambda t: t[COL_TILT_ANGLE])

        shifts, devs, traj = [], [], []
        for t in tilts:
            sx, sy = t.get('rlnTomoXShiftAngst'), t.get('rlnTomoYShiftAngst')
            if sx is not None and sy is not None:
                shifts.append(math.hypot(sx, sy))
                traj.append((sx, sy))
            nominal, refined = t.get(COL_TILT_ANGLE), t.get('rlnTomoYTilt')
            if nominal is not None and refined is not None:
                devs.append(abs(abs(refined) - abs(nominal)))

        self.shift = _stats(shifts)
        self.tiltDeviation = _stats(devs)
        self.shiftRoughness = self._trajectory_roughness(traj)

    @staticmethod
    def _trajectory_roughness(traj):
        """ rms of the second difference of a 2D trajectory, in the same
        units as the input.  None if there are too few points. """
        if len(traj) < 3:
            return None
        total = 0.0
        for i in range(1, len(traj) - 1):
            (x0, y0), (x1, y1), (x2, y2) = traj[i - 1], traj[i], traj[i + 1]
            dx = x2 - 2 * x1 + x0
            dy = y2 - 2 * y1 + y0
            total += dx * dx + dy * dy
        return math.sqrt(total / (len(traj) - 2))

    def _defocus_trend(self):
        """ Least squares fit of defocus vs tilt angle.  Returns slope
        (Å per degree), intercept and the rms residual, or None. """
        pairs = [(t.get(COL_TILT_ANGLE), t.get('rlnDefocusU'))
                 for t in self.tilts if not t.get('excluded')]
        pairs = [(x, y) for x, y in pairs if x is not None and y is not None]
        if len(pairs) < 4:
            return None
        n = len(pairs)
        mx = sum(x for x, _ in pairs) / n
        my = sum(y for _, y in pairs) / n
        sxx = sum((x - mx) ** 2 for x, _ in pairs)
        if sxx == 0:
            return None
        sxy = sum((x - mx) * (y - my) for x, y in pairs)
        slope = sxy / sxx
        intercept = my - slope * mx
        resid = math.sqrt(
            sum((y - (slope * x + intercept)) ** 2 for x, y in pairs) / n)
        return {'slope': slope, 'intercept': intercept, 'rms': resid}

    def _classify(self, th):
        """ Assign ok / suspect / bad, keeping the reasons for the tooltip.
        Job-level problems (failed, still running) are set by the caller and
        are deliberately not mixed with data quality. """
        if self.status in (STATUS_FAILED, STATUS_RUNNING):
            return

        level = STATUS_OK
        reasons = []

        def check(value, limits, msg, higher_is_worse=True):
            nonlocal level
            if value is None:
                return
            for name in (STATUS_BAD, STATUS_SUSPECT):
                lim = limits.get(name)
                if lim is None:
                    continue
                hit = value > lim if higher_is_worse else value < lim
                if hit:
                    reasons.append(msg.format(value=value, limit=lim))
                    if name == STATUS_BAD:
                        level = STATUS_BAD
                    elif level != STATUS_BAD:
                        level = STATUS_SUSPECT
                    break

        check(self.motion['max'], th['motionTotalMax'],
              'max accumulated motion {value:.1f} Å over {limit:.0f}')
        check(self.ctfRes['mean'], th['ctfMaxResolutionMean'],
              'mean CTF fit {value:.2f} Å over {limit:.1f}')
        check(self.nTiltsOverCtfLimit, th['ctfMaxResolutionTiltCount'],
              '{value:.0f} tilts with CTF fit worse than the limit')
        check(self.tiltAxis['std'], th['tiltAxisStd'],
              'refined tilt axis varies by {value:.2f}° across the tilts')
        check(self.shiftRoughness, th['shiftRoughness'],
              'alignment shifts not smooth across tilt angle ({value:.0f} Å)')
        if self.nTilts:
            check(self.nUsed / self.nTilts, th['tiltsUsedFraction'],
                  'only {value:.0%} of tilts used', higher_is_worse=False)

        self.status = level
        self.reasons = reasons

    # -- serialization -----------------------------------------------------
    def json(self, with_tilts=False):
        d = {
            'tomoName': self.tomoName,
            'stage': self.stage,
            'failedAt': self.failedAt,
            'status': self.status,
            'reasons': self.reasons,
            'notReported': getattr(self, 'notReported', []),
            'stagesSeen': sorted(self.stagesSeen),
            'nTilts': self.nTilts,
            'nUsed': self.nUsed,
            'pixelSize': self.pixelSize,
            'tsPixelSize': self.tsPixelSize,
            'tiltSeriesStar': self.tiltSeriesStar,
            'alignedStack': self.alignedStack,
            'tomogram': self.tomogram,
        }
        for name in ('motion', 'motionEarly', 'defocus', 'astigmatism',
                     'ctfRes', 'ctfFom', 'iceThickness', 'tiltAxis',
                     'shift', 'tiltDeviation'):
            d[name] = getattr(self, name, None)
        d['defocusTrend'] = getattr(self, 'defocusTrend', None)
        d['shiftRoughness'] = getattr(self, 'shiftRoughness', None)
        d['nTiltsOverCtfLimit'] = getattr(self, 'nTiltsOverCtfLimit', None)
        if with_tilts:
            d['tilts'] = self.tilts
        return d


# --------------------------------------------------------------------------
# The session
# --------------------------------------------------------------------------
class OtfSession:
    """ A single on-the-fly CryoET session, backed by a RELION 5 project. """

    def __init__(self, path, thresholds=None):
        self.path = os.path.abspath(os.path.expanduser(path))
        self.thresholds = dict(DEFAULT_THRESHOLDS)
        self.thresholds.update(thresholds or {})
        self._jobs = None
        self._stages = None
        self._ts = None

        if not os.path.exists(self.pipelineStar):
            raise Exception(
                f'Not a RELION project: {self.pipelineStar} does not exist')

    def join(self, *p):
        return os.path.join(self.path, *p)

    @property
    def pipelineStar(self):
        return self.join('default_pipeline.star')

    # -- jobs --------------------------------------------------------------
    def jobs(self, reload=False):
        """ All jobs of the project, in pipeline order. """
        if self._jobs is None or reload:
            wf = RelionStar.pipeline_to_workflow(self.pipelineStar)
            jobs = []
            for job in wf.jobs():
                j = OtfJob(self, job.id, job['jobtype'], job['status'],
                           alias=job.get('alias'))
                j.outputs = [(o.id, o.get('datatype')) for o in job.outputs]
                jobs.append(j)
            self._jobs = jobs
        return self._jobs

    def stages(self, reload=False):
        """ Map stage key -> the job that produced it (latest one wins).

        Returns an OrderedDict following STAGES, with None for stages that
        have no job in this project yet.
        """
        if self._stages is None or reload:
            by_type = {}
            for job in self.jobs(reload=reload):
                by_type.setdefault(job.jobtype, []).append(job)

            stages = OrderedDict()
            for key, spec in STAGES.items():
                found = None
                for jobtype in spec['jobtypes']:
                    candidates = by_type.get(jobtype)
                    if candidates:
                        found = candidates[-1]   # most recent
                        break
                stages[key] = found
            self._stages = stages
        return self._stages

    # -- reading the star files -------------------------------------------
    def _read_global(self, job):
        """ Read a job's global tilt series star file.

        Returns {tomoName: cells} keyed by rlnTomoName, or {} if the job has
        not produced its output yet.
        """
        if job is None:
            return {}
        return self._read_global_star(job.output_star())

    def _read_global_star(self, star_rel):
        """ Read a global tilt series star file, keyed by rlnTomoName. """
        if not star_rel:
            return {}
        star_path = self.join(star_rel)
        if not os.path.exists(star_path):
            return {}

        rows = {}
        with StarFile(star_path) as sf:
            names = sf.getTableNames()
            # Relion 5 writes the global table as 'global'; be tolerant.
            table = 'global' if 'global' in names else (names[0] if names else None)
            if table is None:
                return {}
            for row in sf.iterTable(table, guessType=False):
                cells = row._asdict()
                name = cells.get(COL_TOMO_NAME)
                if name:
                    rows[name] = cells
        return rows

    def _read_failed(self, job):
        """ Read a job's failed_tilt_series.star, keyed by rlnTomoName. """
        if job is None:
            return {}
        return self._read_global_star(job.failed_star())

    def _read_tilts(self, star_rel):
        """ Read a per-tilt-series star file into a list of per-tilt dicts. """
        if not star_rel:
            return []
        star_path = self.join(star_rel)
        if not os.path.exists(star_path):
            return []

        wanted = ([COL_TILT_ANGLE, COL_PRE_EXPOSURE, COL_MICROGRAPH]
                  + MOTION_COLS + CTF_COLS + ALIGN_COLS)
        tilts = []
        with StarFile(star_path) as sf:
            names = sf.getTableNames()
            if not names:
                return []
            # Per-series files use the tomo name as table name.
            table = names[0]
            for i, row in enumerate(sf.iterTable(table, guessType=False)):
                cells = row._asdict()
                t = {'index': i, 'excluded': False}
                if mic := cells.get(COL_MICROGRAPH):
                    t[COL_MICROGRAPH] = mic
                for col in wanted:
                    if col == COL_MICROGRAPH:
                        continue
                    val = _float(cells, col)
                    if val is not None:
                        t[col] = val
                tilts.append(t)

        # Acquisition order from pre-exposure when available; dose-symmetric
        # schemes are not sorted by tilt angle.
        if any(COL_PRE_EXPOSURE in t for t in tilts):
            order = sorted(range(len(tilts)),
                           key=lambda i: tilts[i].get(COL_PRE_EXPOSURE, 0))
            for rank, i in enumerate(order):
                tilts[i]['acqOrder'] = rank
        return tilts

    # -- tilt series -------------------------------------------------------
    def tilt_series(self, reload=False, with_tilts=False):
        """ Build the metrics of every tilt series known to the project.

        Later stages overwrite the per-tilt values of earlier ones, because a
        RELION 5 tilt series star file accumulates columns as it goes through
        the pipeline.
        """
        if self._ts is not None and not reload:
            return self._ts

        stages = self.stages(reload=reload)
        series = OrderedDict()

        for key in STAGES:
            job = stages.get(key)
            if job is None:
                continue
            globals_ = self._read_global(job)

            for name, cells in globals_.items():
                ts = series.get(name)
                if ts is None:
                    ts = series[name] = TiltSeriesMetrics(name)

                ts.stage = key
                ts.stagesSeen.add(key)
                ts.tiltSeriesStar = cells.get(COL_TS_STAR) or ts.tiltSeriesStar
                ts.pixelSize = _float(cells, COL_PIXEL_SIZE) or ts.pixelSize
                ts.tsPixelSize = _float(cells, COL_TS_PIXEL_SIZE) or ts.tsPixelSize
                ts.tomoBinning = _float(cells, COL_TOMO_BINNING) or ts.tomoBinning
                if stack := cells.get(COL_ALIGNED_STACK):
                    ts.alignedStack = stack
                tomo = (cells.get(COL_TOMOGRAM)
                        or cells.get(COL_TOMOGRAM_DENOISED))
                if tomo:
                    ts.tomogram = tomo

                tilts = self._read_tilts(ts.tiltSeriesStar)
                if tilts:
                    ts.tilts = tilts

            # Tilt series this stage could not process.  emwrap lists them
            # explicitly, so a failure is recorded rather than inferred, and
            # "the job broke on this one" stays distinct from "the data is
            # poor".
            for name, cells in self._read_failed(job).items():
                ts = series.get(name) or series.setdefault(
                    name, TiltSeriesMetrics(name))
                ts.status = STATUS_FAILED
                ts.failedAt = key
                ts.stage = ts.stage or key

            # A whole job that died or is still going marks every series it
            # was working on, unless that series already failed on its own.
            if job.failed or job.running:
                job_status = STATUS_FAILED if job.failed else STATUS_RUNNING
                for name in globals_:
                    if series[name].status != STATUS_FAILED:
                        series[name].status = job_status

        for ts in series.values():
            ts.summarize(self.thresholds)

        self._ts = list(series.values())
        return self._ts

    # -- session level -----------------------------------------------------
    def summary(self, reload=False):
        """ Counters, per-stage progress and the session state. """
        stages = self.stages(reload=reload)
        ts_list = self.tilt_series(reload=reload)

        imported = self._read_global(stages.get('import'))
        n_imported = len(imported) or len(ts_list)

        stage_counts = []
        for key, spec in STAGES.items():
            job = stages.get(key)
            done = 0
            if job is not None:
                # Counted from the stage output listing the series, not from
                # whether a metric came back with values: emwrap writes some
                # metrics as placeholder zeros, and a stage that ran is done
                # whether or not it measured anything.
                done = sum(1 for t in ts_list if key in t.stagesSeen)
                if key == 'tomogram':
                    done = sum(1 for t in ts_list if t.tomogram)
                elif key == 'align':
                    done = sum(1 for t in ts_list
                               if t.alignedStack and t.alignedStack != 'None')
            stage_counts.append({
                'key': key,
                'failed': sum(1 for t in ts_list if t.failedAt == key),
                'label': spec['label'],
                'jobId': job.id if job else None,
                'jobType': job.jobtype if job else None,
                'jobStatus': job.status if job else None,
                'done': done,
                'total': n_imported,
            })

        by_status = {}
        for t in ts_list:
            by_status[t.status] = by_status.get(t.status, 0) + 1

        not_reported = sorted(set(
            name for t in ts_list for name in getattr(t, 'notReported', [])))

        return {
            'path': self.path,
            'nImported': n_imported,
            'notReported': not_reported,
            'nProcessed': sum(1 for t in ts_list if t.tomogram),
            'byStatus': by_status,
            'nNeedALook': sum(by_status.get(s, 0)
                              for s in (STATUS_SUSPECT, STATUS_BAD, STATUS_FAILED)),
            'stages': stage_counts,
            'lastImport': self._last_import_mtime(),
        }

    def _last_import_mtime(self):
        """ mtime of the most recent raw movie or import output, used to tell
        acquiring from idle from stalled. """
        job = self.stages().get('import')
        if job is None:
            return None
        mtimes = []
        for name, _ in job.outputs:
            p = self.join(name)
            if os.path.exists(p):
                mtimes.append(os.path.getmtime(p))
        for pattern in ('*.star', '*.tomostar'):
            for p in glob(os.path.join(job.path, pattern)):
                mtimes.append(os.path.getmtime(p))
        return max(mtimes) if mtimes else None

    def json(self, with_tilts=False):
        return {
            'summary': self.summary(),
            'tiltSeries': [t.json(with_tilts=with_tilts)
                           for t in self.tilt_series()],
        }


# --------------------------------------------------------------------------
# CLI, for checking a real project without the web app
# --------------------------------------------------------------------------
def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('project', help='Path to the RELION 5 project folder')
    p.add_argument('--json', action='store_true', help='Dump everything as JSON')
    p.add_argument('--tilts', metavar='TOMO_NAME',
                   help='Print the per-tilt table of one tilt series')
    args = p.parse_args()

    session = OtfSession(args.project)

    if args.json:
        print(json.dumps(session.json(with_tilts=True), indent=2))
        return

    print(f'Project: {session.path}\n')
    print('Jobs found:')
    for key, job in session.stages().items():
        label = STAGES[key]['label']
        if job is None:
            print(f'  {label:<30} -- not found --')
        else:
            print(f'  {label:<30} {job.id:<20} {job.jobtype:<20} {job.status}')

    s = session.summary()
    print(f'\nImported: {s["nImported"]}   reconstructed: {s["nProcessed"]}'
          f'   need a look: {s["nNeedALook"]}')
    print('\nStage progress:')
    for st in s['stages']:
        print(f'  {st["label"]:<30} {st["done"]:>5} / {st["total"]}')

    ts_list = session.tilt_series()
    if args.tilts:
        ts = next((t for t in ts_list if t.tomoName == args.tilts), None)
        if ts is None:
            print(f'\nNo tilt series named {args.tilts}')
            return
        print(f'\nPer-tilt values for {ts.tomoName}:')
        hdr = ('angle', 'dose', 'motion', 'defU', 'ctfRes')
        print('  ' + ''.join(f'{h:>10}' for h in hdr))
        for t in sorted(ts.tilts, key=lambda x: x.get(COL_TILT_ANGLE, 0)):
            vals = (
                (t.get(COL_TILT_ANGLE), False),
                (t.get(COL_PRE_EXPOSURE), False),
                (t.get('rlnAccumMotionTotal'), ts.motion.get('notReported')),
                (t.get('rlnDefocusU'), False),
                (t.get('rlnCtfMaxResolution'), ts.ctfRes.get('notReported')),
            )
            cells = []
            for v, unreported in vals:
                if unreported:
                    cells.append(f'{"n/a":>10}')
                elif isinstance(v, float):
                    cells.append(f'{v:>10.2f}')
                else:
                    cells.append(f'{"-":>10}')
            print('  ' + ''.join(cells))
        return

    if s['notReported']:
        print('\nNot reported by this pipeline (written as placeholder '
              'zeros, shown as n/a):')
        for name in s['notReported']:
            print(f'  {name}')

    print(f'\nTilt series ({len(ts_list)}):')
    print(f'  {"name":<24}{"status":<10}{"used":>8}{"motion":>10}'
          f'{"defocus":>10}{"ctfRes":>9}{"stage":>12}')
    for t in ts_list:
        def f(v, fmt='{:.2f}'):
            if isinstance(v, float):
                return fmt.format(v)
            return 'n/a' if v is None else '-'
        print(f'  {t.tomoName:<24}{str(t.status):<10}'
              f'{t.nUsed:>4}/{t.nTilts:<3}'
              f'{f(t.motion["mean"]):>10}'
              f'{f((t.defocus["median"] or 0) / 1e4 or None):>10}'
              f'{f(t.ctfRes["mean"]):>9}'
              f'{str(t.stage):>12}')
        for r in t.reasons:
            print(f'      - {r}')


if __name__ == '__main__':
    try:
        main()
    except BrokenPipeError:
        # Piping into head closes stdout early; that is not an error.
        try:
            sys.stdout.close()
        finally:
            os._exit(0)
