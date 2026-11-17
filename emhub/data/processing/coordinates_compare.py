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
        duplicates', the last one.  They are removed with an
        emw-remove-duplicates job (remove_duplicates()).
    case 2: A & B, the coordinates of A with a coordinate of B within the
        distance; A - B, the other ones of A; B - A, the coordinates of B
        without one of A within the distance.
"""

import json
import os
from collections import Counter

import numpy as np

from emtools.metadata import RelionStar
from emwrap.base.coordinates_compare import duplicates

from emhub.data.coords3d import (resolve_coords_set, load_tomogram_coordinates,
                                 _load_particles_table, _load_tomograms_table,
                                 _resolve_linked_path)

NPZ_FILE = 'distances.npz'

# Colors of the sets in the tomogram viewer (the first one is the color of
# the particles of a single set)
SELF_SETS = [
    {'id': 'kept', 'label': 'Kept', 'color': '#ffa500'},
    {'id': 'duplicates', 'label': 'Duplicates', 'color': '#ff2bd6'},
]
CROSS_SETS = [
    {'id': 'a-b', 'label': 'A - B', 'color': '#ffa500'},
    {'id': 'b-a', 'label': 'B - A', 'color': '#29b6f6'},
    {'id': 'a&b', 'label': 'A & B', 'color': '#4cd964'},
    # B coordinates near one of A: at the same place as those of A & B,
    # never drawn
    {'id': 'b&a', 'label': 'B & A', 'color': '#4cd964', 'hidden': True},
]


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


def tomo_sets(matrix, compare_self, distance, scores=None):
    """ Set of each coordinate of a tomogram at the distance (scores:
    of the coordinates compared to themselves, to keep the best duplicate).

    Returns (set_a, set_b): indexes in SELF_SETS (set_b None) or CROSS_SETS
    of the coordinates of A and B. """
    if compare_self:
        return duplicates(matrix, distance, scores).astype(np.int64), None
    near = np.asarray(matrix) <= distance
    a_in_b = near.any(axis=1) if near.size else np.zeros(near.shape[0], bool)
    b_in_a = near.any(axis=0) if near.size else np.zeros(near.shape[1], bool)
    return np.where(a_in_b, 2, 0), np.where(b_in_a, 3, 1)


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
        self._counts = {}
        self._tomograms = None

    @property
    def max_distance(self):
        return self.inputs['max_distance']

    @property
    def score_column(self):
        """ The score that keeps the best duplicate, None if there is none. """
        return self.summary.get('score_column') if self.compare_self else None

    @property
    def sets(self):
        return SELF_SETS if self.compare_self else CROSS_SETS

    def _set_path(self, which):
        """ The STAR file of A (input_set) or B (second_set; A when the
        set is compared to itself). """
        return self.inputs[which] or self.inputs['input_set']

    def _particle_counts(self, which):
        """ Counter {rlnTomoName: coordinates} of A or B, in its order. """
        if which not in self._counts:
            paths = resolve_coords_set(self.root, self._set_path(which))
            table = _load_particles_table(paths['particles_star'])
            self._counts[which] = Counter(row.rlnTomoName for row in table)
        return self._counts[which]

    def _sets(self, npz, tomo, distance):
        """ (set_a, set_b) of a tomogram; one only in A (or in B) was not
        compared: all its coordinates are Kept / A - B (B - A). """
        if tomo in npz.files:
            score = f'{tomo}.score'
            return tomo_sets(npz[tomo], self.compare_self, distance,
                             npz[score] if score in npz.files else None)
        set_a = np.zeros(self._particle_counts('input_set')[tomo], dtype=np.int64)
        if self.compare_self:
            return set_a, None
        return set_a, np.ones(self._particle_counts('second_set')[tomo], dtype=np.int64)

    def counts(self, distance):
        """ [(tomoName, {column: count})] of every tomogram of A (and B). """
        names = list(self._particle_counts('input_set'))
        if not self.compare_self:
            names += [t for t in self._particle_counts('second_set') if t not in names]
        rows = []
        with np.load(self.npz_path) as npz:
            for tomo in names:
                set_a, set_b = self._sets(npz, tomo, distance)
                if self.compare_self:
                    dup = int(set_a.sum())
                    rows.append((tomo, {'coords': len(set_a), 'duplicates': dup,
                                        'kept': len(set_a) - dup}))
                else:
                    ab, ba = int((set_a == 2).sum()), int((set_b == 3).sum())
                    rows.append((tomo, {'a': len(set_a), 'b': len(set_b),
                                        'aMinusB': len(set_a) - ab,
                                        'bMinusA': len(set_b) - ba, 'aAndB': ab}))
        return rows

    def tomo_sets(self, tomo, distance):
        """ {set, sets} of the coordinates of a tomogram (those of A, then
        those of B in case 2), for the tomogram viewer (it counts them). """
        with np.load(self.npz_path) as npz:
            set_a, set_b = self._sets(npz, tomo, distance)
        indexes = set_a.tolist() + ([] if set_b is None else set_b.tolist())
        return {'set': indexes, 'sets': self.sets, 'distance': distance}

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

    def coordinates(self, tomo, distance):
        """ VolumeViewer coordinates of a tomogram: those of A (and B), in
        tomogram pixels, with their set and the request to recompute the
        sets at another distance. """
        a = load_tomogram_coordinates(self.root, self.inputs['input_set'], tomo)
        parts = [a]
        if not self.compare_self:
            parts.append(load_tomogram_coordinates(
                self.root, self.inputs['second_set'], tomo))
        coords = {k: [v for p in parts for v in p[k]] for k in 'xyz'}
        if all(p.get('angles') for p in parts if p['x']):
            coords['angles'] = [v for p in parts for v in p.get('angles', [])]
        sets = self.tomo_sets(tomo, distance)
        if len(sets['set']) != len(coords['x']):
            raise Exception(
                f'The coordinates of {tomo} ({len(coords["x"])}) do not match '
                f'the distances of {self.job_id} ({len(sets["set"])}): the '
                'input sets changed since the job was run?')
        coords.update(set=sets['set'], sets=sets['sets'])
        coords['recompute'] = {
            'label': 'Distance',
            'unit': 'Å',
            'value': distance,
            'source': recompute_source(self.root, self.job_id, tomo),
        }
        return coords


def recompute_source(root, job_id, tomo):
    """ Request of the sets at another distance (the viewer adds 'distance'). """
    import flask
    try:
        url = flask.url_for('api.fetch_coordinates_compare_sets')
    except RuntimeError:  # outside a request
        url = '/api/fetch_coordinates_compare_sets'
    return {'path': url, 'payload': {'root': root, 'job': job_id, 'tomoName': tomo}}


def remove_duplicates(root, job_id, distance):
    """ Launch an emw-remove-duplicates job with the duplicates of the
    emw-coordinates-compare job (job_id, a set compared to itself) at the
    distance: the subset of its set without them. """
    from emtools.utils import Path
    from emhub.blueprints.api_viewers import processing_project_manager
    from emhub.data.processing import resolve_project_root

    root_abs = resolve_project_root(root)
    cc = CoordinatesCompare(root_abs, os.path.join(root_abs, job_id))
    if not cc.compare_self:
        raise Exception(f'{job_id} compared two sets: there are no duplicates to remove')
    distance = float(distance or cc.max_distance)
    if not distance > 0:
        raise Exception(f'Invalid distance: {distance}')
    dup = sum(counts['duplicates'] for _, counts in cc.counts(distance))
    pm = processing_project_manager(root_abs)
    job = pm.runJob('emw-remove-duplicates', {
        'input_distances': Path.rmslash(os.path.join(cc.job_id, NPZ_FILE)),
        'distance': distance,
    })
    by = f'highest {cc.score_column}' if cc.score_column else 'last one, no score'
    return {
        'success': True,
        'count': dup,
        'jobId': job.id,
        'sourceFile': cc.inputs['input_set'],
        'message': (f'Launched {job.id} job to remove {dup} duplicates at '
                    f'{distance:g} Å (kept the {by})'),
    }
