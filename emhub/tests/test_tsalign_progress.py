"""
'Alignment progress' job view of Warp TS alignment jobs (emw-warp-tsalign):
while the job runs, the table of its output (aligned_tilt_series.star) built
by emwrap from the files WarpTools wrote so far, without writing anything in
the job folder.
"""

import os
import tempfile
import unittest

import mrcfile
import numpy as np

from emtools.metadata import RelionStar

from emhub.tests.make_tomo_otf_project import write_project, N_TILTS, TILT_STEP
from emhub.data.processing.job_views import (job_view_outputs, build_job_view_table,
                                             build_job_view_pane, job_view_value,
                                             JOB_VIEW_CLASS)

JOB = 'WarpTsAlign/job010'
INPUT = 'WarpMctf/job003/tilt_series.star'
JOBTYPE = 'emw-warp-tsalign'


class TestTsAlignProgressView(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        write_project(self.root, n_ts=3, analyses=0)
        self.job_dir = os.path.join(self.root, JOB)
        os.makedirs(self.job_dir)
        RelionStar.write_jobstar(JOBTYPE, {
            'input_tiltseries': INPUT,
            'method': '0',
            'ts_aretomo.angpix': '10',
        }, os.path.join(self.job_dir, 'job.star'), isTomo=1)
        # Only TS_0001 aligned so far (AreTomo2 files, as WarpTools writes them)
        ts_dir = os.path.join(self.job_dir, 'warp_tiltseries', 'tiltstack', 'TS_0001')
        imod_dir = os.path.join(ts_dir, 'TS_0001_Imod')
        os.makedirs(imod_dir)
        angles = [-60 + i * TILT_STEP for i in range(N_TILTS)]
        with mrcfile.new(os.path.join(ts_dir, 'TS_0001_aligned.mrc')) as mrc:
            mrc.set_data(np.random.rand(N_TILTS, 16, 16).astype(np.float32))
            mrc.voxel_size = 10
        with open(os.path.join(imod_dir, 'TS_0001_st.xf'), 'w') as f:
            f.writelines('1 0 0 1 2.5 -1.0\n' for _ in angles)
        with open(os.path.join(imod_dir, 'TS_0001_st.tlt'), 'w') as f:
            f.writelines(f'{a}\n' for a in angles)

    def tearDown(self):
        self._tmp.cleanup()

    def _files(self):
        return sorted(os.path.join(d, f) for d, _, fs in os.walk(self.job_dir) for f in fs)

    def test_outputs(self):
        outputs = job_view_outputs(JOB, JOBTYPE, self.job_dir, 'Running')
        self.assertEqual([o['value'] for o in outputs],
                         [job_view_value(JOB, 'tsalign-progress')])
        self.assertEqual(outputs[0]['pointerClass'], JOB_VIEW_CLASS)
        # Once succeeded, the real output is there
        self.assertEqual(job_view_outputs(JOB, JOBTYPE, self.job_dir, 'Succeeded'), [])

    def test_table_and_panes(self):
        files = self._files()
        value = job_view_value(JOB, 'tsalign-progress')
        table = build_job_view_table(self.root, value)
        self.assertIn('1 of 3 aligned', table['title'])
        self.assertEqual([c['id'] for c in table['columns']][:2], ['tomoName', 'alignStatus'])
        rows = {r['id']: r['cells'] for r in table['rows']}
        self.assertEqual(rows['TS_0001']['alignStatus'], 'aligned')
        self.assertEqual(rows['TS_0001']['starFilePath'], f'{JOB}/tilt_series/TS_0001.star')
        self.assertEqual(rows['TS_0001']['alignedStackPath'],
                         f'{JOB}/warp_tiltseries/tiltstack/TS_0001/TS_0001_aligned.mrc')
        self.assertEqual(rows['TS_0002']['alignStatus'], 'not aligned')
        self.assertEqual(rows['TS_0002']['starFilePath'],
                         'WarpMctf/job003/tilt_series/TS_0002.star')
        self.assertEqual(rows['TS_0002']['alignedStackPath'], '')

        # Aligned: the viewer with the alignment, as for the output
        grid = build_job_view_pane(self.root, value, 'ts-view', rows['TS_0001'])
        self.assertEqual(grid['kind'], 'grid')
        ts = grid['cells']['topLeft']
        self.assertEqual(ts['kind'], 'tiltSeries')
        self.assertTrue(ts['hasAlignment'])
        self.assertEqual(len(ts['tilts']), N_TILTS)
        self.assertEqual(grid['cells']['topRight']['kind'], 'plotly')
        meta = build_job_view_pane(self.root, value, 'metadata', rows['TS_0001'])
        self.assertIn('rlnTomoXShiftAngst', meta['text'])

        # Not aligned yet: its input tilt series
        grid = build_job_view_pane(self.root, value, 'ts-view', rows['TS_0002'])
        self.assertEqual(grid['cells']['topRight']['kind'], 'plotly')
        meta = build_job_view_pane(self.root, value, 'metadata', rows['TS_0002'])
        self.assertNotIn('rlnTomoXShiftAngst', meta['text'])

        # Nothing written in the job folder
        self.assertEqual(self._files(), files)


if __name__ == '__main__':
    unittest.main()
