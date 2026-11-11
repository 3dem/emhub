"""Job views: viewers of a whole job, shown in the project page as extra
('fake') outputs of the job.

A job view is not a file the job wrote, so it can not be used as an input of
other jobs: its output has pointerClass JOB_VIEW_CLASS and value
'<job id>#<view id>' (e.g. 'TiltSeries/job005#ctf-plots'). Clicking its eye
icon opens emflow's table viewer: get_table_view_data builds the table with
build_job_view_table and resolve_table_view_pane the right pane of a row with
build_job_view_pane.

To add a view: subclass JobView (id, label, jobtypes, source, table, pane),
or StarColumnsPlotsView for plots of STAR file columns (only METRICS), and
register it with register_job_view.
"""

import os

from . import project_file_path, resolve_project_root
from .star_columns import (load_star_columns, build_star_columns_table,
                           build_star_column_pane)
from .relion_iterations import (load_relion_iterations, build_iterations_table,
                                build_iteration_pane)


JOB_VIEW_CLASS = 'JobView'
_SEP = '#'

_JOB_VIEWS = {}  # view id -> JobView


def job_view_value(job_id, view_id):
    return f'{job_id.rstrip("/")}{_SEP}{view_id}'


def parse_job_view_value(value):
    """ Return (job_id, view) of a job view output value. """
    job_id, sep, view_id = str(value or '').rpartition(_SEP)
    if not sep or not job_id or view_id not in _JOB_VIEWS:
        raise Exception(f'Invalid job view: {value!r}')
    return job_id, _JOB_VIEWS[view_id]


def register_job_view(view):
    _JOB_VIEWS[view.id] = view
    return view


def job_view_outputs(job_id, jobtype, job_dir, status='Succeeded'):
    """ The extra outputs (widget format) of a job with the given type and
    status, for the views whose source file exists in job_dir (absolute
    path). """
    outputs = []
    for view in _JOB_VIEWS.values():
        if (jobtype in view.jobtypes and status in view.statuses
                and view.available(job_dir)):
            outputs.append({
                'outputName': view.label,
                'pointerClass': JOB_VIEW_CLASS,
                'info': view.label,
                'prefix': '',
                'value': job_view_value(job_id, view.id),
                'parentId': job_id,
            })
    return outputs


def _job_dir(root, job_id):
    job_dir = project_file_path(root, job_id)
    if not os.path.isdir(job_dir):
        raise Exception(f'Job folder not found: {job_id}')
    return job_dir


def build_job_view_table(root, value):
    job_id, view = parse_job_view_value(value)
    return view.table(resolve_project_root(root), _job_dir(root, job_id))


def build_job_view_pane(root, value, action_id, row_cells):
    job_id, view = parse_job_view_value(value)
    return view.pane(resolve_project_root(root), _job_dir(root, job_id),
                     action_id, row_cells or {})


class JobView:
    """ Base class of the job views. """
    id = None
    label = None
    jobtypes = ()
    # File of the job folder needed by the view (it is listed only if it exists)
    source = None
    # Statuses of the jobs with the view
    statuses = ('Succeeded',)

    def available(self, job_dir):
        return os.path.exists(os.path.join(job_dir, self.source))

    def table(self, root, job_dir):
        """ TableViewerData: {title, columns, rows, initialAction?}. """
        raise NotImplementedError

    def pane(self, root, job_dir, action_id, row_cells):
        """ TableViewerPaneContent of a row action. """
        raise NotImplementedError


class StarColumnsPlotsView(JobView):
    """ Plots of some columns (METRICS: (label, name, unit)) of the source
    STAR file of the job, as Relion's logfile.pdf: a row per column, which
    shows its values for all items and their histogram (the first row when
    the view is opened). See star_columns. """
    METRICS = []
    ITEM_LABEL = 'tilt images'
    ACTION = {'id': 'plots', 'label': 'plots'}

    def _load(self, root, job_dir):
        return load_star_columns(root, os.path.join(job_dir, self.source),
                                 [m[0] for m in self.METRICS])

    def table(self, root, job_dir):
        return build_star_columns_table(self._load(root, job_dir), self.METRICS,
                                        self.ACTION, self.label, self.ITEM_LABEL)

    def pane(self, root, job_dir, action_id, row_cells):
        if action_id != self.ACTION['id']:
            raise Exception(f'Unknown action {action_id!r} of {self.label}')
        label = row_cells.get('metric')
        metric = next((m for m in self.METRICS if m[0] == label), None)
        if metric is None:
            raise Exception(f'Unknown metric of {self.label}: {label!r}')
        return build_star_column_pane(self._load(root, job_dir), *metric,
                                      item_label=self.ITEM_LABEL)


class CtfPlotsView(StarColumnsPlotsView):
    """ CTF metrics of a Relion CTF estimation of tilt series. """
    id = 'ctf-plots'
    label = 'CTF Plots'
    jobtypes = ('relion.ctffind.tomo',)
    source = 'tilt_series_ctf.star'
    # The labels plotted by Relion (ctffind_runner.cpp), in its order
    METRICS = [
        ('rlnDefocusU', 'Defocus U', 'Å'),
        ('rlnDefocusAngle', 'Defocus angle', '°'),
        ('rlnCtfAstigmatism', 'Astigmatism', 'Å'),
        ('rlnCtfMaxResolution', 'Max resolution', 'Å'),
        ('rlnPhaseShift', 'Phase shift', '°'),
        ('rlnCtfFigureOfMerit', 'Figure of merit', ''),
        ('rlnCtfValidationScore', 'Validation score', ''),
        ('rlnCtfIceRingDensity', 'Ice ring density', ''),
        ('rlnCtfIceRingPowerFraction', 'Ice ring power fraction', ''),
        ('rlnCtfIceRingKurtosis', 'Ice ring kurtosis', ''),
    ]


class MotionPlotsView(StarColumnsPlotsView):
    """ Accumulated motion of a Relion motion correction of tilt series. """
    id = 'motion-plots'
    label = 'Motion Plots'
    jobtypes = ('relion.motioncorr.tomo',)
    source = 'corrected_tilt_series.star'
    # The labels plotted by Relion (motioncorr_runner.cpp), in its order
    METRICS = [
        ('rlnAccumMotionTotal', 'Total motion', 'Å'),
        ('rlnAccumMotionEarly', 'Early motion', 'Å'),
        ('rlnAccumMotionLate', 'Late motion', 'Å'),
    ]


class RelionIterationsView(JobView):
    """ Results of the iterations of a Relion 3D classification or 3D
    auto-refine (SPA and tomography): a row per iteration with its plots and
    maps, see relion_iterations. Also while running (or after a failure),
    to follow the intermediate results. """
    id = 'relion-iterations'
    label = 'Analyze Results'
    jobtypes = ('relion.class3d', 'relion.class3d.tomo',
                'relion.refine3d', 'relion.refine3d.tomo')
    statuses = ('Succeeded', 'Running', 'Failed', 'Aborted')

    def available(self, job_dir):
        try:
            return any(f.endswith('_optimiser.star') for f in os.listdir(job_dir))
        except OSError:
            return False

    def _load(self, root, job_dir):
        # Only auto-refine jobs write the models of the half sets
        refine = any(f.endswith('_half1_model.star') for f in os.listdir(job_dir))
        return load_relion_iterations(root, job_dir, refine=refine)

    def table(self, root, job_dir):
        job_id = os.path.relpath(job_dir, root)
        return build_iterations_table(self._load(root, job_dir), f'{self.label} — {job_id}')

    def pane(self, root, job_dir, action_id, row_cells):
        return build_iteration_pane(root, self._load(root, job_dir), action_id, row_cells)


register_job_view(CtfPlotsView())
register_job_view(MotionPlotsView())
register_job_view(RelionIterationsView())
