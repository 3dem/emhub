
import os
import unittest

from .data_manager import DataManager


class TestDataManager(unittest.TestCase):
    def setUp(self):
        self.ds = DataManager('/tmp/emhub.sqlite')

    def test_projects(self):
        projects = self.ds.get_projects()

        codes = [p.code for p in projects]

        self.assertEqual(codes, ['CEM00297', 'CEM00315', 'CEM00332', 'DBB00001'])

        users = self.ds.get_users()
        uList = []
        for u in users:
            if u.is_pi:
                uList.append("PI: %s, projects: %s" % (u.name, u.projects))
                uList.append("   Lab members:")
                for u2 in u.lab_members:
                    uList.append("     - %s" % u2.name)

        for l in uList:
            print(l)


if __name__ == '__main__':
    unittest.main()
