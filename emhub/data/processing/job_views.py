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

The value can end with ':<option>' ('<job id>#<view id>:<option>'), another
version of the table of the view (its table 'variants', e.g. a distance):
then view.table() gets option=<option>.
"""

import os
import tempfile

from emtools.metadata import StarFile

from . import project_file_path, resolve_project_root
from .star_columns import (load_star_columns, build_star_columns_table,
                           build_star_column_pane)
from .relion_iterations import (load_relion_iterations, build_iterations_table,
                                build_iteration_pane)
from .aligned_volumes import (ALIGNMENT_STAR, load_aligned_volumes,
                              build_aligned_volumes_table, build_aligned_volumes_pane)


JOB_VIEW_CLASS = 'JobView'
_SEP = '#'
_OPTION_SEP = ':'

_JOB_VIEWS = {}  # view id -> JobView


def job_view_value(job_id, view_id):
    return f'{job_id.rstrip("/")}{_SEP}{view_id}'


def parse_job_view_value(value):
    """ Return (job_id, view) of a job view output value. """
    job_id, view, _ = parse_job_view_option(value)
    return job_id, view


def parse_job_view_option(value):
    """ Return (job_id, view, option or None) of a job view output value. """
    job_id, sep, view_part = str(value or '').rpartition(_SEP)
    view_id, _, option = view_part.partition(_OPTION_SEP)
    if not sep or not job_id or view_id not in _JOB_VIEWS:
        raise Exception(f'Invalid job view: {value!r}')
    return job_id, _JOB_VIEWS[view_id], option or None


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
    job_id, view, option = parse_job_view_option(value)
    kwargs = {'option': option} if option else {}
    return view.table(resolve_project_root(root), _job_dir(root, job_id), **kwargs)


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


class WarpTsAlignProgressView(JobView):
    """ The aligned tilt series of a Warp TS alignment while it runs (or
    after a failure), as its output (aligned_tilt_series.star), that is only
    written when all of them are done: the same table, with the same
    viewers, from the files written so far, plus the status of each tilt
    series. emwrap builds the rows (WarpBaseTsAlign.alignmentProgress), as
    for the output, without writing anything in the job folder. The tilt
    series STAR of an aligned one is written to a temporary file to show it.
    """
    id = 'tsalign-progress'
    label = 'Alignment progress'
    jobtypes = ('emw-warp-tsalign',)
    source = 'job.star'
    statuses = ('Running', 'Failed', 'Aborted')
    # The table of the output (TomogramGroupMetadata.star.emwrap.tsalign)
    TYPE_KEY = 'tiltseriesaligned'
    STATUS_COL = {'id': 'alignStatus', 'label': 'Status', 'align': 'left',
                  'sortable': True}
    ALIGNED, NOT_ALIGNED = 'aligned', 'not aligned'
    PATH_COLS = ('rlnTomoTiltSeriesStarFile', 'rlnTiltSeriesAligned')

    def _progress(self, root, job_dir, ts_name=None):
        """ [(star_cells, table)] of the tilt series (see alignmentProgress),
        with the paths of star_cells relative to root, as in the output. """
        # Imported here: emwrap's Warp wrappers are only needed by this view
        from emwrap.warp.warp_tsalign import WarpTsAlign

        job = WarpTsAlign.fromJobFolder(root, job_dir)
        progress = []
        for ts_dict, table in job.alignmentProgress(ts_name):
            for col in self.PATH_COLS:
                if os.path.isabs(ts_dict.get(col) or ''):
                    ts_dict[col] = os.path.relpath(ts_dict[col], root)
            ts_dict['alignStatus'] = self.ALIGNED if table else self.NOT_ALIGNED
            progress.append((ts_dict, table))
        return progress

    def table(self, root, job_dir):
        from emhub.blueprints.api_viewers import build_tilt_series_table

        progress = self._progress(root, job_dir)
        aligned = sum(1 for _, table in progress if table)
        job_id = os.path.relpath(job_dir, root)
        return build_tilt_series_table(
            [ts_dict for ts_dict, _ in progress], self.TYPE_KEY, root=root,
            title=f'{self.label} — {job_id} ({aligned} of {len(progress)} aligned)',
            extra_columns=[self.STATUS_COL],
            extra_cells=lambda cells: {'alignStatus': cells['alignStatus']})

    def pane(self, root, job_dir, action_id, row_cells):
        from emhub.blueprints import api_viewers as av

        ts_name = row_cells.get('tomoName')
        progress = self._progress(root, job_dir, ts_name) if ts_name else []
        if not progress:
            raise Exception(f'Unknown tilt series of {self.label}: {ts_name!r}')
        ts_dict, table = progress[0]
        # The cells of the row now (it might be aligned since the table was loaded)
        row_cells = dict(row_cells, **av._table_view_row_cells(
            av.TABLE_VIEW_SPECS[self.TYPE_KEY], ts_dict))
        star_rel = row_cells.get('starFilePath')

        def _build(star_full):
            if action_id == 'ts-view':
                return av.build_tilt_series_grid_pane_content(
                    root, row_cells, star_rel, ts_name, star_full=star_full)
            if action_id == 'aligned-slices':
                stack_rel = av.resolve_row_aligned_stack_path(row_cells)
                if not stack_rel:
                    raise Exception('Missing aligned tilt series stack path')
                return av.build_tilt_series_viewer_pane_content(
                    root, star_rel, stack_rel, title=stack_rel, star_full=star_full)
            return av.build_series_star_pane_content(
                action_id, root, star_rel, ts_name, self.TYPE_KEY, star_full=star_full)

        if table is None:  # Not aligned: its input tilt series STAR
            return _build(None)

        with tempfile.TemporaryDirectory() as tmp:
            star_full = os.path.join(tmp, os.path.basename(star_rel))
            with StarFile(star_full, 'w') as sf:
                sf.writeTable(ts_name, table, computeFormat='left')
            return _build(star_full)


class CoordinatesCompareView(JobView):
    """ Results of emw-coordinates-compare: a row per tomogram with the
    number of coordinates of each set at a distance (the job's maximum
    distance, or another one of the 'Distance' select), and its tomogram
    with the sets in different colors (the distance can be changed there).
    See coordinates_compare. The job has no output sets, so this is the way
    to see its results. """
    id = 'coordinates-compare'
    label = 'Coordinates Distances'
    jobtypes = ('emw-coordinates-compare',)
    source = 'distances.npz'
    TOMO_ACTION = {'id': 'tomo-view', 'label': 'Tomogram', 'icon': 'tomogram'}
    # Edit action of the table of a set compared to itself
    REMOVE_ACTION = 'remove-duplicates'
    # Edit action of the table of two sets
    MERGE_ACTION = 'merge-sets'
    @staticmethod
    def _fmt(d):
        return f'{d:g}'

    def variant(self, cc, distance, edge=None):
        """ The option of the view: '<distance>[:<edge>]' (Å; edge 0: none). """
        value = f'{self.id}{_OPTION_SEP}{self._fmt(distance)}'
        return value + (f'{_OPTION_SEP}{self._fmt(edge or 0)}' if cc.has_edges else '')

    @staticmethod
    def _option(cc, option):
        """ (distance, edge) of a view option '<distance>[:<edge>]'; the
        job's maximum distance by default, and the edge distance the same
        as the distance (see CoordinatesCompare.resolve_edge). """
        parts = (option or '').split(_OPTION_SEP)
        try:
            distance = float(parts[0]) if parts[0] else cc.max_distance
        except ValueError:
            raise Exception(f'Invalid distance: {option!r}')
        if not distance > 0:
            raise Exception(f'Invalid distance: {option!r}')
        return distance, cc.resolve_edge(parts[1] if len(parts) > 1 else None, distance)

    @staticmethod
    def _edge_column(cc):
        """ The Near edge column, if the job stored the edge distances. """
        return [('edge', 'Near edge')] if cc.has_edges else []

    def table(self, root, job_dir, option=None):
        from .coordinates_compare import CoordinatesCompare, MERGE_PARTS

        cc = CoordinatesCompare(root, job_dir)
        distance, edge = self._option(cc, option)
        if cc.compare_self:
            columns = [('coords', 'Coordinates')] + self._edge_column(cc) + [
                ('duplicates', 'Duplicates'), ('kept', 'Kept')]
            case = 'duplicates, ' + (f'keeping the highest {cc.score_column}'
                                     if cc.score_column else 'no score')
        else:
            columns = [('a', 'A'), ('b', 'B')] + self._edge_column(cc) + [
                ('aMinusB', 'A - B'), ('bMinusA', 'B - A'), ('aAndB', 'A & B')]
            case = 'A vs B'
        rows, totals = [], {}
        for tomo, counts in cc.counts(distance, edge):
            if not cc.has_edges:
                counts.pop('edge')
            for k, v in counts.items():
                totals[k] = totals.get(k, 0) + v
            cells = dict(counts, tomoName=tomo, distance=distance, edgeDistance=edge or 0)
            row = {'id': tomo, 'cells': cells, 'actions': [],
                   'defaultAction': dict(self.TOMO_ACTION), 'cellContexts': {}}
            if cc.tomogram(tomo):
                row['cellContexts']['tomo'] = {'actions': [dict(self.TOMO_ACTION)]}
            if not cc.compare_self:
                # The sets to merge (Merge), all selected, next to their count
                for col in MERGE_PARTS:
                    row['cellContexts'][col] = {'edit': {
                        'type': 'boolean', 'field': col, 'checked': True,
                        'disabled': not counts[col]}}
            rows.append(row)
        summary = ', '.join(f'{label}: {totals.get(k, 0)}' for k, label in columns)
        job_id = os.path.relpath(job_dir, root)
        table = {
            'title': (f'{self.label} — {job_id} ({case}, {self._fmt(distance)} Å'
                      + (f', edge {self._fmt(edge)} Å' if edge else '') + '; '
                      f'{len(rows)} tomograms; {summary})'),
            'columns': (
                [{'id': 'tomoName', 'label': 'Tomo name', 'align': 'left', 'sortable': True}]
                + [{'id': k, 'label': label, 'align': 'right', 'sortable': True}
                   for k, label in columns]
                + [{'id': 'tomo', 'label': 'Tomogram'}]),
            'rows': rows,
        }
        # The distances are chosen in the tomogram viewer: the table follows
        # them (variants.template with its values, loaded in place)
        values = {'distance': distance}
        template = f'{self.id}{_OPTION_SEP}{{distance}}'
        if cc.has_edges:
            values['edge'] = edge or 0
            template += f'{_OPTION_SEP}{{edge}}'
        table['variants'] = {
            'label': 'Distance (Å)',
            'value': self.variant(cc, distance, edge),
            'options': [],
            'template': template,
            'values': values,
        }
        if cc.compare_self:
            # A subset without the duplicates at this distance and those
            # near the edges (the host launches it with remove_duplicates)
            table['editActions'] = [{
                'id': self.REMOVE_ACTION,
                # At the distances of the inputs
                'label': 'Remove duplicates / edges' if edge else 'Remove duplicates',
                'disabled': not (totals.get('duplicates') or totals.get('edge')),
            }]
        else:
            # A set without the overlapping coordinates of A and B (those
            # checked of each row; the host launches it with merge_sets)
            table['editActions'] = [{'id': self.MERGE_ACTION, 'label': 'Merge'}]
        if rows:
            table['initialAction'] = {'rowId': rows[0]['id'], 'actionId': self.TOMO_ACTION['id']}
        return table

    def pane(self, root, job_dir, action_id, row_cells):
        from emhub.blueprints.api_viewers import build_tomogram_volume_slider_pane_content
        from .coordinates_compare import CoordinatesCompare

        if action_id != self.TOMO_ACTION['id']:
            raise Exception(f'Unknown action {action_id!r} of {self.label}')
        cc = CoordinatesCompare(root, job_dir)
        tomo = row_cells.get('tomoName')
        tomo_rel = cc.tomogram(tomo) if tomo else None
        if not tomo_rel:
            raise Exception(f'No tomogram for {tomo!r} in the input sets')
        distance = float(row_cells.get('distance') or cc.max_distance)
        edge = cc.resolve_edge(row_cells.get('edgeDistance'), distance)
        return build_tomogram_volume_slider_pane_content(
            root, tomo_rel, title=f'Tomogram — {tomo}',
            coordinates=cc.coordinates(tomo, distance, edge))


class AlignedVolumesView(JobView):
    """ How the references of an emw-aligned-volumes job were aligned to the
    map of the particle poses: a row per reference with its CC before and
    after, rotation and shift, and its volumes; the CC plots, the similarity
    matrix of the references and all of them in 3D (see aligned_volumes). """
    id = 'aligned-volumes'
    label = 'Analyze Results'
    jobtypes = ('emw-aligned-volumes',)
    source = ALIGNMENT_STAR

    def table(self, root, job_dir):
        job_id = os.path.relpath(job_dir, root)
        return build_aligned_volumes_table(load_aligned_volumes(root, job_dir),
                                           f'{self.label} — {job_id}')

    def pane(self, root, job_dir, action_id, row_cells):
        return build_aligned_volumes_pane(root, load_aligned_volumes(root, job_dir),
                                          action_id, row_cells)


register_job_view(CtfPlotsView())
register_job_view(MotionPlotsView())
register_job_view(RelionIterationsView())
register_job_view(WarpTsAlignProgressView())
register_job_view(CoordinatesCompareView())
register_job_view(AlignedVolumesView())
