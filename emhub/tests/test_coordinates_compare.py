"""
'Coordinates Distances' job view of emwrap's emw-coordinates-compare (see
emhub.data.processing.coordinates_compare): the sets recomputed from the
distances of distances.npz at any distance, the table of counts per
tomogram and the coordinates (with their sets) of the tomogram viewer.
"""

import json
import os
import tempfile
import unittest
from unittest import mock

import numpy as np

from emhub.data.processing.job_views import (job_view_outputs, build_job_view_table,
                                             job_view_value)
from emhub.data.processing.coordinates_compare import (CoordinatesCompare, tomo_sets,
                                                       remove_duplicates)

TOMOGRAMS = """
data_global

loop_
_rlnTomoName
_rlnTomoTiltSeriesPixelSize
_rlnTomoTomogramBinning
_rlnTomoSizeX
_rlnTomoSizeY
_rlnTomoSizeZ
_rlnTomoReconstructedTomogram
TS_01 1.0 10.0 1000 1000 500 Tomograms/TS_01.mrc
TS_02 1.0 10.0 1000 1000 500 Tomograms/TS_02.mrc
"""

PARTICLES_HEADER = """
data_particles

loop_
_rlnTomoName
_rlnCenteredCoordinateXAngst
_rlnCenteredCoordinateYAngst
_rlnCenteredCoordinateZAngst
"""

OPTIMISATION_SET = """
data_optimisation_set

loop_
_rlnTomoParticlesFile
_rlnTomoTomogramsFile
{particles} Tomograms/tomograms.star
"""

# Set A: TS_01 (3 coordinates, the last two 20 A apart) and TS_02 (1)
A = [('TS_01', 0, 0, 0), ('TS_01', 100, 0, 0), ('TS_01', 120, 0, 0),
     ('TS_02', 0, 0, 0)]
# Set B: TS_01, one 10 A from A[0] and one far away (only in TS_01)
B = [('TS_01', 10, 0, 0), ('TS_01', 400, 0, 0)]


class TestCoordinatesCompare(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        os.makedirs(os.path.join(self.root, 'Tomograms'))
        self._write('Tomograms/tomograms.star', TOMOGRAMS)
        for name, coords in (('A', A), ('B', B)):
            lines = ''.join(f'{t} {x} {y} {z}\n' for t, x, y, z in coords)
            self._write(f'{name}/particles.star', PARTICLES_HEADER + lines)
            self._write(f'{name}/optimisation_set.star',
                        OPTIMISATION_SET.format(particles=f'{name}/particles.star'))

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, rel, text):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write(text)

    def _job(self, job_id, second, max_distance):
        """ A job folder as emw-coordinates-compare writes it. """
        sets = {'TS_01': ([c for c in A if c[0] == 'TS_01'],
                          [c for c in (second or A) if c[0] == 'TS_01'])}
        if second is None:
            sets['TS_02'] = ([A[3]], [A[3]])
        arrays = {}
        for tomo, (s1, s2) in sets.items():
            p1 = np.array([c[1:] for c in s1], float)
            p2 = np.array([c[1:] for c in s2], float)
            arrays[tomo] = np.linalg.norm(p1[:, None] - p2[None], axis=2).astype(np.float32)
            arrays[f'{tomo}.index1'] = np.arange(1, len(s1) + 1)
            arrays[f'{tomo}.index2'] = np.arange(1, len(s2) + 1)
        job_dir = os.path.join(self.root, job_id)
        os.makedirs(job_dir)
        np.savez(os.path.join(job_dir, 'distances.npz'), **arrays)
        inputs = {'input_set': 'A/optimisation_set.star',
                  'second_set': '' if second is None else 'B/optimisation_set.star',
                  'compare_self': second is None, 'max_distance': max_distance}
        with open(os.path.join(job_dir, 'info.json'), 'w') as f:
            json.dump({'inputs': inputs}, f)
        return job_id

    def test_tomo_sets(self):
        d = np.array([[0, 5, 50], [5, 0, 50], [50, 50, 0]], float)
        # Self: 0 is a duplicate of 1 (a later one), 1 and 2 are kept
        set_a, set_b = tomo_sets(d, True, 10)
        self.assertEqual(set_a.tolist(), [1, 0, 0])
        self.assertIsNone(set_b)
        # A vs B: A & B = 2, A - B = 0, B & A = 3, B - A = 1
        set_a, set_b = tomo_sets(d[:2, :], False, 10)
        self.assertEqual(set_a.tolist(), [2, 2])
        self.assertEqual(set_b.tolist(), [3, 3, 1])

    def test_tomo_sets_scores(self):
        # A chain 0 - 1 - 2, 10 A apart, at 15 A
        x = np.array([0, 10, 20], float)
        d = np.abs(x[:, None] - x[None])
        # Without scores, as Relion: only the last one is kept
        self.assertEqual(tomo_sets(d, True, 15)[0].tolist(), [1, 1, 0])
        # The highest score is kept, and the ones not near a kept one
        self.assertEqual(tomo_sets(d, True, 15, [1, 5, 1])[0].tolist(), [1, 0, 1])
        self.assertEqual(tomo_sets(d, True, 15, [5, 1, 5])[0].tolist(), [0, 1, 0])
        # Equal scores: the later one is kept first
        self.assertEqual(tomo_sets(d, True, 15, [2, 2, 2])[0].tolist(), [0, 1, 0])

    def test_self(self):
        job = self._job('External/job001', None, 30)
        outputs = job_view_outputs(job, 'emw-coordinates-compare', os.path.join(self.root, job))
        self.assertEqual([o['outputName'] for o in outputs], ['Coordinates Distances'])
        self.assertEqual(outputs[0]['pointerClass'], 'JobView')

        table = build_job_view_table(self.root, job_view_value(job, 'coordinates-compare'))
        cells = {r['id']: r['cells'] for r in table['rows']}
        self.assertEqual(cells['TS_01']['coords'], 3)
        self.assertEqual(cells['TS_01']['duplicates'], 1)  # 100 A, 20 A from 120 A
        self.assertEqual(cells['TS_02']['duplicates'], 0)
        self.assertEqual(table['variants']['value'], 'coordinates-compare:30')
        self.assertEqual(table['editActions'][0]['id'], 'remove-duplicates')
        self.assertFalse(table['editActions'][0]['disabled'])

        # Another distance (a variant of the table): no duplicates at 10 A
        table = build_job_view_table(self.root, f'{job}#coordinates-compare:10')
        self.assertEqual(table['rows'][0]['cells']['duplicates'], 0)
        self.assertEqual(table['rows'][0]['cells']['distance'], 10)
        self.assertTrue(table['editActions'][0]['disabled'])

    def test_self_scores(self):
        # The scores of TS_01 (stored by the job): 100 A is the best one,
        # so 120 A (20 A away) is the duplicate
        job = self._job('External/job003', None, 30)
        npz_file = os.path.join(self.root, job, 'distances.npz')
        with np.load(npz_file) as npz:
            arrays = dict(npz)
        arrays['TS_01.score'] = np.array([1, 9, 2], np.float32)
        np.savez(npz_file, **arrays)
        cc = CoordinatesCompare(self.root, os.path.join(self.root, job))
        self.assertEqual(cc.tomo_sets('TS_01', 30)['set'], [0, 0, 1])

    def test_remove_duplicates(self):
        job = self._job('External/job004', None, 30)
        pm = mock.Mock()
        pm.runJob.return_value.id = 'External/job005'
        with mock.patch('emhub.blueprints.api_viewers.processing_project_manager',
                        return_value=pm):
            result = remove_duplicates(self.root, job, '25')
        pm.runJob.assert_called_once_with('emw-remove-duplicates', {
            'input_distances': 'External/job004/distances.npz', 'distance': 25.0})
        self.assertEqual((result['jobId'], result['count']), ('External/job005', 1))
        # Not of a set compared to itself
        cross = self._job('External/job006', B, 30)
        with self.assertRaises(Exception):
            remove_duplicates(self.root, cross, '')

    def test_cross(self):
        job = self._job('External/job002', B, 30)
        table = build_job_view_table(self.root, job_view_value(job, 'coordinates-compare'))
        cells = {r['id']: r['cells'] for r in table['rows']}
        self.assertNotIn('editActions', table)
        self.assertEqual(cells['TS_01'], {'a': 3, 'b': 2, 'aMinusB': 2, 'bMinusA': 1,
                                          'aAndB': 1, 'tomoName': 'TS_01', 'distance': 30})
        # TS_02 is not in B: all of A is A - B
        self.assertEqual((cells['TS_02']['a'], cells['TS_02']['aMinusB'], cells['TS_02']['b']),
                         (1, 1, 0))

        cc = CoordinatesCompare(self.root, os.path.join(self.root, job))
        self.assertEqual(cc.tomogram('TS_01'), 'Tomograms/TS_01.mrc')
        coords = cc.coordinates('TS_01', 30)
        # A then B, in tomogram pixels (10 A/px, centered on 50 px)
        self.assertEqual(coords['x'], [50, 60, 62, 51, 90])
        self.assertEqual(coords['set'], [2, 0, 0, 3, 1])
        self.assertTrue(coords['sets'][3]['hidden'])
        self.assertEqual(coords['recompute']['value'], 30)
        self.assertEqual(coords['recompute']['source']['payload']['tomoName'], 'TS_01')

        # Recomputed at 500 A: everything is in both
        sets = cc.tomo_sets('TS_01', 500)
        self.assertEqual(sets['set'], [2, 2, 2, 3, 3])


if __name__ == '__main__':
    unittest.main()
