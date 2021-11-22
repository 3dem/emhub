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

import os
import json
import requests
from contextlib import contextmanager


class config:
    EMHUB_SOURCE = os.environ['EMHUB_SOURCE']
    EMHUB_SERVER_URL = os.environ['EMHUB_SERVER_URL']
    EMHUB_USER = os.environ['EMHUB_USER']
    EMHUB_PASSWORD = os.environ['EMHUB_PASSWORD']


@contextmanager
def open_client():
    dc = DataClient(server_url=config.EMHUB_SERVER_URL)
    try:
        dc.login(config.EMHUB_USER, config.EMHUB_PASSWORD)
        yield dc
    finally:
        dc.logout()


class DataClient:
    """
    Simple client to communicate with the emhub REST API.
    """
    def __init__(self, server_url=None):
        self._server_url = server_url or os.environ.get('EMHUB_SERVER_URL',
                                                        'http://127.0.0.1:5000')
        # Store the last request object
        self.cookies = self.r = None

    def login(self, username=None, password=None):
        username = username or os.environ['EMHUB_USER']
        password = password or os.environ['EMHUB_PASSWORD']

        self.r = requests.post('%s/api/login' % self._server_url,
                               json={'username': username,
                                     'password': password})
        self.r.raise_for_status()
        self.cookies = self.r.cookies
        return self.r

    def logout(self):
        r = requests.post('%s/api/logout' % self._server_url,
                          cookies=self.cookies)
        r.raise_for_status()
        self.cookies = self.r = None
        return r

    def create_session(self, attrs):
        """ Request the server to create a new session.
        Mandatory in attrs:
            name: the session name
        """
        return self._method('create_session', 'session', attrs)

    def update_session(self, attrs):
        """ Request the server to update existing session.
        Mandatory in attrs:
            id: the id of the session
        """
        return self._method('update_session', 'session', attrs)

    def delete_session(self, attrs):
        """ Request the server to delete a session.
        Mandatory in attrs:
            id: the id of the session
        """
        return self._method('delete_session', 'session', attrs)

    def create_session_set(self, attrs):
        """ Request the server to create a set within a session.
        Mandatory in attrs:
            session_id: the id of the session
            set_id: the id of the set that will be created
        """
        return self._method('create_session_set', 'session_set', attrs)

    def add_session_item(self, attrs):
        """ Add new item to a set in the session.
        Mandatory in attrs:
            session_id: the id of the session
            set_id: the id of the set that will be created
            item_id: the id of the item to be added
        """
        return self._method('add_session_item', 'item', attrs)

    def update_session_item(self, attrs):
        """ Update existing item in the set in the session.
        Mandatory in attrs:
            session_id: the id of the session
            set_id: the id of the set
            item_id: the id of the item to be modified
        """
        return self._method('update_session_item', 'item', attrs)

    #---------------------- Internal functions ------------------------------
    def _method(self, method, resultKey, attrs):
        r = self.request(method, jsonData={'attrs': attrs})
        json = r.json()
        if 'error' in json:
            raise Exception("ERROR from Server: ", json['error'])

        return json[resultKey]

    def request(self, method, jsonData=None, bp='api'):
        """ Make a request to this method passing the json data.
        """
        if self.cookies is None:
            raise Exception("You should call login method first")

        self.r = requests.post('%s/%s/%s'
                               % (self._server_url, bp, method),
                               json=jsonData or {},  cookies=self.cookies)
        self.r.raise_for_status()
        return self.r

    def get(self, name, condition=None, orderBy=None, attrs=None):
        return self.request('get_%s' % name,
                            jsonData={'condition': condition,
                                      'orderBy': orderBy,
                                      'attrs': attrs})

    def json(self):
        if self.r.status_code == 200:
            return json.dumps(self.r.json(), indent=4)
        else:
            return {'ERROR': "Request failed with status code: %s"
                             % self.r.status_code}
