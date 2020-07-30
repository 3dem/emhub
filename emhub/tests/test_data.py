
import os
import unittest

from emhub.data import DataManager


class TestDataManager(unittest.TestCase):

    def setUp(cls):
        sqlitePath = '/tmp/emhub.sqlite'

        if os.path.exists(sqlitePath):
            os.remove(sqlitePath)

        cls.dm = DataManager(sqlitePath)

    def test_users(self):
        users = self.dm.get_users()

        for u in users:
            pi = u.get_pi()

            if pi is not None:
                self.assertEqual(pi.id, u.get_pi().id)
            pi_str = pi.name if pi else 'None'

    def test_applications(self):
        applications = self.dm.get_applications()

        codes = [p.code for p in applications]

        self.assertEqual(codes, ['CEM00297', 'CEM00315', 'CEM00332', 'DBB00001'])

        users = self.dm.get_users()
        uList = []
        piDict = {}

        for u in users:
            if u.is_pi:
                piDict[u.id] = [u]
                uList.append("PI: %s, applications: %s" % (u.name,
                                                           u.created_applications))
                uList.append("   Lab members:")
                for u2 in u.lab_members:
                    uList.append("     - %s" % u2.name)
            else:
                pi = u.get_pi()
                if pi is not None:
                    piDict[pi.id].append(u)

        for l in uList:
            print(l)

        # Check that all users in the same lab, have the same applications
        for pi_id, members in piDict.items():
            pi = members[0]
            pRef = pi.get_applications()

            # Check that the relationship pi-lab_members is working as expected
            print(">>> Checking PI: ", pi.name)
            members_ids = set(m.id for m in members[1:])
            lab_ids = set(u.id for u in pi.lab_members)
            print("   members: ", members_ids)
            print("   lab_ids: ", lab_ids)
            # self.assertEqual(members_ids, lab_ids)

            # Check applications for lab_members
            for u in members[1:]:
                self.assertEqual(pRef, u.get_applications())

    def test_count_booking_resources(self):
        def print_count(count):
            for a, count_dict in count.items():
                print("Application ID: ", a)
                for k, c in count_dict.items():
                    print("   %s: %s" % (k, c))

        applications = self.dm.get_applications()
        count_resources = self.dm.count_booking_resources(applications)
        print_count(count_resources)
        self.assertTrue(len(count_resources) > 0)

        count_tags = self.dm.count_booking_resources(applications, resource_tags=['krios'])
        self.assertTrue(len(count_tags))
        print_count(count_tags)

