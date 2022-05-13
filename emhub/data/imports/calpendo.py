# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *
# * [1] SciLifeLab, Stockholm University
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
import sys
import json
import requests

from emhub.utils import datetime_from_isoformat
from emhub.data import DataManager
from emhub.data.imports import TestDataBase


class CalpendoData(TestDataBase):
    """ Class to import data (users, templates, applications) from the
     Calpendo application at LMB.
    """

    def __init__(self, dm, dataJsonPath):
        """
        Args:
            dm: DataManager with db to create test data
            dataJsonPath: file path to the JSON file with the data from the Calpendo.
                It is expected as a Dict with the following entries:
                * users
        """
        dm.create_admin()
        self.__importData(dm, dataJsonPath)

    def __importData(self, dm, dataJsonPath):
        # Create tables with test data for each database model
        print("Importing users...")

        with open(dataJsonPath) as jsonFile:
            self._dictUsers = {}
            self._jsonUsers = json.load(jsonFile)["biskits"]
            self.__importUsers(dm)

        print("Populating resources...")
        self._populateResources(dm)

    def __importUsers(self, dm):

        # Create user
        def createUser(u, **kwargs):
            status = 'active' if u['status'] == 'Normal' else 'inactive'
            roles = kwargs.get('roles', ['user'])
            pi = kwargs.get('pi', None)

            user = dm.create_user(
                username=u['email'],
                email=u['email'],
                phone='',
                password=u['email'],
                name="%(givenName)s %(familyName)s" % u,
                roles=roles,
                pi_id=pi,
                status=status
            )

            u['emhub_item'] = user
            self._dictUsers[user.email] = user

        staff = {
            'shaoxia@mrc-lmb.cam.ac.uk': ['manager', 'head', 'admin'],
            'gcannone@mrc-lmb.cam.ac.uk': ['admin', 'manager'],
            'gsharov@mrc-lmb.cam.ac.uk': ['admin', 'manager'],
            'ayeates@mrc-lmb.cam.ac.uk': ['admin', 'manager'],
            'bahsan@mrc-lmb.cam.ac.uk': ['admin', 'manager'],
        }

        #  Create first facility staff, iterate over list copy to remove
        for u in list(self._jsonUsers):
            if u['email'] in staff and u['status'] != 'Expired':
                createUser(u, roles=staff[u['email']])
                self._jsonUsers.remove(u)

        # Insert first PI users, so we store their Ids for other users
        piDict = {}
        for u in self._jsonUsers:
            fullName = u['givenName'] + ' ' + u['familyName']
            if u['groupLeader'] == fullName:
                print("Adding PI: ", fullName)
                # if PI has two accounts, use not Expired one
                if fullName in piDict and u['status'] != 'Expired':
                    piDict[fullName] = u
                    continue
                piDict[fullName] = u

        for u in piDict:
            createUser(piDict[u], roles=['pi'])
            self._jsonUsers.remove(piDict[u])

        # Insert other users
        for u in list(self._jsonUsers):
            piName = u['groupLeader']
            if piName in piDict:
                createUser(u, pi=piDict[piName]['emhub_item'].id)
                self._jsonUsers.remove(u)
            else:
                print("Skipping user: ", u['givenName'], u['familyName'],
                      "- missing PI: ", piName)

    def _populateResources(self, dm):
        resources = [
            {'name': 'Krios 1', 'tags': 'microscope krios',
             'image': 'titan-krios.png', 'color': 'rgba(58, 186, 232, 1.0)'},
            {'name': 'Krios 2', 'tags': 'microscope krios',
             'image': 'titan-krios.png', 'color': 'rgba(60, 90, 190, 1.0)'},
            {'name': 'Krios 3', 'tags': 'microscope krios',
             'image': 'titan-krios.png', 'color': 'rgba(43, 84, 36, 1.0)'},
            {'name': 'Glacios', 'tags': 'microscope talos',
             'image': 'glacios.png', 'color': 'rgba(15, 40, 130, 1.0)'},
            {'name': 'F20', 'tags': 'microscope tecnai',
             'image': 'F20.png', 'color': 'rgba(43, 84, 36, 1.0)'},
            {'name': 'G-Spirit', 'tags': 'microscope tecnai',
             'image': 'tecnai.png', 'color': 'rgba(43, 84, 36, 1.0)'},
            {'name': 'C-Spirit', 'tags': 'microscope tecnai',
             'image': 'tecnai.png', 'color': 'rgba(43, 84, 36, 1.0)'},

            {'name': 'Vitrobot 1', 'tags': 'instrument',
             'image': 'vitrobot.png', 'color': 'rgba(158, 142, 62, 1.0)'},
            {'name': 'Vitrobot 2', 'tags': 'instrument',
             'image': 'vitrobot.png', 'color': 'rgba(69, 62, 25, 1.0)'},
            {'name': 'Vitrobot 3', 'tags': 'instrument',
             'image': 'vitrobot.png', 'color': 'rgba(48, 41, 40, 1.0)'},
            {'name': 'Vitrobot 4', 'tags': 'instrument',
             'image': 'vitrobot.png', 'color': 'rgba(68, 16, 105, 1.0)'},
        ]

        for rDict in resources:
            dm.create_resource(**rDict)


class CalpendoManager:
    """ Helper class to interact with the Calpendo system.
    """
    def __init__(self, apiJson, cache=True):
        self._headers = apiJson['headers']
        self._baseUrl = apiJson['baseUrl']

        # Create a cached dict with json files for url
        # to avoid make unnecessary queries in the same session
        if cache:
            self._cache = {}

    def _getUrl(self, suffix):
        return self._baseUrl + suffix

    def _fetchJsonFromUrl(self, url):
        cache = getattr(self, '_cache', None)
        cachedJson = cache.get(url, None) if cache is not None else None

        if cachedJson:
            print("Returning cached JSON for url: %s" % url)
            return cachedJson

        print("Retrieving url: %s" % url)
        response = requests.get(url, headers=self._headers)

        if response.status_code != 200:
            print(response.status_code)
            return None
        else:
            result = response.json()
            if cache is not None:
                cache[url] = result
            return result

    def _fetchJsonFromUrlSuffix(self, suffix):
        return self._fetchJsonFromUrl(self._getUrl(suffix))

    def fetchAccountsJson(self):
        """ Retrieve the users list from the portal system. """
        return self._fetchJsonFromUrlSuffix('Calpendo.CalpendoUser?paths=id,givenName,familyName,email,groupLeader,roles,status')


if __name__ == '__main__':
    instance_path = os.path.abspath(os.environ.get("EMHUB_INSTANCE",
                                                   'instance'))

    if not os.path.exists(instance_path):
        raise Exception("Instance folder '%s' not found!!!" % instance_path)

    if len(sys.argv) != 2:
        print("\nUSAGE:\n"
              "\tpython -m emhub.data.imports.calpendo users-data.json\n")
        sys.exit(1)

    calpendolDataJson = sys.argv[1]

    if not os.path.exists(calpendolDataJson):
        print("JSON data file '%s' does not exists. " % calpendolDataJson)

    dm = DataManager(instance_path, cleanDb=True)
    CalpendoData(dm, calpendolDataJson)
