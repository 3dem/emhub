# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin
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
# *  All comments concerning this program package may be sent to the
# *  e-mail address 'delarosatrevin@gmail.com'
# *
# **************************************************************************

""" Tests for pucks access (labs and cane roles) and gridboxes updates. """

import shutil
import tempfile
import unittest

from emhub.data import DataManager


class TestPucks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='emhub-test-pucks-')
        cls.dm = dm = DataManager(cls.tmp, cleanDb=True)
        dm.create_admin()
        cls.admin = dm._user

        dm.create_form(name='config:permissions', definition={
            'content': {'pucks': ['staff-coescb']}
        })
        dm.create_form(name='config:dewars', definition={
            'dewars': [{
                'id': 1, 'label': 'Dewar 1',
                'canes': [
                    {'id': 1, 'label': 'Cane A', 'color': 'red',
                     'roles': ['staff-cryoem'], 'roles_level': 'occupancy'},
                    {'id': 2, 'label': 'Cane B', 'color': 'blue'},
                    {'id': 3, 'label': 'Cane C', 'color': 'green',
                     'roles': ['staff-coescb']},
                ]
            }]
        })

        def _user(name, roles, pi=None):
            return dm.create_user(username=name, email=f'{name}@emhub.org',
                                  password=name, name=name, roles=roles,
                                  pi_id=None if pi is None else pi.id)

        cls.pi = _user('pi1', ['user', 'pi'])
        cls.member = _user('member1', ['user'], pi=cls.pi)
        cls.cryoem = _user('cryoem1', ['user', 'staff-cryoem'])
        cls.coescb = _user('coescb1', ['user', 'staff-coescb'])
        cls.other = _user('other1', ['user'])

        # Puck in Cane A, with access for the lab of pi1
        cls.puckA = dm.create_puck(label='PuckA', color='red', dewar=1, cane=1,
                                   position=1,
                                   extra={'access': {str(cls.pi.id): 'read'}})
        cls.puckB = dm.create_puck(label='PuckB', color='blue', dewar=1, cane=2,
                                   position=1, extra={})
        cls.puckC = dm.create_puck(label='PuckC', color='green', dewar=1, cane=3,
                                   position=1, extra={})

    @classmethod
    def tearDownClass(cls):
        cls.dm._user = cls.admin
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.dm._user = self.admin

    def test_cane_roles_access(self):
        Puck = self.dm.Puck
        A, B, C = self.puckA, self.puckB, self.puckC

        # Labs access is kept
        self.assertEqual(A.get_access_level(self.member), Puck.ACCESS_READ)
        self.assertFalse(B.can_view(self.member))

        # Cane A grants 'occupancy' to staff-cryoem
        self.assertEqual(A.get_access_level(self.cryoem), Puck.ACCESS_OCCUPANCY)
        self.assertTrue(A.can_edit_occupancy(self.cryoem))
        self.assertFalse(A.can_edit_label(self.cryoem))
        self.assertFalse(B.can_view(self.cryoem))

        # Cane C grants 'read' (default level) to staff-coescb
        self.assertTrue(C.can_view(self.coescb))
        self.assertFalse(C.can_edit_occupancy(self.coescb))
        self.assertFalse(A.can_view(self.coescb))

        # Cane without roles does not grant anything (not even to users
        # without roles, has_any_role([]) is True)
        for u in [self.other, self.member, self.cryoem, self.coescb]:
            self.assertFalse(B.can_view(u))
        self.assertIsNone(Puck.cane_roles_level({}, self.other))

        # Managers keep full access
        self.assertEqual(B.get_access_level(self.admin), Puck.ACCESS_FULL)

    def test_pucks_content_access(self):
        dm = self.dm
        dm._user = self.cryoem  # role only granted in a cane
        self.assertTrue(dm.check_user_access('pucks'))
        self.assertFalse(dm.check_user_access('inventories', ['staff-coescb']))
        dm._user = self.coescb  # role in config:permissions
        self.assertTrue(dm.check_user_access('pucks'))
        dm._user = self.other
        self.assertFalse(dm.check_user_access('pucks'))

        # Visible pucks for the storage user
        dm._user = self.cryoem
        storage = dm.PuckStorage(dm.get_pucks(), user=self.cryoem)
        self.assertEqual([p.label for p in storage.visible_pucks()], ['PuckA'])
        self.assertEqual([c['id'] for d in storage.visible_dewars()
                          for c in d['canes']], [1])

    def test_check_puck_update(self):
        dm = self.dm
        dm._user = self.cryoem
        gridboxes = {'1': {'sample': 'S1', 'storage_date': '2026-10-30'}}
        dm.check_puck_update({'id': self.puckA.id, 'extra': {'gridboxes': gridboxes}})
        with self.assertRaises(Exception):
            dm.check_puck_update({'id': self.puckA.id, 'label': 'NewLabel'})
        with self.assertRaises(Exception):
            dm.check_puck_update({'id': self.puckB.id, 'extra': {'gridboxes': gridboxes}})

    def test_gridboxes_update(self):
        dm = self.dm
        puck = dm.create_puck(label='PuckG', color='gray', dewar=1, cane=2,
                              position=2, extra={})

        # Empty storage date is rejected
        for date in [None, '', '  ']:
            gb = {'sample': 'S1'}
            if date is not None:
                gb['storage_date'] = date
            with self.assertRaisesRegex(Exception, 'Storage date is required'):
                dm.update_puck(id=puck.id, extra={'gridboxes': {'1': gb}})
        self.assertEqual(dm.get_puck_by(id=puck.id).gridboxes(), {})

        # Empty sample is rejected as well
        for sample in [None, '', '  ']:
            gb = {'storage_date': '2026-10-30'}
            if sample is not None:
                gb['sample'] = sample
            with self.assertRaisesRegex(Exception, 'Sample is required'):
                dm.update_puck(id=puck.id, extra={'gridboxes': {'1': gb}})
        self.assertEqual(dm.get_puck_by(id=puck.id).gridboxes(), {})

        # Valid update records who modified it and when
        dm._user = self.cryoem
        gb1 = {'sample': 'S1', 'storage_date': '2026-10-30'}
        dm.update_puck(id=puck.id, extra={'gridboxes': {'1': dict(gb1)}})
        saved1 = dm.get_puck_by(id=puck.id).get_gridbox(1)
        self.assertEqual(saved1['modified_by'], 'cryoem1')
        self.assertEqual(saved1['modified_by_id'], self.cryoem.id)
        self.assertTrue(saved1['modified_date'].endswith('Z'))

        # Adding a second gridbox keeps the info of the unchanged one, even
        # if the client sends a different (or no) modification info
        dm._user = self.admin
        gridboxes = {
            '1': dict(gb1, modified_by='someone-else'),
            '2': {'sample': 'S2', 'storage_date': '2026-10-29'},
        }
        dm.update_puck(id=puck.id, extra={'gridboxes': gridboxes})
        puck = dm.get_puck_by(id=puck.id)
        self.assertEqual(puck.get_gridbox(1)['modified_by'], 'cryoem1')
        self.assertEqual(puck.get_gridbox(1)['modified_date'],
                         saved1['modified_date'])
        self.assertEqual(puck.get_gridbox(2)['modified_by'], 'admin')

        # Unchanged legacy gridboxes without a date can still be kept
        legacy = {'sample': 'old'}
        puck.set_gridbox(3, legacy)
        dm.commit()
        gridboxes = {str(k): v for k, v in puck.gridboxes().items()}
        gridboxes['1'] = dict(gb1, sample='S1-changed')
        dm.update_puck(id=puck.id, extra={'gridboxes': gridboxes})
        puck = dm.get_puck_by(id=puck.id)
        self.assertNotIn('modified_by', puck.get_gridbox(3))
        self.assertEqual(puck.get_gridbox(1)['modified_by'], 'admin')

        # Deleting a gridbox does not need any date
        gridboxes = {str(k): v for k, v in puck.gridboxes().items()}
        del gridboxes['2']
        dm.update_puck(id=puck.id, extra={'gridboxes': gridboxes})
        self.assertIsNone(dm.get_puck_by(id=puck.id).get_gridbox(2))


if __name__ == '__main__':
    unittest.main()
