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
import traceback

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
        print(Color.bold(f'\n>>> {title}'))

    def __init__(self, dm, json_file, fix_dates=False):
        self.instance_path = dm._dataPath
        self.json_data = None
        print(f">>> Loading JSON data from {Color.bold(json_file)}")
        with open(json_file) as f:
            self.json_data = json.load(f)

        # Some dates to shift events
        now = dm.now()
        feb27 = dm.date(dt.datetime(2023, 2, 27))
        firstMonday = self.__firstMonday(now - dt.timedelta(days=60))

        if fix_dates:
            self.date_shift = dt.timedelta(days=(firstMonday - feb27).days)
        else:
            self.date_shift = dt.timedelta(days=0)

        self.dm = dm
        dm.create_admin()
        # Create tables with test data for each database model
        self._populateForms(dm)
        self._populateUsers(dm)
        self._populateResources(dm)
        self._populateApplications(dm)
        self._populateProjects(dm)
        self._populateBookings(dm)
        self._populateSessions(dm)
        self._populatePucks(dm)
        self._populateEntries(dm)

        # Create one invoice period
        dm.create_invoice_period(start=firstMonday,
                                 end=firstMonday + dt.timedelta(days=90))

        self._createTemplateFiles()

    def _populateForms(self, dm):
        self._action('Populating Forms')

        for form in self.json_data['forms']:
            if form['name'] == 'config:projects':
                # Let's create the special entry 'news'
                # for creating news that are stored
                # in a "special" project
                entries = form['definition']['entries']
                entries['news'] = {
                    "group": 1,
                    "iconClass": "fas fa-box fa-inverse",
                    "imageClass": "img--picture",
                    "label": "News"
                }
            dm.create_form(**form)

    def _populateUsers(self, dm):
        self._action('Populating Users')

        for uDict in self.json_data['users']:
            uDict['username'] = uDict['email']
            uDict['password'] = uDict['email']
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
            for pid in pi_list:
                pi = dm.get_user_by(id=pid)
                if pi:
                    a.users.append(pi)

        dm.commit()

    def __firstMonday(self, now):
        td = dt.timedelta(days=now.weekday())
        td7 = dt.timedelta(days=7)

        prevMonday = now - td

        while prevMonday.month == now.month:
            prevMonday = prevMonday - td7

        return prevMonday + td7

    def __shift_date(self, dateIsoStr):
        return datetime_from_isoformat(dateIsoStr) + self.date_shift

    def __fix_dates(self, attrs, *keys):
        for k in keys:
            if k in attrs:
                attrs[k] = self.__shift_date(attrs[k])

    def _populateProjects(self, dm):
        self._action('Populating Projects')

        for pDict in self.json_data['projects']:
            self.__fix_dates(pDict, 'creation_date', 'last_update_date')

            if 'title' not in pDict:
                pDict['title'] = f"Project {pDict['id']} Title"

            dm.create_project(**pDict)

        # Create a special project for news
        dm.create_project(**{
            "id": 3,
            "title": "Special Project for News",
            "status": "special:news",
            "user_id": 1,
            "creation_user_id": 1,
            "last_update_user_id": 1,
            "extra": {
                "user_can_edit": True,
                "is_confidential": False,
                "collaborators_ids": []
            }
        })

    def _populateBookings(self, dm):
        self._action('Populating Bookings')

        for bDict in self.json_data['bookings']:
            self.__fix_dates(bDict, 'start', 'end')
            try:
                dm.create_booking(**bDict)
            except:
                print(f"Error creating booking with args: {bDict}")
                traceback.print_exc()

    def _populateSessions(self, dm):
        self._action('Populating Sessions')

        for sDict in self.json_data['sessions']:
            self.__fix_dates(sDict, 'start')
            sDict['check_raw'] = False
            sDict['name'] = 'S%05d' % sDict['id']
            dm.create_session(**sDict)

    def _populatePucks(self, dm):
        self._action('Populating Pucks')
        for puck in self.json_data.get('pucks', []):
            dm.create_puck(**puck)

    def _populateEntries(self, dm):
        self._action('Populating Entries')
        for entry in self.json_data.get('entries', []):
            self.__fix_dates(entry, 'date',
                             'creation_date',
                             'last_update_date')
            dm.create_entry(**entry)

    def _createTemplateFiles(self):
        instance_path = self.instance_path

        # Write Redis config file template and running script
        fn = os.path.join(instance_path, 'redis.conf.template')
        self._action(f'Creating Redis configuration template: {fn}')
        with open(fn, 'w') as f:
            f.write("""
# Redis configuration file example.
#
# Note that in order to read the configuration file, Redis must be
# started with the file path as first argument:
#
# ./redis-server /path/to/redis.conf

bind 127.0.0.1
port 5001

save 900 1
save 300 10
save 60 1000

dbfilename dump.rdb

# The working directory.
#
# The DB will be written inside this directory, with the filename specified
# above using the 'dbfilename' configuration directive.

dir ./\n""")
        fn = os.path.join(instance_path, 'run_redis.sh')
        self._action(f'Creating Redis run script: {fn}')
        with open(fn, 'w') as f:
            f.write(f"""
#!/usr/bin/bash 
. /software/scipion/conda/etc/profile.d/conda.sh
conda activate redis-server
cd {instance_path} && redis-server redis.conf --daemonize yes\n""")

        fn = os.path.join(instance_path, 'bashrc')
        self._action(f'Creating bashrc script: {fn}')
        with open(fn, 'w') as f:
            f.write(f"""
#!/usr/bin/bash 

# Get the directory of the current script
export DIR="$( cd -- "$( dirname -- "${{BASH_SOURCE[0]}}" )" &> /dev/null && pwd )"

export FLASK_APP=emhub
export EMHUB_INSTANCE=${{DIR}}
export EMHUB_USER=admin
export EMHUB_PASSWORD=admin
export EMHUB_SERVER_URL=http://127.0.0.1:5000

""")
        run_fn = os.path.join(instance_path, 'run.sh')
        self._action(f'Creating run script: {run_fn}')
        with open(run_fn, 'w') as f:
            f.write(f"""
#!/usr/bin/bash 

# Get the directory of the current script
export DIR="$( cd -- "$( dirname -- "${{BASH_SOURCE[0]}}" )" &> /dev/null && pwd )"

. ${{DIR}}/bashrc
flask run --debug

""")

        # Give execute permissions to the run script
        Process.system(f"chmod +x {run_fn}", color=Color.green)

        useCmd = Color.green(f"{instance_path}/run.sh\n")
        print(f"\n"
              f"EMhub instance sucessfully created!!!\n"
              f"To use it do:\n\n"
              f"{useCmd}\n"
              f"And open a browser at: http://127.0.0.1:5000\n"
              f"user: admin, password: admin")


def create_instance(instance_path, json_file, force):
    instance_path = instance_path or '~/.emhub/instances/test'
    instance_path = os.path.expanduser(instance_path)

    if json_file:
        fix_dates = False
    else:
        # For the test dataset we want to "fix" the dates by shifting
        # all dates to the current day to make them visible
        json_file = os.path.join(here, 'test_instance_data.json')
        fix_dates = True

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
    TestData(dm, json_file, fix_dates=fix_dates)

    return dm


