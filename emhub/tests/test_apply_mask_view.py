""" The tomograms with selection masks (emwrap's emw-apply-mask) in the
table viewer: the mask over the tomogram slices, the coordinates in / outside
of it, and the Apply mask actions of a TomoCoordinates table.

    python -m unittest emhub.tests.test_apply_mask_view
"""

import os
import tempfile
import unittest
from unittest import mock

import mrcfile
import numpy as np

from emhub.blueprints.api_viewers import (
    APPLY_MASK_ACTIONS, APPLY_MASK_SETS, MASK_SETS, apply_mask_coordinates,
    apply_mask_job_input, build_global_tilt_series_table,
    build_tomocoordinates_table, build_tomogram_volume_slider_pane_content,
    coordinates_mask_sets, create_apply_mask, row_tomo_mask)

# Tomograms of 20 x 20 x 10 voxels of 10 A; TS_02 has no mask
TOMOGRAMS_STAR = """
data_global

loop_
_rlnTomoName
_rlnTomoTiltSeriesStarFile
_rlnTomoTiltSeriesPixelSize
_rlnTomoTomogramBinning
_rlnTomoSizeX
_rlnTomoSizeY
_rlnTomoSizeZ
_rlnTomoReconstructedTomogram
_emwTomoMask
TS_01 Job/ts/TS_01.star 1.0 10.0 200 200 100 Job/TS_01.mrc Job/masks/TS_01.mrc
TS_02 Job/ts/TS_02.star 1.0 10.0 200 200 100 Job/TS_02.mrc None
"""

OPTIMISATION_SET = """
data_optimisation_set

loop_
_rlnTomoParticlesFile
_rlnTomoTomogramsFile
Job/particles.star Job/tomograms.star
"""

PARTICLES = """
data_particles

loop_
_rlnTomoName
_rlnCenteredCoordinateXAngst
_rlnCenteredCoordinateYAngst
_rlnCenteredCoordinateZAngst
TS_01 -50 0 0
TS_01 50 0 0
TS_02 0 0 0
"""


JOB_STAR = """
data_job

_rlnJobTypeLabel emw-apply-mask
_rlnJobIsContinue 0
_rlnJobIsTomo 0

data_joboptions_values

loop_
_rlnJobOptionVariable
_rlnJobOptionValue
input_set Job/optimisation_set.star
"""


class TestApplyMaskView(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        os.makedirs(self._p('Job/masks'))
        self._write('Job/tomograms.star', TOMOGRAMS_STAR)
        self._write('Job/optimisation_set.star', OPTIMISATION_SET)
        self._write('Job/particles.star', PARTICLES)
        for t in ('TS_01', 'TS_02'):
            self._mrc(f'Job/{t}.mrc', np.zeros((10, 20, 20), np.float32))
        mask = np.zeros((10, 20, 20), np.int8)
        mask[:, :, :10] = 1  # The left half
        self._mrc('Job/masks/TS_01.mrc', mask)

    def tearDown(self):
        self.tmp.cleanup()

    def _p(self, rel):
        return os.path.join(self.root, rel)

    def _write(self, rel, text):
        with open(self._p(rel), 'w') as f:
            f.write(text)

    def _mrc(self, rel, data):
        with mrcfile.new(self._p(rel), overwrite=True) as mrc:
            mrc.set_data(data)
            mrc.voxel_size = 10

    def test_tomograms_table(self):
        table = build_global_tilt_series_table(
            self._p('Job/tomograms.star'), 'tomograms', root=self.root)
        cells = {r['cells']['tomoName']: r['cells'] for r in table['rows']}
        self.assertEqual(row_tomo_mask(self.root, cells['TS_01']), 'Job/masks/TS_01.mrc')
        self.assertIsNone(row_tomo_mask(self.root, cells['TS_02']))
        # Not a column of the table
        self.assertNotIn('tomoMask', [c['id'] for c in table['columns']])
        self.assertNotIn('editActions', table)

    def test_pane_mask(self):
        pane = build_tomogram_volume_slider_pane_content(
            self.root, 'Job/TS_01.mrc', mask='Job/masks/TS_01.mrc')
        mask = pane['viewerConfig']['mask']
        self.assertEqual((mask['type'], mask['show'], mask['threshold']), ('map', True, 0.5))
        self.assertEqual(mask['density']['payload']['path'], 'Job/masks/TS_01.mrc')
        self.assertFalse(pane['viewerConfig']['tabs']['volume3d'])
        pane = build_tomogram_volume_slider_pane_content(self.root, 'Job/TS_01.mrc')
        self.assertNotIn('mask', pane['viewerConfig'])

    def test_coordinates_sets(self):
        coords = {'x': [5.0, 15.0, 30.0], 'y': [10.0, 10.0, 10.0], 'z': [5.0, 5.0, 5.0]}
        result = coordinates_mask_sets(self.root, coords, 'Job/masks/TS_01.mrc')
        # In the left half, in the right half, outside of the box (kept)
        self.assertEqual(result['set'], [0, 1, 0])
        self.assertEqual(result['sets'], MASK_SETS)
        self.assertEqual(result['x'], coords['x'])

    def test_coordinates_table(self):
        table = build_tomocoordinates_table('Job/optimisation_set.star', root=self.root)
        self.assertEqual([a['id'] for a in table['editActions']],
                         [a['id'] for a in APPLY_MASK_ACTIONS])
        # Without masks, no actions
        self._write('Job/tomograms.star', TOMOGRAMS_STAR.replace('Job/masks/TS_01.mrc', 'None'))
        table = build_tomocoordinates_table('Job/optimisation_set.star', root=self.root)
        self.assertNotIn('editActions', table)

    def test_menu_action(self):
        table = build_tomocoordinates_table('Job/optimisation_set.star', root=self.root)
        action, = table['editActions']
        self.assertEqual([o['id'] for o in action['options']],
                         ['apply-mask', 'apply-mask-invert'])

    def test_apply_mask_output(self):
        # An emw-apply-mask job (Mask/) that kept the first particle of TS_01
        os.makedirs(self._p('Mask'))
        self._write('Mask/job.star', JOB_STAR)
        self._write('Mask/optimisation_set.star', OPTIMISATION_SET.replace(
            'Job/particles.star', 'Mask/particles.star'))
        lines = PARTICLES.strip().split('\n')
        self._write('Mask/particles.star', '\n'.join(lines[:-2]) + '\n')
        self.assertEqual(apply_mask_job_input(self.root, 'Mask/optimisation_set.star'),
                         'Job/optimisation_set.star')
        self.assertIsNone(apply_mask_job_input(self.root, 'Job/optimisation_set.star'))
        coords = apply_mask_coordinates(self.root, 'Mask/optimisation_set.star', 'TS_01')
        # Both particles of TS_01 of the input: kept, removed
        self.assertEqual(len(coords['x']), 2)
        self.assertEqual(coords['set'], [0, 1])
        self.assertEqual(coords['sets'], APPLY_MASK_SETS)
        self.assertIsNone(apply_mask_coordinates(self.root, 'Job/optimisation_set.star', 'TS_01'))

    def test_create_apply_mask(self):
        pm = mock.Mock()
        pm.runJob.return_value.id = 'EMwrap/job010'
        with mock.patch('emhub.blueprints.api_viewers.processing_project_manager',
                        return_value=pm):
            result = create_apply_mask(self.root, 'Job/optimisation_set.star', invert=True)
        pm.runJob.assert_called_once_with('emw-apply-mask', {
            'input_set': 'Job/optimisation_set.star', 'mask_source': '2',
            'invert': True, 'write_masks': False})
        self.assertEqual(result['jobId'], 'EMwrap/job010')
        with self.assertRaises(Exception):
            create_apply_mask(self.root, 'Job/tomograms.star')


if __name__ == '__main__':
    unittest.main()
