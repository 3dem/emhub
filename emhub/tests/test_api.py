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

import json
import unittest
import random
import datetime as dt

from emhub.client import DataClient
from emhub.utils import (get_quarter, pretty_quarter)


class TestClientApi(unittest.TestCase):
    def test_create_user(self):
        """ Create a user and check the result. """
        username = "queen%d" % random.randint(1, 1000)
        sc = DataClient()
        sc.login('mull', 'mull')
        method = "create_user"
        jsonData = {"attrs":{"username":"%s" % username,
                             "email":"%s@emhub.org" % username,
                             "name":"Queen of England",
                             "password":"grgrh45$%^4573",
                             "roles":"user",
                             "phone":"343-332-4525"}}

        print("="*80, "\nCreating user: %s" % jsonData)
        sc.request(method, jsonData=jsonData)
        result_id = json.loads(sc.json())['user']['id']
        print("Created new user with id: %s" % result_id)

        sc.request(method="get_users",
                   jsonData={"condition":"id=%s" % result_id})
        check = json.loads(sc.json())[0]['id']

        self.assertEqual(result_id, check, msg="Creating test user failed!")

        sc.logout()

    def test_create_session(self):
        """ Create a session and check the result. """
        name = "mysession_%d" % random.randint(1, 1000)
        sc = DataClient()
        sc.login('mull', 'mull')
        method = "create_session"
        jsonData = {"attrs": {"name":"%s" % name,
                              "resource_id":"2",
                              "operator_id":"23"}}

        print("="*80, "\nCreating session: %s" % jsonData)
        sc.request(method, jsonData=jsonData)
        result_id = json.loads(sc.json())['session']['id']
        print("Created new session with id: %s" % result_id)

        sc.request(method="get_sessions",
                   jsonData={"condition":"id=%s" % result_id})
        check = json.loads(sc.json())[0]['id']

        self.assertEqual(result_id, check, msg="Creating test session failed!")

        sc.logout()

    def test_create_invoice_periods(self):
        q1 = get_quarter()
        q0 = get_quarter(q1[0] - dt.timedelta(days=1))

        sc = DataClient()
        sc.login('mull', 'mull')
        method = "create_invoice_period"

        for q in [q0, q1]:
            pass

        sc.logout()