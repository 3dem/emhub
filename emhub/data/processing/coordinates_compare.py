"""Results of emwrap's emw-coordinates-compare job, for its job view
('Coordinates Distances', see job_views.CoordinatesCompareView).

The job compares the coordinates of a set A with a set B (case 2), or with
itself (case 1, to find duplicates), tomogram by tomogram, and keeps the
full distance matrix of each tomogram in distances.npz:

    <tomo>          float32 (nA, nB) distances in Angstrom
    <tomo>.index1   1-based rows of A (in its particles table)
    <tomo>.index2   1-based rows of B

so the sets can be recomputed here for any distance:

    case 1: duplicates (emwrap's coordinates_compare.duplicates): of the
        coordinates within the distance of each other, the one with the
        highest score is kept (<tomo>.score, stored by the job when the
        set has a score), or without scores, as Relion's 'remove
        duplicates', the last one.  They are removed with an emw-subset-ts
        job, 'Remove duplicate particles' mode (remove_duplicates()).
    case 2: A & B, the coordinates of A with a coordinate of B within the
        distance; A - B, the other ones of A; B - A, the coordinates of B
        without one of A within the distance.
"""

import json
import os
from collections import Counter

import numpy as np

from emtools.metadata import RelionStar
from emwrap.base.coordinates_compare import (duplicates, cross_sets, near_edge,
                                             tomo_positions, tomo_geometry,
                                             edge_distances)

from emhub.data.coords3d import (resolve_coords_set, load_tomogram_coordinates,
                                 _load_particles_table, _load_tomograms_table,
                                 _resolve_linked_path)

NPZ_FILE = 'distances.npz'

# Coordinates closer than the edge distance to the tomogram box edges (left
# out of the other sets), the last set
EDGE_SET = {'id': 'edge', 'label': 'Near edge', 'color': '#ff3b30'}

# Colors of the sets in the tomogram viewer (the first one is the color of
# the particles of a single set)
SELF_SETS = [
    {'id': 'kept', 'label': 'Kept', 'color': '#ffa500'},
    {'id': 'duplicates', 'label': 'Duplicates', 'color': '#ff2bd6'},
    EDGE_SET,
]
# The parts of emw-merge-sets (exclude_parts) of the sets of the A vs B table
# columns: A - B (only in A), B - A (only in B), A & B (overlap, from A)
MERGE_PARTS = {'aMinusB': 'set1', 'bMinusA': 'set2', 'aAndB': 'overlap'}

CROSS_SETS = [
    {'id': 'a-b', 'label': 'A - B', 'color': '#ffa500'},
    {'id': 'b-a', 'label': 'B - A', 'color': '#29b6f6'},
    {'id': 'a&b', 'label': 'A & B', 'color': '#4cd964'},
    # B coordinates near one of A: at the same place as those of A & B,
    # never drawn
    {'id': 'b&a', 'label': 'B & A', 'color': '#4cd964', 'hidden': True},
    EDGE_SET,
]
SELF_EDGE, CROSS_EDGE = SELF_SETS.index(EDGE_SET), CROSS_SETS.index(EDGE_SET)


def _float(value, default=None):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return v if v == v else default


def load_job_inputs(job_dir):
    """ The inputs of the job: {input_set, second_set, compare_self,
    max_distance}, from info.json (written by the job) or job.star. """
    inputs = {}
    info_file = os.path.join(job_dir, 'info.json')
    if os.path.exists(info_file):
        with open(info_file) as f:
            inputs = (json.load(f) or {}).get('inputs') or {}
    if not inputs.get('input_set'):
        job_star = os.path.join(job_dir, 'job.star')
        if os.path.exists(job_star):
            inputs = RelionStar.read_jobstar(job_star)
    compare_self = inputs.get('compare_self', False)
    if isinstance(compare_self, str):  # job.star values are already bools
        compare_self = RelionStar.true_value(compare_self)
    return {
        'input_set': (inputs.get('input_set') or '').strip(),
        'second_set': (inputs.get('second_set') or '').strip(),
        'compare_self': bool(compare_self),
        'max_distance': _float(inputs.get('max_distance'), 50.0),
    }


def load_job_summary(job_dir):
    """ The summary of the job (info.json), e.g. its 'score_column'. """
    info_file = os.path.join(job_dir, 'info.json')
    if os.path.exists(info_file):
        with open(info_file) as f:
            return (json.load(f) or {}).get('summary') or {}
    return {}


def tomo_sets(matrix, compare_self, distance, scores=None, edge_a=None, edge_b=None):
    """ Set of each coordinate of a tomogram at the distance (scores:
    of the coordinates compared to themselves, to keep the best duplicate).
    edge_a / edge_b: the coordinates of A / B near the tomogram edges (bool),
    in the Near edge set and left out of the others (as the subset and
    merge jobs do).

    Returns (set_a, set_b): indexes in SELF_SETS (set_b None) or CROSS_SETS
    of the coordinates of A and B. """
    matrix = np.asarray(matrix)
    n_a, n_b = matrix.shape
    va = np.ones(n_a, bool) if edge_a is None else ~np.asarray(edge_a)
    if compare_self:
        set_a = np.full(n_a, SELF_EDGE, dtype=np.int64)
        set_a[va] = duplicates(matrix[np.ix_(va, va)], distance,
                               None if scores is None else np.asarray(scores)[va])
        return set_a, None
    vb = np.ones(n_b, bool) if edge_b is None else ~np.asarray(edge_b)
    set_a = np.full(n_a, CROSS_EDGE, dtype=np.int64)
    set_b = np.full(n_b, CROSS_EDGE, dtype=np.int64)
    a_in_b, b_in_a = cross_sets(matrix[np.ix_(va, vb)], distance)
    set_a[va] = np.where(a_in_b, 2, 0)
    set_b[vb] = np.where(b_in_a, 3, 1)
    return set_a, set_b


class CoordinatesCompare:
    """ Results of an emw-coordinates-compare job folder. The input STAR
    files are read once per instance (one per request). """

    def __init__(self, root, job_dir):
        self.root = root
        self.job_dir = job_dir
        self.job_id = os.path.relpath(job_dir, root)
        self.inputs = load_job_inputs(job_dir)
        self.summary = load_job_summary(job_dir)
        self.compare_self = self.inputs['compare_self']
        self.npz_path = os.path.join(job_dir, NPZ_FILE)
        if not os.path.exists(self.npz_path):
            raise Exception(f'Missing {NPZ_FILE} in {self.job_id}')
        self._tables = {}
        self._counts = {}
        self._tomograms = None
        self._star_edges_cache = {}
        with np.load(self.npz_path) as npz:
            # Distances to the tomogram edges stored by the job (else they
            # are computed from the input sets, see _star_edges)
            self._npz_edges = any(k.endswith('.edge1') for k in npz.files)

    @property
    def has_edges(self):
        """ Whether the distances to the tomogram edges are known: stored
        by the job, or from the tomogram sizes of the input sets. """
        return self._npz_edges or self._star_edges('input_set') is not None

    def resolve_edge(self, edge, distance):
        """ The edge distance (Å) of a request: the duplicates (or A & B)
        distance if not given, None for 0 or without edges. """
        if edge is None or str(edge).strip() == '':
            return distance if self.has_edges else None
        edge = _float(edge)
        if edge is None or edge < 0:
            raise Exception(f'Invalid edge distance: {edge}')
        if edge and not self.has_edges:
            raise Exception(f'No tomogram sizes for the edges of {self.job_id} '
                            '(rlnTomoSizeX/Y/Z in its tomograms.star)')
        return edge or None

    @property
    def max_distance(self):
        return self.inputs['max_distance']

    @property
    def score_column(self):
        """ The score that keeps the best duplicate, None if there is none. """
        return self.summary.get('score_column') if self.compare_self else None

    @property
    def distance_set(self):
        """ Id of the set the distance decides: duplicates, or A & B. """
        return 'duplicates' if self.compare_self else 'a&b'

    @property
    def distance_title(self):
        return ('Coordinates closer than this distance to a kept one are duplicates'
                if self.compare_self else
                'Coordinates of A and B closer than this distance are in both (A & B)')

    @property
    def sets(self):
        return SELF_SETS if self.compare_self else CROSS_SETS

    def _set_path(self, which):
        """ The STAR file of A (input_set) or B (second_set; A when the
        set is compared to itself). """
        return self.inputs[which] or self.inputs['input_set']

    def _table(self, which):
        """ (particles table, resolve_coords_set paths) of A or B. """
        if which not in self._tables:
            paths = resolve_coords_set(self.root, self._set_path(which))
            self._tables[which] = (_load_particles_table(paths['particles_star']), paths)
        return self._tables[which]

    def _particle_counts(self, which):
        """ Counter {rlnTomoName: coordinates} of A or B, in its order. """
        if which not in self._counts:
            table, _ = self._table(which)
            self._counts[which] = Counter(row.rlnTomoName for row in table)
        return self._counts[which]

    def _star_edges(self, which):
        """ {tomoName: distances to the tomogram edges} of the coordinates of
        A or B computed from its STAR files (as the job stores them, for the
        jobs that did not); None without the tomogram sizes. """
        if which not in self._star_edges_cache:
            edges = None
            table, paths = self._table(which)
            if paths.get('tomograms_star'):
                tomograms = tomo_geometry(paths['tomograms_star'])
                if tomograms and all(g['size'] is not None for g in tomograms.values()):
                    try:
                        positions = tomo_positions(table, tomograms)
                        edges = {t: edge_distances(p, tomograms[t]['size'])
                                 for t, (_, p, _) in positions.items() if t in tomograms}
                    except Exception:  # e.g. pixel coordinates of unknown tomograms
                        edges = None
            self._star_edges_cache[which] = edges
        return self._star_edges_cache[which]

    @staticmethod
    def _npz(npz, key):
        return npz[key] if key in npz.files else None

    def _edges(self, npz, tomo, edge):
        """ (edge_a, edge_b): the coordinates of A and B of a tomogram near
        its edges (None without an edge or the job did not store them). """
        if not edge:
            return None, None
        if self._npz_edges:
            edges = [self._npz(npz, f'{tomo}.edge{i}') for i in (1, 2)]
        else:
            edges = [(self._star_edges(w) or {}).get(tomo)
                     for w in ('input_set', 'second_set')]
        if self.compare_self:
            edges[1] = edges[0]
        return tuple(None if e is None else near_edge(e, edge) for e in edges)

    def _sets(self, npz, tomo, distance, edge=None):
        """ (set_a, set_b) of a tomogram; one only in A (or in B) was not
        compared: all its coordinates are Kept / A - B (B - A), or near the
        edges. """
        edge_a, edge_b = self._edges(npz, tomo, edge)
        if tomo in npz.files:
            return tomo_sets(npz[tomo], self.compare_self, distance,
                             self._npz(npz, f'{tomo}.score'), edge_a, edge_b)
        set_a = np.zeros(self._particle_counts('input_set')[tomo], dtype=np.int64)
        if edge_a is not None:
            set_a[edge_a] = SELF_EDGE if self.compare_self else CROSS_EDGE
        if self.compare_self:
            return set_a, None
        set_b = np.ones(self._particle_counts('second_set')[tomo], dtype=np.int64)
        if edge_b is not None:
            set_b[edge_b] = CROSS_EDGE
        return set_a, set_b

    def counts(self, distance, edge=None):
        """ [(tomoName, {column: count})] of every tomogram of A (and B). """
        names = list(self._particle_counts('input_set'))
        if not self.compare_self:
            names += [t for t in self._particle_counts('second_set') if t not in names]
        rows = []
        with np.load(self.npz_path) as npz:
            for tomo in names:
                set_a, set_b = self._sets(npz, tomo, distance, edge)
                n = lambda s, k: int((s == k).sum())
                if self.compare_self:
                    rows.append((tomo, {'coords': len(set_a), 'edge': n(set_a, SELF_EDGE),
                                        'duplicates': n(set_a, 1), 'kept': n(set_a, 0)}))
                else:
                    rows.append((tomo, {'a': len(set_a), 'b': len(set_b),
                                        'aMinusB': n(set_a, 0), 'bMinusA': n(set_b, 1),
                                        'aAndB': n(set_a, 2),
                                        'edge': n(set_a, CROSS_EDGE) + n(set_b, CROSS_EDGE)}))
        return rows

    def tomo_sets(self, tomo, distance, edge=None):
        """ {set, sets} of the coordinates of a tomogram (those of A, then
        those of B in case 2), for the tomogram viewer (it counts them). """
        with np.load(self.npz_path) as npz:
            set_a, set_b = self._sets(npz, tomo, distance, edge)
        indexes = set_a.tolist() + ([] if set_b is None else set_b.tolist())
        return {'set': indexes, 'sets': self.sets, 'distance': distance, 'edge': edge}

    def tomogram(self, tomo):
        """ Path (project relative) of the tomogram, from the tomograms.star
        of A (or B), as coords3d resolves it; None if there is none. """
        if self._tomograms is None:
            self._tomograms = {}
            for which in ('second_set', 'input_set'):  # A wins
                paths = resolve_coords_set(self.root, self._set_path(which))
                if not paths.get('tomograms_star'):
                    continue
                for row in _load_tomograms_table(paths['tomograms_star']):
                    path = _resolve_linked_path(paths['tomograms_star'],
                                                RelionStar.getTomogram(row), self.root)
                    self._tomograms[row.rlnTomoName] = os.path.relpath(path, self.root)
        return self._tomograms.get(tomo)

    def coordinates(self, tomo, distance, edge=None):
        """ VolumeViewer coordinates of a tomogram: those of A (and B), in
        tomogram pixels, with their set and the request to recompute the
        sets at another distance (and edge distance). """
        a = load_tomogram_coordinates(self.root, self.inputs['input_set'], tomo)
        parts = [a]
        if not self.compare_self:
            parts.append(load_tomogram_coordinates(
                self.root, self.inputs['second_set'], tomo))
        coords = {k: [v for p in parts for v in p[k]] for k in 'xyz'}
        if all(p.get('angles') for p in parts if p['x']):
            coords['angles'] = [v for p in parts for v in p.get('angles', [])]
        sets = self.tomo_sets(tomo, distance, edge)
        if len(sets['set']) != len(coords['x']):
            raise Exception(
                f'The coordinates of {tomo} ({len(coords["x"])}) do not match '
                f'the distances of {self.job_id} ({len(sets["set"])}): the '
                'input sets changed since the job was run?')
        coords.update(set=sets['set'], sets=sets['sets'])
        # Each input in the group of the set it decides
        inputs = [{'id': 'distance', 'set': self.distance_set, 'label': 'within',
                   'unit': 'Å', 'value': distance, 'title': self.distance_title}]
        if self.has_edges:
            # A margin: drawn over the tomogram, translucent
            inputs.append({'id': 'edge', 'set': EDGE_SET['id'], 'label': 'within',
                           'unit': 'Å', 'value': edge or 0, 'margin': True,
                           'title': 'Coordinates closer than this distance to the '
                                    'tomogram box edges (0: none)'})
        coords['recompute'] = {
            'inputs': inputs,
            'source': recompute_source(self.root, self.job_id, tomo),
        }
        return coords


def recompute_source(root, job_id, tomo):
    """ Request of the sets at another distance (the viewer adds 'distance'
    and 'edge'). """
    import flask
    try:
        url = flask.url_for('api.fetch_coordinates_compare_sets')
    except RuntimeError:  # outside a request
        url = '/api/fetch_coordinates_compare_sets'
    return {'path': url, 'payload': {'root': root, 'job': job_id, 'tomoName': tomo}}


def remove_duplicates(root, job_id, distance, edge=None):
    """ Launch an emw-subset-ts job ('Remove duplicate particles' mode) with
    the set of the emw-coordinates-compare job (job_id, a set compared to
    itself) and the distance: the subset of its set without the duplicates.
    The subset job computes the distances again (with the same rule,
    emwrap's coordinates_compare.duplicates), so the count is the one of
    the table if the set did not change. """
    from emwrap.base.subset_ts import MODE_REMOVE_DUPLICATES
    from emhub.blueprints.api_viewers import processing_project_manager
    from emhub.data.processing import resolve_project_root

    root_abs = resolve_project_root(root)
    cc = CoordinatesCompare(root_abs, os.path.join(root_abs, job_id))
    if not cc.compare_self:
        raise Exception(f'{job_id} compared two sets: there are no duplicates to remove')
    distance = float(distance or cc.max_distance)
    if not distance > 0:
        raise Exception(f'Invalid distance: {distance}')
    edge = cc.resolve_edge(edge, distance)
    counts = [c for _, c in cc.counts(distance, edge)]
    dup = sum(c['duplicates'] for c in counts)
    n_edge = sum(c['edge'] for c in counts)
    params = {
        'input_set': cc.inputs['input_set'],
        'mode': str(MODE_REMOVE_DUPLICATES),
        'subset_duplicates_distance': distance,
    }
    if edge:
        params['subset_edge_distance'] = edge
    pm = processing_project_manager(root_abs)
    job = pm.runJob('emw-subset-ts', params)
    by = f'highest {cc.score_column}' if cc.score_column else 'last one, no score'
    edge_text = f' and {n_edge} near the edges ({edge:g} Å)' if edge else ''
    return {
        'success': True,
        'count': dup + n_edge,
        'jobId': job.id,
        'sourceFile': cc.inputs['input_set'],
        'message': (f'Launched {job.id} job to remove {dup} duplicates at '
                    f'{distance:g} Å (kept the {by}){edge_text}'),
    }


def merge_sets(root, job_id, distance, exclude=None, edge=None):
    """ Launch an emw-merge-sets job with the sets A and B of the
    emw-coordinates-compare job (job_id, A vs B) without their overlapping
    coordinates at the distance: A - B, B - A and A & B (of A), but the
    excluded ones, [{tomoName, column}] (columns of MERGE_PARTS). The merge
    computes the distances again (as the compare job, see emwrap's
    coordinates_compare.cross_sets), writing the columns of both sets. """
    from emhub.blueprints.api_viewers import processing_project_manager
    from emhub.data.processing import resolve_project_root

    root_abs = resolve_project_root(root)
    cc = CoordinatesCompare(root_abs, os.path.join(root_abs, job_id))
    if cc.compare_self:
        raise Exception(f'{job_id} compared a set to itself: there is nothing to merge')
    distance = float(distance or cc.max_distance)
    if not distance > 0:
        raise Exception(f'Invalid distance: {distance}')

    edge = cc.resolve_edge(edge, distance)
    excluded = {}
    for item in exclude or []:
        part = MERGE_PARTS.get(item.get('column'))
        if not part or not item.get('tomoName'):
            raise Exception(f'Invalid excluded set: {item}')
        excluded.setdefault(str(item['tomoName']), []).append(part)
    count = 0
    for tomo, counts in cc.counts(distance, edge):
        count += sum(counts[col] for col, part in MERGE_PARTS.items()
                     if part not in excluded.get(tomo, []))
    if not count:
        raise Exception('Select at least one set with coordinates to merge')

    params = {
        'input_sets': [cc.inputs['input_set'], cc.inputs['second_set']],
        'overlap_distance': distance,
        'exclude_parts': [{'tomoName': t, 'parts': ' '.join(parts)}
                          for t, parts in excluded.items()],
        'common_columns': True,
    }
    if edge:
        params['edge_distance'] = edge
    pm = processing_project_manager(root_abs)
    job = pm.runJob('emw-merge-sets', params)
    n = sum(len(p) for p in excluded.values())
    return {
        'success': True,
        'count': count,
        'jobId': job.id,
        'sourceFile': cc.inputs['input_set'],
        'message': (f'Launched {job.id} job to merge {count} coordinates of A and B '
                    f'at {distance:g} Å' + (f' ({n} sets excluded)' if n else '')
                    + (f', without those near the edges ({edge:g} Å)' if edge else '')),
    }
