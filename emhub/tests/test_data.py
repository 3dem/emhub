# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *              Grigory Sharov (gsharov@mrc-lmb.cam.ac.uk) [2]
# *
# * [1] SciLifeLab, Stockholm University
# * [2] MRC Laboratory of Molecular Biology (MRC-LMB)
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
# * You should have received a copy of the GNU General Public License
# * along with this program; if not, write to the Free Software
# * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA
# * 02111-1307  USA
# *
# *  All comments concerning this program package may be sent to the
# *  e-mail address 'delarosatrevin@scilifelab.se'
# *
# **************************************************************************

import unittest
import datetime as dt
from pprint import pprint

from emhub.data import DataManager, DataLog
from emhub.data.imports.test import TestData
from emhub.utils import datetime_to_isoformat


class TestDataManager(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dm = DataManager('/tmp/', cleanDb=True)
        # populate db with test data
        cls.td = TestData(cls.dm)

    def test_users(self):
        print("=" * 80, "\nTesting users...")
        users = self.dm.get_users()

        for u in users:
            pi = u.get_pi()

            if pi is not None:
                self.assertEqual(pi.id, u.get_pi().id)
            pi_str = pi.name if pi else 'None'

    def test_applications(self):
        print("=" * 80, "\nTesting applications...")
        applications = self.dm.get_applications()

        codes = [p.code for p in applications]

        self.assertEqual(codes, ['CEM00297', 'CEM00315', 'CEM00332', 'DBB00001',
                                 'CEM00345', 'CEM00346'])

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

    def test_bookings(self):
        # Retrieve all bookings that are either booking or downtime
        typeCond = "type='booking' OR type='downtime'"
        bookings = self.dm.get_bookings(condition=typeCond)
        self.assertEqual(len(bookings), 4)

        # Retrieve all bookings starting before or day 4
        fm = self.td.firstMonday + dt.timedelta(days=14)
        dateStr = datetime_to_isoformat(fm)
        startCond = "start<='%s' AND type='booking'" % dateStr
        bookings = self.dm.get_bookings(condition=startCond)
        self.assertEqual(len(bookings), 3)

    def test_count_booking_resources(self):
        print("=" * 80, "\nTesting counting booking resources...")

        def print_count(count):
            for a, count_dict in count.items():
                print("Application ID: ", a)
                for k, c in count_dict.items():
                    print("   %s: %s" % (k, c))

        applications = [a.id for a in self.dm.get_applications()]
        count_resources = self.dm.count_booking_resources(applications)
        print_count(count_resources)
        self.assertTrue(len(count_resources) > 0)

        count_tags = self.dm.count_booking_resources(applications,
                                                     resource_tags=['krios'])
        self.assertTrue(len(count_tags))
        print_count(count_tags)

    def test_resources(self):
        resources = self.dm.get_resources()

        microscopes = [r for r in resources if r.is_microscope]

        self.assertTrue(all(m.requires_slot for m in microscopes))
        self.assertFalse(all(m.requires_slot for m in microscopes))


class TestDataLog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pass

    def test(self):
        print("=" * 80, "\nTesting logs...")

        dbPath = '/tmp/emhub-logs.sqlite'
        dl  = DataLog(dbPath, cleanDb=True)

        logsData = [
            (1, 'data', 'create_test_user',
             ['Pepe Perez'], {'is_admin': False}),
            (1, 'error', 'deleting_file',
             [], {'error': 'File was locked', 'exception': True})
        ]

        for user_id, log_type, name, args, kwargs in logsData:
            dl.log(user_id, log_type, name, *args, **kwargs)

        dl.close()

        # Open again the logs and check
        dl = DataLog(dbPath)
        logs = dl.get_logs()
        self.assertEqual(2, len(logs))
        dl.close()
