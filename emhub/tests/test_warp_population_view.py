"""
Table viewer of a Warp/M population (emhub.blueprints.api_viewers_warp): the
sharpened map shown when opened, and the species mask not as a row but over
the volumes (hidden at first).
"""

import os
import tempfile
import unittest

import numpy as np
import mrcfile

from emhub.blueprints.api_viewers_warp import (build_warp_population_table,
                                               build_warp_volume_pane_content)

POPULATION = """<Population>
  <Param Name="Name" Value="apof" />
  <LastRefinementOptions>
    <Param Name="NIterations" Value="3" />
    <Param Name="BatchSize" Value="16" />
  </LastRefinementOptions>
  <Sources />
  <Species>
    <Species GUID="1" Path="species/apo_1/apo.species" />
  </Species>
</Population>
"""

SPECIES = """<Species>
  <Param Name="Name" Value="apo" />
  <Param Name="PixelSize" Value="1.5" />
  <Param Name="GlobalResolution" Value="3.21" />
</Species>
"""


class TestWarpPopulationView(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.species_dir = os.path.join(self.root, 'm', 'species', 'apo_1')
        os.makedirs(self.species_dir)
        self.population = os.path.join(self.root, 'm', 'apof.population')
        with open(self.population, 'w') as f:
            f.write(POPULATION)
        with open(os.path.join(self.species_dir, 'apo.species'), 'w') as f:
            f.write(SPECIES)

    def tearDown(self):
        self.tmp.cleanup()

    def _map(self, name, n=16):
        with mrcfile.new(os.path.join(self.species_dir, name)) as m:
            m.set_data(np.zeros((n, n, n), dtype=np.float32))
            m.voxel_size = 1.5

    def _table(self):
        return build_warp_population_table(self.population, self.root)

    def test_mask_over_volumes(self):
        for name in ('apo_half1.mrc', 'apo_filt.mrc', 'apo_filtsharp.mrc', 'apo_mask.mrc',
                     'apo_localres.mrc'):
            self._map(name)
        table = self._table()
        rows = table['rows']
        # No mask nor local resolution rows, the sharpened map first
        self.assertEqual([r['cells']['volume'] for r in rows],
                         ['apo_filtsharp.mrc', 'apo_filt.mrc', 'apo_half1.mrc'])
        self.assertEqual(table['initialAction'], {'rowId': rows[0]['id'], 'actionId': 'volume'})
        mask = os.path.join('m', 'species', 'apo_1', 'apo_mask.mrc')
        self.assertEqual({r['cells']['maskPath'] for r in rows}, {mask})

        pane = build_warp_volume_pane_content(self.root, rows[0]['cells'])
        viewer = pane['cells']['left']
        cfg = viewer['viewerConfig']['mask']
        self.assertEqual((cfg['type'], cfg['label'], cfg['show']), ('map', 'apo_mask.mrc', False))
        self.assertEqual(cfg['density']['payload']['path'], mask)
        res = viewer['viewerConfig']['resolution']
        self.assertEqual(res['density']['payload']['path'],
                         os.path.join('m', 'species', 'apo_1', 'apo_localres.mrc'))
        self.assertEqual((res['label'], res['unit']), ('apo_localres.mrc', 'Å'))

    def test_mask_other_box(self):
        """ A mask on another box is not shown over the volumes. """
        self._map('apo_filtsharp.mrc')
        self._map('apo_mask.mrc', n=8)
        rows = self._table()['rows']
        self.assertEqual([r['cells']['volume'] for r in rows], ['apo_filtsharp.mrc'])
        self.assertEqual(rows[0]['cells']['maskPath'], '')
        pane = build_warp_volume_pane_content(self.root, rows[0]['cells'])
        self.assertNotIn('mask', pane['cells']['left']['viewerConfig'])
        self.assertNotIn('resolution', pane['cells']['left']['viewerConfig'])

    def test_no_maps(self):
        rows = self._table()['rows']
        self.assertEqual(rows[0]['cells']['volume'], '(no maps)')
        self.assertNotIn('initialAction', self._table())


if __name__ == '__main__':
    unittest.main()
