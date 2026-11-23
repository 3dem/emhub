
import tempfile
import unittest

from emhub.data.data_manager import DataManager


class TestUpdateUserPermissions(unittest.TestCase):
    """ Non-managers can only change some fields of their own user. """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dm = DataManager(self._tmp.name, cleanDb=True)

        def _create(name, roles, pi_id=None):
            return self.dm.create_user(
                username=name, email=f'{name}@example.org', name=name,
                password=name, roles=roles, pi_id=pi_id)

        self.manager = _create('manager', ['user', 'manager'])
        self.pi = _create('pi', ['user', 'pi'])
        self.user = _create('user', ['user'], pi_id=self.pi.id)
        self.other = _create('other', ['user'], pi_id=self.pi.id)

    def tearDown(self):
        self.dm.close()
        self._tmp.cleanup()

    def _login(self, user):
        self.dm._user = user

    def _update(self, **attrs):
        return self.dm.update_user(**attrs)

    def test_user_updates_own_profile(self):
        self._login(self.user)
        self._update(id=str(self.user.id), name='New Name', phone='123',
                     password='secret', extra={'tomo_workspaces': []})
        user = self.dm.get_user_by(id=self.user.id)
        self.assertEqual(user.name, 'New Name')
        self.assertEqual(user.phone, '123')
        self.assertTrue(user.check_password('secret'))

    def test_user_cannot_update_other_user(self):
        self._login(self.user)
        with self.assertRaisesRegex(Exception, 'other users'):
            self._update(id=self.other.id, name='Hacked')
        self.assertEqual(self.dm.get_user_by(id=self.other.id).name, 'other')

    def test_user_cannot_change_restricted_fields(self):
        self._login(self.user)
        for attrs in [{'roles': ['user', 'manager']},
                      {'status': 'inactive'},
                      {'pi_id': None},
                      {'email': 'x@example.org'},
                      {'password_hash': 'x'},
                      {'extra': {'independent_resources': [1]}},
                      {'extra': {'auth_local': True}},
                      {'extra': {'invoice': {'reference': 'x'}}},
                      {'extra': {'university': 'x'}},
                      {'extra_replace': True, 'extra': {}}]:
            with self.subTest(attrs=attrs):
                with self.assertRaisesRegex(Exception, "Only 'managers'"):
                    self._update(id=self.user.id, **attrs)

        user = self.dm.get_user_by(id=self.user.id)
        self.assertEqual(user.roles, ['user'])
        self.assertEqual(user.pi_id, self.pi.id)

    def test_manager_updates_other_user(self):
        self._login(self.manager)
        self._update(id=self.other.id, status='inactive',
                     roles=['user', 'independent'],
                     extra={'independent_resources': [1]})
        other = self.dm.get_user_by(id=self.other.id)
        self.assertEqual(other.status, 'inactive')
        self.assertEqual(other.roles, ['user', 'independent'])
        self.assertEqual(other.extra['independent_resources'], [1])

    def test_manager_cannot_assign_admin(self):
        self._login(self.manager)
        with self.assertRaisesRegex(Exception, "Only 'admin'"):
            self._update(id=self.other.id, roles=['user', 'admin'])

    def test_pi_updates_own_invoice(self):
        self._login(self.pi)
        self._update(id=self.pi.id, extra={'invoice': {'reference': 'x'},
                                           'university': 'x'})
        pi = self.dm.get_user_by(id=self.pi.id)
        self.assertEqual(pi.extra['invoice'], {'reference': 'x'})
        self.assertEqual(pi.extra['university'], 'x')


if __name__ == '__main__':
    unittest.main()
