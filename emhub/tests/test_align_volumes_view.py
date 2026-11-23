# **************************************************************************
# *
# * Authors:     Daniel Marchan (danielmarchan3@gmail.com)
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# * This program is distributed in the hope that it will be useful,
# * but WITHOUT ANY WARRANTY; without even the implied warranty of
# * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# * GNU General Public License for more details.
# *
# **************************************************************************

"""
'Analyze Results' job view of emw-align-volumes jobs (see
emhub.data.processing.align_volumes), from the outputs of the job run on
synthetic volumes (needs emwrap).
"""

import os
import shutil
import tempfile
import unittest

from emhub.data.processing.job_views import (job_view_outputs, build_job_view_table,
                                             build_job_view_pane, job_view_value)

JOB = 'EMwrap/job050'
COPY_JOB = 'EMwrap/job051'


class TestAlignVolumesView(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        try:
            from emwrap.base import volume_align as va
            from emwrap.base.align_volumes import AlignVolumesPipeline
            from emwrap.tests.test_align_volumes import blobs, table, write, ANGPIX
        except ImportError as e:
            raise unittest.SkipTest(f'emwrap is needed: {e}')

        cls.root = tempfile.mkdtemp(prefix='emhub_align_volumes_')
        target = blobs()
        write(os.path.join(cls.root, 'Refine3D/job010/run_class001.mrc'), target, ANGPIX)
        R = va.rotvec_to_matrices([[0.0, 1.2, -0.5]])[0]
        write(os.path.join(cls.root, 'InitialModel/job020/run_it100_class001.mrc'),
              va.transform_volume(target, R=R), ANGPIX)
        write(os.path.join(cls.root, 'Reconstruct/job030/merged.mrc'), target, ANGPIX)
        output = os.path.join(cls.root, JOB)
        os.makedirs(output)
        cls.volumes = ['Reconstruct/job030/merged.mrc',
                       'InitialModel/job020/run_it100_class001.mrc']
        AlignVolumesPipeline({
            'working_dir': cls.root,
            'input_volumes': table(cls.volumes, ['nucleosome', 'membrane']), 'do_align': 'Yes',
            'align_reference': 'Refine3D/job010/run_class001.mrc', 'align_skip': '1',
            'align_angular_step': 45, 'align_lowpass': 20, 'threads': 2,
        }, output).prerun()
        cls.value = job_view_value(JOB, 'align-volumes')
        # The same volumes copied (no alignment map)
        output = os.path.join(cls.root, COPY_JOB)
        os.makedirs(output)
        AlignVolumesPipeline({
            'working_dir': cls.root, 'input_volumes': table(cls.volumes), 'do_align': 'No',
        }, output).prerun()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def test_outputs(self):
        outputs = job_view_outputs(JOB, 'emw-align-volumes', os.path.join(self.root, JOB))
        self.assertEqual([o['value'] for o in outputs], [self.value])
        self.assertEqual(outputs[0]['outputName'], 'Analyze Results')
        self.assertEqual(job_view_outputs(JOB, 'emw-align-volumes',
                                          os.path.join(self.root, 'Refine3D/job010')), [])

    def test_table(self):
        table = build_job_view_table(self.root, self.value)
        self.assertIn('2 references, 32 px, 8.000 Å/px, aligned to '
                      'Refine3D/job010/run_class001.mrc', table['title'])
        self.assertEqual([c['id'] for c in table['columns']][-1], 'show')
        rows = table['rows']
        self.assertEqual([r['id'] for r in rows],
                         ['overall', 'all', 'class1', 'class2'])
        self.assertEqual(table['initialAction'], {'rowId': 'overall', 'actionId': 'overall'})
        self.assertEqual(rows[1]['defaultAction']['id'], 'all')
        # Overall and All first also when the table is sorted
        self.assertEqual([r.get('pinned', False) for r in rows], [True, True, False, False])
        c1, c2 = rows[2]['cells'], rows[3]['cells']
        self.assertEqual((c1['cls'], c1['name'], c1['status']), (1, 'nucleosome', 'kept'))
        self.assertEqual((c2['name'], c2['source']), ('membrane', self.volumes[1]))
        self.assertTrue(c2['status'].startswith('aligned'), c2['status'])
        self.assertGreater(c2['ccAfter'], c2['ccBefore'])
        self.assertGreater(c2['rotation'], 0)
        self.assertEqual(rows[3]['defaultAction']['id'], 'volumes')
        self.assertEqual(rows[3]['cellContexts']['show']['actions'][0]['id'], 'volumes')

    def test_all_references(self):
        """ The map of the poses with every reference over it (overlays). """
        pane = build_job_view_pane(self.root, self.value, 'all', {'cls': 'All references'})
        config = pane['viewerConfig']
        self.assertEqual(config['overlaysMainLabel'], 'Map of the poses')
        self.assertEqual([o['label'] for o in config['overlays']], ['Class 1', 'Class 2'])
        self.assertEqual(config['overlays'][1]['description'],
                         'EMwrap/job050/ref_class002_membrane.mrc')
        self.assertEqual(config['overlays'][1]['density']['payload']['path'],
                         'EMwrap/job050/ref_class002_membrane.mrc')
        self.assertEqual(config['initialTab'], 'volume3d')
        # Without alignment: the others over the first reference
        value = job_view_value(COPY_JOB, 'align-volumes')
        config = build_job_view_pane(self.root, value, 'all', {})['viewerConfig']
        self.assertEqual(config['overlaysMainLabel'], 'Class 1')
        self.assertEqual(len(config['overlays']), 1)

    def test_similarity(self):
        # The map of the poses first (aligned), then the references
        pane = build_job_view_pane(self.root, self.value, 'similarity', {'cls': 'Similarity'})
        self.assertEqual(pane['kind'], 'plotly')
        heatmap = pane['figure']['data'][0]
        self.assertEqual(heatmap['type'], 'heatmap')
        self.assertEqual(heatmap['x'], ['Map (ref)', 'Class 1', 'Class 2'])
        self.assertIn('Class 1: nucleosome', heatmap['text'][1][2])
        z = heatmap['z']
        self.assertEqual([z[i][i] for i in range(3)], [1.0, 1.0, 1.0])
        self.assertEqual(z[1][2], z[2][1])
        self.assertGreater(z[1][2], 0.9)  # the aligned copy of the map
        self.assertIn('low-pass 20 Å', pane['title'])

    def test_overall(self):
        # The CC plot and the similarity matrix beside it
        pane = build_job_view_pane(self.root, self.value, 'overall', {'cls': 'Overall'})
        self.assertEqual((pane['kind'], pane['layout']), ('grid', 'cols'))
        self.assertEqual(pane['cells']['right']['figure']['data'][0]['type'], 'heatmap')
        pane = pane['cells']['left']
        self.assertEqual(pane['kind'], 'plotly')
        traces = pane['figure']['data']
        self.assertEqual([t['name'] for t in traces], ['Before', 'After', 'Next solution'])
        self.assertEqual(traces[1]['x'], ['1: nucleosome', '2: membrane'])
        self.assertGreater(traces[1]['y'][1], traces[0]['y'][1])

    def test_volumes(self):
        # Aligned: the map of the poses, the reference and the input volume
        pane = build_job_view_pane(self.root, self.value, 'volumes', {'cls': 2})
        self.assertEqual((pane['kind'], pane['layout']), ('grid', 'span-bottom'))
        cells = pane['cells']
        self.assertEqual(set(cells), {'topLeft', 'topRight', 'bottom'})
        self.assertTrue(cells['topLeft']['title'].startswith('Map of the poses'))
        self.assertIn('aligned, CC', cells['topRight']['title'])
        self.assertTrue(cells['bottom']['title'].startswith('Input volume, CC'))
        # Kept as it is: the map and the reference
        pane = build_job_view_pane(self.root, self.value, 'volumes', {'cls': 1})
        self.assertEqual((pane['layout'], set(pane['cells'])), ('cols', {'left', 'right'}))
        with self.assertRaises(Exception):
            build_job_view_pane(self.root, self.value, 'volumes', {'cls': 7})
        with self.assertRaises(Exception):
            build_job_view_pane(self.root, self.value, 'unknown', {'cls': 1})

    def test_copied(self):
        """ Without an alignment map: no CC columns nor Overall row, and the
        volumes pane only shows the reference. """
        value = job_view_value(COPY_JOB, 'align-volumes')
        table = build_job_view_table(self.root, value)
        self.assertNotIn('aligned to', table['title'])
        self.assertNotIn('ccAfter', [c['id'] for c in table['columns']])
        self.assertEqual([r['id'] for r in table['rows']],
                         ['similarity', 'all', 'class1', 'class2'])
        self.assertEqual([r['cells']['status'] for r in table['rows'][2:]],
                         ['copied', 'copied'])
        self.assertEqual(table['initialAction'],
                         {'rowId': 'similarity', 'actionId': 'similarity'})
        heatmap = build_job_view_pane(self.root, value, 'similarity', {})['figure']['data'][0]
        self.assertEqual(len(heatmap['z']), 2)  # no map of the poses
        self.assertLess(heatmap['z'][0][1], 0.9)  # not aligned
        pane = build_job_view_pane(self.root, value, 'volumes', {'cls': 2})
        self.assertNotEqual(pane['kind'], 'grid')
        self.assertEqual(pane['title'], 'Class 2: job020_run_it100_class001')

    def test_map_class(self):
        """ A reference that is the map of the poses (kept as it is) is
        'Class k (ref)': no row of its own for the map. """
        from emhub.data.processing.align_volumes import (load_align_volumes, map_class,
                                                         build_similarity_pane)
        data = load_align_volumes(self.root, os.path.join(self.root, JOB))
        self.assertIsNone(map_class(data))  # class 1 is another file
        data.references[0]['emwSourceImage'] = data.general['emwAlignReference']
        self.assertEqual(map_class(data), 1)
        heatmap = build_similarity_pane(data)['figure']['data'][0]
        self.assertEqual(heatmap['x'], ['Class 1 (ref)', 'Class 2'])
        self.assertEqual(len(heatmap['z']), 2)

    def test_similarity_computed(self):
        """ A job before the 'similarity' table: computed from the references. """
        from emhub.data.processing.align_volumes import (load_align_volumes,
                                                         compute_similarity)
        data = load_align_volumes(self.root, os.path.join(self.root, JOB))
        stored = dict(data.similarity)
        data.similarity = {}
        computed = compute_similarity(self.root, data)
        self.assertEqual(set(computed), set(stored))
        for k, v in stored.items():
            self.assertAlmostEqual(computed[k], v, places=3)

    def test_volumes_output(self):
        """ input_references.star is a Volumes output: a table of its maps. """
        from emhub.blueprints.api_viewers_spa import (resolve_spa_table_view_type,
                                                      build_spa_table, build_spa_pane_content)
        star = os.path.join(self.root, JOB, 'input_references.star')
        self.assertEqual(resolve_spa_table_view_type('Volumes', star), 'volumes')
        # Only from the datatype, not from its tables
        self.assertIsNone(resolve_spa_table_view_type('', star))
        table = build_spa_table(star, 'volumes', root=self.root)
        self.assertEqual(table['title'], 'Volumes (2 maps)')
        rows = table['rows']
        self.assertEqual([r['cells']['volume'] for r in rows],
                         ['2 maps', 'ref_class001_nucleosome.mrc', 'ref_class002_membrane.mrc'])
        self.assertEqual((rows[1]['cells']['dimensions'], rows[1]['cells']['pixelSize']),
                         ('32³', 8.0))
        pane = build_spa_pane_content('volume', self.root, 'volumes', rows[2]['cells'])
        self.assertEqual(pane['title'].split(' · ')[0], 'Class 2: ref_class002_membrane.mrc')
        # A gallery as Classes3D: a card per map, not the All maps row
        self.assertEqual(table['gallery']['actionId'], 'gallery')
        self.assertEqual([r.get('gallery', True) for r in rows], [False, True, True])
        card = build_spa_pane_content('gallery', self.root, 'volumes', rows[2]['cells'])
        self.assertEqual((card['title'], card['layout']), ('Class 2', 'volume'))
        self.assertTrue(card['density']['shape'])
        # All the maps: the first one with the other over it
        self.assertEqual(rows[0]['defaultAction']['id'], 'allmaps')
        # Its volume cell (the column action) shows all the maps too
        pane = build_spa_pane_content('volume', self.root, 'volumes', rows[0]['cells'])
        self.assertIn('overlays', pane['viewerConfig'])
        pane = build_spa_pane_content('allmaps', self.root, 'volumes', rows[0]['cells'])
        config = pane['viewerConfig']
        self.assertEqual(config['overlaysMainLabel'], 'Class 1')
        self.assertEqual([o['label'] for o in config['overlays']], ['Class 2'])

    def test_classes3d_all(self):
        """ The 3D classes of an iteration: an All row first, every class
        in the 3D volume tab (over class 1, or tiled). """
        from emhub.blueprints.api_viewers_spa import build_classes3d_table, build_spa_pane_content

        job = os.path.join(self.root, 'Class3D/job040')
        os.makedirs(job, exist_ok=True)
        for k in (1, 2):
            shutil.copy(os.path.join(self.root, 'Refine3D/job010/run_class001.mrc'),
                    os.path.join(job, f'run_it025_class00{k}.mrc'))
        with open(os.path.join(job, 'run_it025_model.star'), 'w') as f:
            f.write('data_model_general\n\n_rlnPixelSize 8.0\n\n'
                    'data_model_classes\n\nloop_\n_rlnReferenceImage #1\n_rlnEstimatedResolution #2\n'
                    'Class3D/job040/run_it025_class001.mrc 20.0\n'
                    'Class3D/job040/run_it025_class002.mrc 25.0\n\n')
        optimiser = os.path.join(job, 'run_it025_optimiser.star')
        open(optimiser, 'w').close()
        table = build_classes3d_table(optimiser)
        rows = table['rows']
        self.assertEqual([r['id'] for r in rows], ['all', 1, 2])
        self.assertEqual(rows[0]['defaultAction']['id'], 'allmaps')
        self.assertFalse(rows[0]['gallery'])
        # Not a class of a subset: its checkbox selects the others
        self.assertTrue(rows[0]['selectAll'] and rows[0]['pinned'])
        self.assertNotIn('selectAll', rows[1])
        self.assertIn('2 classes', table['title'])
        pane = build_spa_pane_content('allmaps', self.root, 'classes3d', rows[0]['cells'])
        config = pane['viewerConfig']
        self.assertEqual(config['overlaysMainLabel'], 'Class 1')
        self.assertEqual([o['label'] for o in config['overlays']], ['Class 2'])
        # Its volume cell too
        pane = build_spa_pane_content('volume', self.root, 'classes3d', rows[0]['cells'])
        self.assertIn('overlays', pane['viewerConfig'])


if __name__ == '__main__':
    unittest.main()
