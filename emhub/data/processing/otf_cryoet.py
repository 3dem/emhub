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
from collections import OrderedDict, Counter

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

# Folder of per tilt jpegs emwrap writes next to the tilt averages
THUMBNAILS_DIR = 'thumbnails'

# RELION 5 per-tilt columns we read.  Everything is optional: a job that did
# not run yet simply leaves the column out, and the metric comes back as None.
COL_TILT_ANGLE = 'rlnTomoNominalStageTiltAngle'
COL_PRE_EXPOSURE = 'rlnMicrographPreExposure'
COL_MICROGRAPH = 'rlnMicrographName'
COL_MOVIE_INDEX = 'rlnTomoTiltMovieIndex'
COL_POWER_SPECTRUM = 'rlnCtfPowerSpectrum'

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

# Default triage thresholds, following the facility's RELION 5 CryoET QC
# reference.  Overridable per entry; they are not meant to be universal.
#
# Tilts are judged first: a tilt past a 'reject' limit counts as unusable,
# one past a 'target' is usable but not optimal.  A tilt series is then
# judged on how many usable tilts it keeps.  Only data quality is judged
# here; job failures are handled separately.
DEFAULT_THRESHOLDS = {
    # Per tilt
    'motionTotal': {'target': 15.0, 'reject': 25.0},     # Å
    'motionEarly': {'flag': 10.0},                        # Å
    # The CTF fit target loosens with tilt, since the path length through
    # the sample grows as 1/cos(tilt): lowTarget up to lowTilt, highTarget
    # from highTilt, linear in between.
    'ctfMaxResolution': {'lowTilt': 20.0, 'lowTarget': 4.5,
                         'highTilt': 45.0, 'highTarget': 8.0,
                         'reject': 10.0},                 # degrees, Å
    'ctfFigureOfMerit': {'reject': 0.03},
    'astigmatism': {'reject': 4000.0},                   # Å (0.40 µm)
    # RELION stores underfocus as positive defocus, so negative is overfocus
    'defocus': {'reject': 60000.0},                      # Å (6 µm)
    # Per tilt series
    'usableFraction': {'bad': 0.70},       # usable tilts / collected tilts
    'droppedFraction': {'suspect': 0.15},  # excluded + rejected / collected
    'earlyMotionFraction': {'suspect': 0.30},  # tilts over motionEarly flag
    # Per session: spread of the tilt axis between tilt series
    'tiltAxisSessionStd': 1.5,             # degrees
    # Reported but not used to flag a series: on a real session it came out
    # at 67-113 Å on every tilt series.  Set limits once calibrated.
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
                ('accumulated motion', self.motion),
                ('early motion', self.motionEarly),
                ('CTF fit resolution', self.ctfRes),
                ('CTF figure of merit', self.ctfFom),
                ('ice ring density', self.iceThickness))
            if st.get('notReported'))

        self._alignment_metrics()

        # Defocus handedness / eucentricity: fit defocus against tilt angle
        # and keep the residual.  The trend itself is expected physics, the
        # scatter around it is what indicates a problem.
        self.defocusTrend = self._defocus_trend()

        self._judge_tilts(th)
        self._classify(th)
        return self

    @staticmethod
    def ctf_target(angle, spec):
        """ CTF fit resolution target (Å) for a tilt at this stage angle. """
        a = abs(angle or 0.0)
        low, high = spec['lowTilt'], spec['highTilt']
        if a <= low:
            return spec['lowTarget']
        if a >= high:
            return spec['highTarget']
        f = (a - low) / (high - low)
        return spec['lowTarget'] + f * (spec['highTarget'] - spec['lowTarget'])

    def _judge_tilts(self, th):
        """ Mark each used tilt with the limits it breaks.

        t['reject'] lists why a tilt would be unusable, t['offTarget'] why it
        is usable but not optimal.  A metric written as placeholder zeros is
        never judged: a zero figure of merit that was never measured must not
        reject every tilt.
        """
        measured = {
            'motion': not self.motion.get('notReported'),
            'early': not self.motionEarly.get('notReported'),
            'ctf': not self.ctfRes.get('notReported'),
            'fom': not self.ctfFom.get('notReported'),
        }
        motion, early = th['motionTotal'], th['motionEarly']
        ctf = th['ctfMaxResolution']

        for t in self.tilts:
            reject, off = [], []
            if not t.get('excluded'):
                m = t.get('rlnAccumMotionTotal')
                if measured['motion'] and m is not None:
                    if m > motion['reject']:
                        reject.append('motion')
                    elif m > motion['target']:
                        off.append('motion')
                e = t.get('rlnAccumMotionEarly')
                if measured['early'] and e is not None and e > early['flag']:
                    off.append('early')
                r = t.get('rlnCtfMaxResolution')
                if measured['ctf'] and r is not None:
                    if r > ctf['reject']:
                        reject.append('ctf')
                    elif r > self.ctf_target(t.get(COL_TILT_ANGLE), ctf):
                        off.append('ctf')
                f = t.get('rlnCtfFigureOfMerit')
                if measured['fom'] and f is not None and f < th['ctfFigureOfMerit']['reject']:
                    reject.append('fom')
                a = t.get('rlnCtfAstigmatism')
                if a is not None and abs(a) > th['astigmatism']['reject']:
                    reject.append('astigmatism')
                d = t.get('rlnDefocusU')
                if d is not None and (d < 0 or d > th['defocus']['reject']):
                    reject.append('defocus')
            t['reject'], t['offTarget'] = reject, off

        self.rejectCounts = Counter(k for t in self.tilts for k in t['reject'])
        self.offTargetCounts = Counter(k for t in self.tilts for k in t['offTarget'])

        self.nRejected = sum(1 for t in self.tilts if t['reject'])
        self.nUsable = self.nUsed - self.nRejected
        self.nCtfOffTarget = self.offTargetCounts['ctf'] if measured['ctf'] else None

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
                    level_word = 'poor' if name == STATUS_BAD else 'review'
                    reasons.append(msg.format(value=value, limit=lim,
                                              level=level_word))
                    if name == STATUS_BAD:
                        level = STATUS_BAD
                    elif level != STATUS_BAD:
                        level = STATUS_SUSPECT
                    break

        if self.nTilts:
            n = self.nTilts
            labels = {
                'motion': f'motion above {th["motionTotal"]["reject"]:.0f} Å',
                'ctf': f'CTF fit worse than {th["ctfMaxResolution"]["reject"]:.0f} Å',
                'fom': f'CTF figure of merit below {th["ctfFigureOfMerit"]["reject"]}',
                'astigmatism': f'astigmatism above {th["astigmatism"]["reject"] / 1e4:.2f} µm',
                'defocus': f'defocus overfocused or above {th["defocus"]["reject"] / 1e4:.0f} µm',
            }
            # Plain strings from here are formatted by check(), not here
            why = ', '.join(f'{c} with {labels[k]}'
                            for k, c in self.rejectCounts.most_common())
            why = f' ({why})' if why else ''
            n_dropped = n - self.nUsable
            check(self.nUsable / n, th['usableFraction'],
                  f'Only {self.nUsable} of {n} tilts are usable{why}: '
                  '{value:.0%}, below the {level} limit of {limit:.0%}',
                  higher_is_worse=False)
            if level != STATUS_BAD:
                check(n_dropped / n, th['droppedFraction'],
                      f'{n_dropped} of {n} tilts are dropped or unusable{why}: '
                      '{value:.0%}, above the {level} limit of {limit:.0%}')
            if self.nUsed and 'early' in self.offTargetCounts:
                check(self.offTargetCounts['early'] / self.nUsed,
                      th['earlyMotionFraction'],
                      f'{self.offTargetCounts["early"]} of {self.nUsed} tilts '
                      f'have early motion above {th["motionEarly"]["flag"]:.0f} Å: '
                      '{value:.0%}, above the {level} limit of {limit:.0%}; '
                      'consider re-running motion correction with a different '
                      'frame grouping')
        check(self.shiftRoughness, th['shiftRoughness'],
              'Alignment shifts are irregular across tilt angle '
              '({value:.0f} Å, {level} limit {limit:.0f} Å)')

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
        for name in ('nCtfOffTarget', 'nRejected', 'nUsable',
                     'rejectCounts', 'offTargetCounts'):
            d[name] = getattr(self, name, None)
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

    # kind -> (column of the source MRC, file emwrap writes for it)
    THUMBNAIL_KINDS = {
        'image': (COL_MICROGRAPH, '{name}.jpg'),
        'medium': (COL_MICROGRAPH, '{name}_medium.jpg'),
        'large': (COL_MICROGRAPH, '{name}_large.jpg'),
        'ps': (COL_POWER_SPECTRUM, '{name}_ps.jpg'),
        'ctf': (COL_POWER_SPECTRUM, '{name}_ctf.json'),
    }

    def tilt_thumbnail(self, tilt, kind='image'):
        """ A file emwrap writes for a tilt, as {'path', 'version'}, or None
        if it has not been written.  emwrap puts them in a 'thumbnails'
        folder beside the folder of the source MRC: the tilt image (and two
        larger ones), the CTF fit image and the CTF fit radial profile.  path is project relative;
        version is the modification time, for the URL, so the browser does
        not keep showing a cached copy after emwrap rewrites the file. """
        col, pattern = self.THUMBNAIL_KINDS[kind]
        src = tilt.get(col)
        if not src:
            return None
        name = pattern.format(name=os.path.splitext(os.path.basename(src))[0])
        rel = os.path.join(os.path.dirname(os.path.dirname(src)), THUMBNAILS_DIR, name)
        try:
            mtime = os.stat(self.join(rel)).st_mtime
        except OSError:
            return None
        return {'path': rel, 'version': int(mtime)}

    def aligned_stack_tilts(self, ts):
        """ The tilt of each section of the tilt series' aligned stack, in
        stack order, or None if that cannot be told.

        The stack's angles are in the IMOD .tlt file beside it, and AreTomo
        may write them with the opposite sign to RELION's nominal stage
        angles.  The sign is the one under which every section matches a
        tilt to within rounding; when both signs fit equally (a perfectly
        symmetric scheme) the order is ambiguous and None is returned.
        """
        stack = ts.alignedStack
        tilts = [t for t in ts.tilts if t.get(COL_TILT_ANGLE) is not None]
        if not stack or stack == 'None' or not tilts:
            return None
        tlt = os.path.splitext(self.join(stack))[0] + '.tlt'
        try:
            with open(tlt) as f:
                angles = [float(v) for v in f.read().split()]
        except (OSError, ValueError):
            return None
        if not angles or len(angles) > len(tilts):
            return None

        def match(sign):
            # Each section's nearest tilt, and the worst mismatch
            picks = [min(tilts, key=lambda t: abs(t[COL_TILT_ANGLE] - sign * a))
                     for a in angles]
            worst = max(abs(t[COL_TILT_ANGLE] - sign * a) for t, a in zip(picks, angles))
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

        wanted = ([COL_TILT_ANGLE, COL_PRE_EXPOSURE, COL_MICROGRAPH, COL_MOVIE_INDEX]
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
                for col in (COL_MICROGRAPH, COL_POWER_SPECTRUM):
                    if path := cells.get(col):
                        t[col] = path
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
        prev_key = None

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

            # A job that died or is still going only concerns the series
            # waiting for it: those it already wrote out are done.  On the fly
            # jobs run for the whole session, so marking its output as
            # running would hide every series until acquisition ends.
            if (job.failed or job.running) and prev_key is not None:
                for ts in series.values():
                    if ts.stage == prev_key and ts.status is None:
                        if job.failed:
                            ts.status, ts.failedAt = STATUS_FAILED, key
                        else:
                            ts.status = STATUS_RUNNING
                            ts.stage = key
            prev_key = key

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

        # The tilt axis should agree between tilt series; a spread points at
        # stage wear or holder calibration rather than at one sample.
        warnings = []
        axes = _clean([t.tiltAxis['mean'] for t in ts_list
                       if t.status not in (STATUS_FAILED, STATUS_RUNNING)])
        axis_std = _std(axes) if len(axes) > 1 else None
        axis_limit = self.thresholds['tiltAxisSessionStd']
        if axis_std is not None and axis_std > axis_limit:
            warnings.append(
                f'The refined tilt axis varies by {axis_std:.2f}° between tilt '
                f'series, above the limit of {axis_limit:.1f}°: check the stage '
                f'and the holder calibration.')

        return {
            'warnings': warnings,
            'tiltAxisSessionStd': axis_std,
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
          f'   needs review: {s["nNeedALook"]}')
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
        print('\nNot measured by this pipeline (written as placeholder '
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
