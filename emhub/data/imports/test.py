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
import shutil
import datetime as dt
import json

from emtools.utils import Process, Color
from emhub.data import DataManager
from emhub.utils import datetime_from_isoformat

here = os.path.abspath(os.path.dirname(__file__))


class TestData:
    """ Class to create a testing dataset for a given DataManager.
    """
    def _datetime(self, *args):
        return self.dm.dt_as_local(dt.datetime(*args))

    def _action(self, title):
        print(Color.bold(f'\n>>> {title}...'))

    def __init__(self, dm, json_file):
        self.json_data = None
        print(f">>> Loading JSON data from {Color.bold(json_file)}")
        with open(json_file) as f:
            self.json_data = json.load(f)

        self.dm = dm
        dm.create_admin()
        # Create tables with test data for each database model
        self._populateForms(dm)
        self._populateUsers(dm)
        self._populateResources(dm)
        self._populateApplications(dm)
        self._populateBookings(dm)
        self._populateSessions(dm)

    def _populateForms(self, dm):
        self._action('Populating Forms')

        for form in self.json_data['forms']:
            dm.create_form(**form)

    def _populateUsers(self, dm):
        self._action('Populating Users')

        # Create user table
        usersData = [
            # dev (D)
            ('Don Stairs', 'admin', None),  # 2

            # admin (A)
            ('Anna Mull', 'admin,manager,head', None),   # 3
            ('Arty Ficial', 'admin', None),  # 4

            # managers (M)
            ('Monty Carlo', 'manager', None),  # 5
            ('Moe Fugga', 'manager', None),  # 6

            # pi (P)
            ('Polly Tech', 'pi', None),  # 7
            ('Petey Cruiser', 'pi', None),  # 8
            ('Pat Agonia', 'pi', None),  # 9
            ('Paul Molive', 'pi', None),  # 10
            ('Pat Ernity', 'pi', None),  # 11

            # users (R, S)
            ('Ray Cyst', 'user', 7),  # 12
            ('Rick Shaw', 'user', 7),  # 13
            ('Rachel Slurs', 'user', 7),  # 14

            ('Reggie Stration', 'user', 8),  # 15
            ('Reuben Sandwich', 'user', 8),  # 16
            ('Sara Bellum', 'user', 8),  # 17
            ('Sam Owen', 'user', 8),  # 18

            ('Sam Buca', 'user', 10),  # 19
            ('Sarah Yevo', 'user', 10),  # 20
            ('Sven Gineer', 'user', 10),  # 21
            ('Sharon Needles', 'user', 10),  # 22

            ('Ray Diation', 'user', 11),  # 22
            ('Sal Ami', 'user', 11)   # 23
        ]

        for name, roles, pi in usersData:
            break
            first, last = name.lower().split()
            roles = roles.split(',')
            dm.create_user(username=last,
                           email='%s.%s@emhub.org' % (first, last),
                           phone='%d-%d%d' % (len(roles), len(first), len(last)),
                           password=last,
                           name=name,
                           roles=roles,
                           pi_id=pi)

        for uDict in self.json_data['users']:
            first, last = uDict['name'].lower().split()
            uDict['username'] = uDict['email']
            uDict['password'] = last
            dm.create_user(**uDict)

    def _populateResources(self, dm):
        self._action('Populating Resources')

        for rDict in self.json_data['resources']:
            dm.create_resource(**rDict)

    def _populateApplications(self, dm):
        def _getUser(a, username):
            u = dm.get_user_by(username=username)
            if u is None:
                print(f"Application {a['code']}: Invalid user: {username}")
            return u

        self._action('Populating Applications')

        templates = [dm.create_template(**ti)
                     for ti in self.json_data['templates']]

        apps = []
        for appDict in self.json_data['applications']:
            creator = _getUser(appDict, appDict.pop('creator'))
            if creator is None:
                continue
            appDict['creator_id'] = creator.id
            template_index = appDict.pop('template_index')
            appDict['template_id'] = templates[template_index].id
            pi_list = appDict.pop('pi_list', [])
            a = dm.create_application(**appDict)
            apps.append(a)

            # Add PIs
            for piName in pi_list:
                pi = dm.get_user_by(username=piName)
                if pi:
                    a.users.append(pi)

        # Let's make random assignment of all pi's to either
        # first or second application
        for user in dm.get_users():
            if user.is_pi:
                n = len(user.name)
                apps[n % 2].users.append(user)

        dm.commit()

    def __firstMonday(self, now):
        td = dt.timedelta(days=now.weekday())
        td7 = dt.timedelta(days=7)

        prevMonday = now - td

        while prevMonday.month == now.month:
            prevMonday = prevMonday - td7

        return prevMonday + td7

    def _populateBookings(self, dm):
        self._action('Populating Bookings')

        now = dm.now()
        feb27 = dm.date(dt.datetime(2023, 2, 27))
        firstMonday = self.__firstMonday(now - dt.timedelta(days=60))
        shift = dt.timedelta(days=(firstMonday - feb27).days)

        for bDict in self.json_data['bookings']:
            bDict['start'] = datetime_from_isoformat(bDict['start']) + shift
            bDict['end'] = datetime_from_isoformat(bDict['end']) + shift
            dm.create_booking(**bDict)

        return

        td = dt.timedelta  # shortcut

        def fm(shift):
            return (self.firstMonday + td(days=shift)).replace(hour=9)

    def _populateSessions(self, dm):
        return


def create_instance(instance_path, json_file, force):
    instance_path = instance_path or '~/.emhub/instances/test'
    instance_path = os.path.expanduser(instance_path)

    json_file = json_file or os.path.join(here, 'test_instance_data.json')

    if os.path.exists(instance_path):
        if force:
            Process.system(f'rm -rf {instance_path}', color=Color.green)
        else:
            raise Exception(f"Instance folder '{instance_path}' exists.\n"
                            f"Use -f to force cleanup.")

    Process.system(f"mkdir -p {instance_path}", color=Color.green)

    if not os.path.exists(json_file):
        raise Exception(f"Input JSON file '{json_file}' does not exists.")

    dm = DataManager(instance_path, cleanDb=True)
    TestData(dm, json_file)

    print(f"\n"
          f"EMhub instance sucessfully created!!!\n"
          f"To use it do:\n\n"
          f"export FLASK_APP=emhub\n"
          f"export EMHUB_INSTANCE={instance_path}\n"
          f"flask run --debug\n\n"
          f"And open a browser at: http://127.0.0.1:5000\n")
