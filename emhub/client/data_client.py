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
import socket
from contextlib import contextmanager

from emtools.utils import System


class config:
    """ Store configuration variables read from os.environ.

    Attributes:
        EMHUB_SERVER_URL: EMhub server URL
            (e.g. https://emhub.org or http://127.0.0.1:5000).
        EMHUB_USER: Username for login into the remote EMhub server.
        EMHUB_PASSWORD: Password for login into the server.
    """

    EMHUB_SERVER_URL = os.environ.get('EMHUB_SERVER_URL',
                                      'http://127.0.0.1:5000')
    EMHUB_USER = os.environ.get('EMHUB_USER', 'NO-USER')
    EMHUB_PASSWORD = os.environ.get('EMHUB_PASSWORD', '')


@contextmanager
def open_client():
    """ Context creation for login/logout with a `DataClient` using the configuration in `config`. """
    dc = DataClient(server_url=config.EMHUB_SERVER_URL)
    try:
        dc.login(config.EMHUB_USER, config.EMHUB_PASSWORD)
        yield dc
    finally:
        dc.logout()


class DataClient:
    """
    Client class to communicate with a remote EMhub server via the REST API.
    """
    def __init__(self, server_url=None):
        self._server_url = server_url or config.EMHUB_SERVER_URL
        # Store the last request object
        self.cookies = self.r = None

    def login(self, username=None, password=None):
        """ Login into the EMhub server with the given credentials.

        It is required to login before most of the operations that requires
        an authenticated user.

        Args:
            username (str): The username to login
            password (str): password to login.

        Returns:
            The request result of the login operation.

        Examples:
            Login to a remote server providing all credentials::

                dc = DataClient('https://emhub.org')
                dc.login('admin', 'admin')

            Login using default variables in `config`::

                dc = DataClient()
                dc.login()
        """
        username = username or config.EMHUB_USER
        password = password or config.EMHUB_PASSWORD

        self.r = requests.post('%s/api/login' % self._server_url,
                               json={'username': username,
                                     'password': password})
        self.r.raise_for_status()
        self.cookies = self.r.cookies
        return self.r

    def logout(self):
        """ Logout the user from the EMhub server. """
        r = requests.post('%s/api/logout' % self._server_url,
                          cookies=self.cookies)
        r.raise_for_status()
        self.cookies = self.r = None
        return r

    def create_session(self, attrs):
        """ Request to create a new :class:`Session` in the server.

        Args:
            attrs (dict): Dict with the attributes of the session.

        ``attrs`` should of the form::

            {
                'name': 'SessionName',
                'start': '2023-07-27 09:00'
                'end': '2023-07-27 23:59'
            }

        Returns:
            The JSON result from the request.
        """
        return self._method('create_session', 'session', attrs)

    def get_session(self, sessionId, attrs=None):
        """ Retrieve data from the `Session` with this ``sessionId``.

        Args:
            sessionId: Id of the session to retrieve.
            attrs: What attributes to retrieve, if None all attributes will
                be returned.

        Examples:
            ::

                with open_client() as dc:
                    # Retrieving all attributes from Session 100
                    sid = 100
                    s1 = dc.get_session(sid)
                    # Just fetching session name and start date
                    s2 = dc.get_session(sid, ['name', 'start'])
        """
        return self._method('get_sessions', None, attrs,
                            condition='id=%d' % sessionId)[0]

    def get_active_sessions(self):
        """ Return all sessions that are active. """
        return self._method('get_sessions', None, None,
                            condition='status="active"')

    def update_session(self, attrs):
        """ Request to update existing `Session`.

        Args:
            attrs (dict): Attributes to be updated. ``id`` must be in ``attrs``.

        Returns:
            The JSON result from the request with updated session.
        """
        return self._method('update_session', 'session', attrs)

    def update_session_extra(self, attrs):
        """ Request the server to update only the ``extra`` attribute of a `Session`.

        Args:
            attrs (dict): Attributes to be updated. ``id`` must be in ``attrs``.

        Returns:
            The JSON result from the request with updated session.
        """
        return self._method('update_session_extra', 'session', attrs)

    def delete_session(self, attrs):
        """ Request the server to delete a session.

        Args:
            attrs (dict): Attributes to be deleted. ``id`` must be in ``attrs``.

        Returns:
            The JSON result from the request with deleted session.
        """
        return self._method('delete_session', 'session', attrs)

    def get_config(self, configName):
        return self._method('get_config', None, {'config': configName})['config']

    # --------------------- Internal functions ------------------------------
    def _method(self, method, resultKey, attrs, condition=None):
        r = self.request(method,
                         jsonData={'attrs': attrs,
                                   'condition': condition})
        json = r.json()
        if 'error' in json:
            raise Exception("ERROR from Server: ", json['error'])

        return json if resultKey is None else json[resultKey]

    def request(self, method, jsonData=None, bp='api'):
        """ Make a request to the server sending this ``jsonData``.

        Args:
            method (str): Method (or endpoint) to send the request in the server.
            jsonData (dict): Data to be sent to the remote endpoint.
            bp (str): Blueprint in the server where to send the request.
                By default it will use the 'api' blueprint.
        Returns:
            The request object result from the request.
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
        """ Retrieve the result of the last Request as JSON. """
        if self.r.status_code == 200:
            return json.dumps(self.r.json(), indent=4)
        else:
            return {'ERROR': "Request failed with status code: %s"
                             % self.r.status_code}
