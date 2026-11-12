"""
'Analyze Results' job view of Relion Class3D / Refine3D jobs (see
emhub.data.processing.relion_iterations): the iterations read from the
optimiser and model STAR files (as Relion 5 writes them), the table and the
plots panes.
"""

import os
import tempfile
import unittest

from emhub.data.processing.job_views import (job_view_outputs, build_job_view_table,
                                             build_job_view_pane, job_view_value)
from emhub.data.processing.relion_iterations import map_iterations

OPTIMISER = """
# version 50001

data_optimiser_general

_rlnOutputRootName                    {job}/run
_rlnModelStarFile                     {model}
_rlnExperimentalDataStarFile          {job}/run_it{it:03d}_data.star
_rlnCurrentIteration                  {it}
_rlnOverallAccuracyRotations          {acc_rot}
_rlnOverallAccuracyTranslationsAngst  0.707400
_rlnChangesOptimalOrientations        {changes}
_rlnChangesOptimalOffsets             2.921834
_rlnChangesOptimalClasses             {changes_classes}
_rlnHasConverged                      {converged}
"""

MODEL_GENERAL = """
# version 50001

data_model_general

_rlnCurrentResolution                      {res}
_rlnPixelSize                               2.700000
_rlnNrClasses                                      {n}
_rlnAveragePmax                             0.697028

# version 50001

data_model_classes

loop_
_rlnReferenceImage #1
_rlnClassDistribution #2
_rlnAccuracyRotations #3
_rlnAccuracyTranslationsAngst #4
_rlnEstimatedResolution #5
{classes}
"""

MODEL_CLASS = """
# version 50001

data_model_class_{c}

loop_
_rlnSpectralIndex #1
_rlnResolution #2
_rlnAngstromResolution #3
_rlnSsnrMap #4
_rlnGoldStandardFsc #5
0 0.000000 999.000000 999.000000 1.000000
1 0.012346 81.000004 999.000000 1.000000
2 0.024691 40.500002 50.000000 0.990000
3 0.037037 27.000001 3.000000 0.500000
4 0.049383 20.250001 0.500000 0.100000
5 0.061728 16.200001 0.001001 0.000000
6 0.074074 13.500001 0.001001 0.000000
"""


class TestRelionIterations(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, path, text):
        fn = os.path.join(self.root, path)
        os.makedirs(os.path.dirname(fn), exist_ok=True)
        with open(fn, 'w') as f:
            f.write(text)

    def _iteration(self, job, prefix, it, n, res, model_suffix, final=False,
                   distributions=None):
        model = f'{job}/{prefix}{model_suffix}'
        distributions = distributions or [1 / n] * n
        vol = ('class{:03d}.mrc' if model_suffix == '_model.star'
               else 'half1_class{:03d}.mrc')
        classes = '\n'.join(f'{job}/{prefix}_{vol.format(c)} {d:f} 0.5 0.7 {res}'
                            for c, d in enumerate(distributions, 1))
        self._write(model, MODEL_GENERAL.format(res=res, n=n, classes=classes)
                    + ''.join(MODEL_CLASS.format(c=c) for c in range(1, n + 1)))
        self._write(f'{job}/{prefix}_optimiser.star', OPTIMISER.format(
            job=job, model=model, it=it, acc_rot=0.5 + 1 / (it + 1),
            changes=999 if it == 0 else 10 / it,
            changes_classes=9999999 if it == 0 else 0.1 / it,
            converged=int(final)))

    def _refine(self, job='Refine3D/job061', final=True, iters=4):
        for it in range(iters):
            self._iteration(job, f'run_it{it:03d}', it, 1, 20 - it, '_half1_model.star')
        if final:
            self._iteration(job, 'run', iters - 1, 1, 8.1, '_model.star', final=True)
        return job

    def _class3d(self, job='Class3D/job065'):
        for it in range(3):
            self._iteration(job, f'run_it{it:03d}', it, 3, 30 - it, '_model.star',
                            distributions=[0.5, 0.3 + 0.05 * it, 0.2 - 0.05 * it])
        return job

    def test_outputs(self):
        job = self._refine()
        outputs = job_view_outputs(job, 'relion.refine3d.tomo', os.path.join(self.root, job),
                                   'Running')
        self.assertEqual([o['outputName'] for o in outputs], ['Analyze Results'])
        self.assertEqual(outputs[0]['value'], f'{job}#relion-iterations')
        # Saved jobs (no files) have no view
        self.assertEqual(job_view_outputs(job, 'relion.refine3d.tomo',
                                          os.path.join(self.root, job), 'Saved'), [])
        # Other views only for finished jobs
        self.assertEqual(job_view_outputs(job, 'relion.ctffind.tomo',
                                          os.path.join(self.root, job), 'Running'), [])

    def test_refine_table(self):
        job = self._refine()
        table = build_job_view_table(self.root, job_view_value(job, 'relion-iterations'))
        # Overall first, then the last iteration first, without iteration 0
        self.assertEqual([r['cells']['it'] for r in table['rows']],
                         ['Overall', 'Final', 3, 2, 1])
        final = table['rows'][1]['cells']
        self.assertEqual(final['resolution'], 8.1)
        self.assertEqual(final['optimiser'], 'run_optimiser.star')
        self.assertNotIn('changesClasses', [c['id'] for c in table['columns']])
        # The final result shown when opened
        self.assertEqual(table['initialAction'],
                         {'rowId': 'run_optimiser.star', 'actionId': 'iteration'})
        self.assertNotIn('converged', [c['id'] for c in table['columns']])
        self.assertEqual(table['rows'][1]['defaultAction']['id'], 'iteration')
        self.assertEqual(table['rows'][1]['actions'], [])  # the map is in its results
        self.assertIn('3 iterations, 2.700 Å/px', table['title'])

    def test_refine_overall(self):
        job = self._refine()
        pane = build_job_view_pane(self.root, job_view_value(job, 'relion-iterations'),
                                   'overall', {'optimiser': 'overall'})
        self.assertEqual(pane['layout'], '2x2')
        cells = pane['cells']
        # The final result is plotted after the last iteration
        self.assertEqual(cells['topLeft']['figure']['data'][0]['x'], [1, 2, 3, 4])
        self.assertEqual(cells['bottomLeft']['title'], 'Pmax per iteration')
        self.assertEqual(cells['bottomRight']['title'], 'Accuracy per iteration')

    def test_refine_iteration(self):
        """ The map on the left (both rows), FSC and SSNR on the right. """
        job = self._refine()
        it = os.path.join(self.root, job, 'run_it002_half1_class001.mrc')
        import numpy as np
        import mrcfile
        with mrcfile.new(it) as m:
            m.set_data(np.random.rand(16, 16, 16).astype(np.float32))
        pane = build_job_view_pane(self.root, job_view_value(job, 'relion-iterations'),
                                   'iteration', {'optimiser': 'run_it002_optimiser.star'})
        self.assertEqual(pane['layout'], 'span-left')
        cells = pane['cells']
        self.assertEqual(cells['left']['kind'], 'imageSlider')
        self.assertEqual(cells['left']['title'], 'Iteration 2 — half 1 map')
        fsc = cells['topRight']
        self.assertIn('FSC', fsc['title'])
        # Without the origin and the trailing zeros
        self.assertEqual(fsc['figure']['data'][0]['y'], [1.0, 0.99, 0.5, 0.1])
        # The resolution where the FSC crosses 0.143: between 27 and 20.25 Å
        x = 0.037037 + (0.5 - 0.143) * (0.049383 - 0.037037) / (0.5 - 0.1)
        note = fsc['figure']['layout']['annotations'][0]
        self.assertAlmostEqual(note['x'], x)
        self.assertEqual(note['text'], f'<b>{1 / x:0.2f} Å</b>')
        ssnr = cells['bottomRight']
        self.assertEqual(ssnr['figure']['layout']['yaxis']['type'], 'log')
        self.assertEqual(ssnr['figure']['data'][0]['y'], [None, 50.0, 3.0, 0.5])

    def test_refine_initial_values(self):
        """ Iteration 0 is skipped; Relion writes an 'inf' resolution and 999
        accuracies, not valid in the JSON (Infinity) or the plots. """
        import json
        job = self._refine()
        fn = os.path.join(self.root, job, 'run_it001_half1_model.star')
        with open(fn) as f:
            text = f.read().replace('_rlnCurrentResolution                      19',
                                    '_rlnCurrentResolution                      inf')
        with open(fn, 'w') as f:
            f.write(text)
        value = job_view_value(job, 'relion-iterations')
        table = build_job_view_table(self.root, value)
        json.dumps(table, allow_nan=False)
        self.assertIsNone(table['rows'][-1]['cells']['resolution'])
        pane = build_job_view_pane(self.root, value, 'overall', {'optimiser': 'overall'})
        json.dumps(pane, allow_nan=False)
        self.assertEqual(pane['cells']['topLeft']['figure']['data'][0]['x'], [2, 3, 4])

    def test_refine_running(self):
        """ Without the final result and an iteration being written. """
        job = self._refine(final=False)
        self._write(f'{job}/run_it004_optimiser.star', 'garbage')
        table = build_job_view_table(self.root, job_view_value(job, 'relion-iterations'))
        self.assertEqual([r['cells']['it'] for r in table['rows']], ['Overall', 3, 2, 1])
        # The last iteration shown when opened
        self.assertEqual(table['initialAction']['rowId'], 'run_it003_optimiser.star')

    def test_class3d(self):
        job = self._class3d()
        value = job_view_value(job, 'relion-iterations')
        table = build_job_view_table(self.root, value)
        self.assertEqual([r['cells']['it'] for r in table['rows']], ['Overall', 2, 1])
        cells = table['rows'][1]['cells']
        self.assertEqual(cells['classes'], 3)
        self.assertEqual(cells['changesClasses'], 5.0)  # 0.1 / 2, in %
        self.assertEqual(table['rows'][1]['actions'][0]['id'], 'volumes')

        pane = build_job_view_pane(self.root, value, 'overall', {'optimiser': 'overall'})
        dist = pane['cells']['bottomRight']['figure']['data']
        self.assertEqual(dist[1]['y'], [35.0, 40.0])
        self.assertEqual(pane['cells']['bottomLeft']['title'], 'Class resolution per iteration')
        changes = pane['cells']['topRight']['figure']['data']
        self.assertEqual([t['yaxis'] for t in changes], ['y', 'y', 'y2'])

        pane = build_job_view_pane(self.root, value, 'iteration',
                                   {'optimiser': 'run_it002_optimiser.star'})
        self.assertEqual(pane['layout'], 'cols')
        ssnr = pane['cells']['left']
        self.assertEqual(len(ssnr['figure']['data']), 3)
        self.assertEqual(ssnr['figure']['layout']['yaxis']['type'], 'log')
        self.assertEqual(pane['cells']['right']['figure']['data'][0]['y'], [50.0, 40.0, 10.0])

    def _maps(self, job, names):
        for name in names:
            self._write(f'{job}/{name}', '')

    def test_map_iterations_refine(self):
        # The series of a Refine3D map: half 1 of the iterations, the final
        # map last, with the FSC of each model (VolumeViewer's playback)
        job = self._refine()
        self._maps(job, [f'run_it{it:03d}_half{h}_class001.mrc' for it in range(4) for h in (1, 2)]
                   + ['run_class001.mrc', 'run_half1_class001_unfil.mrc'])
        data = map_iterations(os.path.join(self.root, job, 'run_class001.mrc'))
        items = data['items']
        self.assertEqual(data['classId'], 1)
        self.assertEqual([i['file'] for i in items],
                         [f'run_it{it:03d}_half1_class001.mrc' for it in range(4)] + ['run_class001.mrc'])
        self.assertEqual([i['label'] for i in items][-2:], ['Iteration 3', 'Final'])
        self.assertEqual(data['current'], 4)
        self.assertEqual(items[1]['resolution'], 19.0)
        self.assertEqual(items[-1]['resolution'], 8.1)
        # Without the origin and the frequencies not computed (FSC 0)
        self.assertEqual(items[-1]['fsc']['fsc'], [1.0, 0.99, 0.5, 0.1])
        self.assertEqual(len(items[-1]['fsc']['resolution']), 4)

    def test_map_iterations_class3d(self):
        job = self._class3d()
        self._maps(job, [f'run_it{it:03d}_class{c:03d}.mrc' for it in range(3) for c in (1, 2, 3)])
        data = map_iterations(os.path.join(self.root, job, 'run_it001_class002.mrc'))
        self.assertEqual([i['file'] for i in data['items']],
                         [f'run_it{it:03d}_class002.mrc' for it in range(3)])
        self.assertEqual(data['current'], 1)
        self.assertEqual([i['classDistribution'] for i in data['items']], [0.3, 0.35, 0.4])
        # Not a Relion map, or a single map: no series
        self.assertIsNone(map_iterations(os.path.join(self.root, job, 'other.mrc')))
        self._maps('Class3D/job066', ['run_it025_class001.mrc'])
        self.assertIsNone(map_iterations(os.path.join(self.root, 'Class3D/job066/run_it025_class001.mrc')))


if __name__ == '__main__':
    unittest.main()
