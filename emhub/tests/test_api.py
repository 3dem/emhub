import json
import unittest
import random

from emhub.client import SessionClient


class TestClientApi(unittest.TestCase):
    def test_create_user(self):
        """ Create a user and check the result. """
        username = "queen%d" % random.randint(1, 1000)
        sc = SessionClient()
        method = "create_user"
        jsonData = {"attrs":{"username":"%s" % username,
                             "email":"%s@emhub.org" % username,
                             "name":"Queen of England",
                             "password":"grgrh45$%^4573",
                             "roles":"user",
                             "phone":"343-332-4525"}}

        print("Creating user: %s" % jsonData)
        sc.request(method, jsonData)
        print(sc.json())
        result_id = json.loads(sc.json())['user']['id']

        sc.request(method="get_users",
                   json={"condition":"id=%s" % result_id})
        check = json.loads(sc.json())[0]['id']

        self.assertEqual(result_id, check)

    def test_create_session(self):
        """ Create a session and check the result. """
        name = "mysession_%d" % random.randint(1, 1000)
        sc = SessionClient()
        method = "create_session"
        jsonData = {"attrs": {"name":"%s" % name,
                              "resource_id":"2",
                              "operator_id":"23"}}

        print("Creating session: %s" % jsonData)
        sc.request(method, jsonData)
        print(sc.json())
        result_id = json.loads(sc.json())['session']['id']

        sc.request(method="get_sessions",
                   json={"condition":"id=%s" % result_id})
        check = json.loads(sc.json())[0]['id']

        self.assertEqual(result_id, check)
