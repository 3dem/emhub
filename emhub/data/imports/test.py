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
            first, last = name.lower().split()
            roles = roles.split(',')
            dm.create_user(username=last,
                           email='%s.%s@emhub.org' % (first, last),
                           phone='%d-%d%d' % (len(roles), len(first), len(last)),
                           password=last,
                           name=name,
                           roles=roles,
                           pi_id=pi)

    def _populateResources(self, dm):
        self._action('Populating Resources')

        resources = [
            {'name': 'Krios01', 'tags': 'microscope krios solna',
             'image': 'titan-krios.png', 'color': 'rgba(58, 186, 232, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8,
                       'max_booking': 72}},
            {'name': 'Krios02', 'tags': 'microscope krios solna',
             'status': 'inactive',
             'image': 'titan-krios.png', 'color': 'rgba(60, 90, 190, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8,
                       'max_booking': 72}},
            {'name': 'Talos', 'tags': 'microscope talos solna',
             'image': 'talos-artica.png', 'color': 'rgba(43, 84, 36, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8,
                       'max_booking': 72}},
            {'name': 'Vitrobot 1', 'tags': 'instrument solna',
             'image': 'vitrobot.png', 'color': 'rgba(158, 142, 62, 1.0)'},
            {'name': 'Vitrobot 2', 'tags': 'instrument solna',
             'image': 'vitrobot.png', 'color': 'rgba(69, 62, 25, 1.0)'},
            {'name': 'Carbon Coater', 'tags': 'instrument solna',
             'image': 'carbon-coater.png', 'color': 'rgba(48, 41, 40, 1.0)'},
            {'name': 'Users Drop-in', 'tags': 'service solna',
             'image': 'users-dropin.png', 'color': 'rgba(68, 16, 105, 1.0)',
             'extra': {'requires_slot': True}},

            # Umeå instruments
            {'name': 'Umeå Krios', 'tags': 'microscope krios umea',
             'image': 'titan-krios.png', 'color': 'rgba(15, 40, 130, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8,
                       'max_booking': 72}},
        ]

        for rDict in self.json_data['resources']:
            dm.create_resource(**rDict)

    def _populateApplications(self, dm):
        self._action('Populating Applications')

        templates = [dm.create_template(**ti)
                     for ti in self.json_data['templates']]

        for appDict in self.json_data['applications']:
            username = appDict.pop('creator')
            u = dm.get_user_by(username=username)
            appDict['creator_id'] = u.id
            template_index = appDict.pop('template_index')
            appDict['template_id'] = templates[template_index].id
            pi_list = appDict.pop('pi_list', [])
            a = dm.create_application(**appDict)

            # Add PIs
            for pi in pi_list:
                pi = dm.get_user_by(username=pi)
                a.users.append(pi)

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

        now = dm.now().replace(minute=0, second=0)
        month = now.month
        self.firstMonday = self.__firstMonday(now)
        td = dt.timedelta  # shortcut

        def fm(shift):
            return (self.firstMonday + td(days=shift)).replace(hour=9)

        # Create a booking at the downtime from today to one week later
        for r in [1, 3]:  # Krios 1 and  Talos
            for s in [0, 14]:
                dm.create_booking(title='',
                                  start=fm(s),
                                  end=fm(s+5).replace(hour=23),
                                  type='slot',
                                  slot_auth={'applications': ['CEM00297', 'CEM00315']},
                                  resource_id=r,
                                  creator_id=2,  # first user for now
                                  owner_id=2,  # first user for now
                                  description="Slot for National BAGs")

        # Create a downtime from today to one week later
        dm.create_booking(title='',
                          start=fm(17),
                          end=fm(21).replace(hour=23),
                          type='downtime',
                          resource_id=1,
                          creator_id=2,  # first user for now
                          owner_id=2,  # first user for now
                          description="Some downtime for some problem")

        dm.create_booking(title='',
                          start=fm(-7),
                          end=fm(-6).replace(hour=23),
                          type='booking',
                          resource_id=1,
                          creator_id=3,  # ann mull
                          owner_id=3,  # mull
                          description="")

        # Create booking for normal user
        b1 = dm.create_booking(title='',
                          start=fm(0),
                          end=fm(1).replace(hour=23),
                          type='booking',
                          resource_id=1,
                          creator_id=13,  # first user for now
                          owner_id=13,  # first user for now
                          description="")

        b2 = dm.create_booking(title='',
                          start=fm(2),
                          end=fm(4).replace(hour=23),
                          type='booking',
                          resource_id=1,
                          creator_id=2,  # first user for now
                          owner_id=16,  # Sara Belum
                          description="Krios 2 for user 3")

        dm.create_booking(title='Slot 2: RAPID',
                      start=fm(21),
                      end=fm(22).replace(hour=23),
                      type='slot',
                      slot_auth={'applications': ['CEM00332']},
                      resource_id=3,
                      creator_id=2,  # first user for now
                      owner_id=2,  # first user for now
                      description="Talos slot for RAPID applications")

        # create a repeating event
        dm.create_booking(title='Dropin',
                          start=fm(2),
                          end=fm(2).replace(hour=16),
                          type='slot',
                          repeat_value='bi-weekly',
                          repeat_stop=now + dt.timedelta(2*30),
                          resource_id=7,
                          creator_id=2,  # first user for now
                          owner_id=2,  # first user for now
                          description="Recurrent bi-weekly DROPIN slot. ")

        # create some alias for later use of bookings
        self.bookings = {
            "b1": b1,
            "b2": b2,
        }

    def _populateSessions(self, dm):
        return
        self._action('Populating Sessions')

        td = os.environ.get('EMHUB_TESTDATA')
        inst = os.environ.get('EMHUB_INSTANCE')

        b1 = self.bookings['b1']
        dm.create_session(
            name='supervisor_23423452_20201223_123445',
            start=b1.start,
            end=None,
            status='running',
            resource_id=b1.resource_id,  # Krios 1
            booking_id=b1.id,
            operator_id=1,  # User  X
        )

        b2 = self.bookings['b2']
        dm.create_session(
            name='epu-mysession_20122310_234542',
            start=b2.start,
            end=None,
            status='failed',
            resource_id=b2.resource_id,  # Krios 2
            booking_id=b2.id,
            operator_id=6,  # User  6
        )

        #shutil.copyfile(os.path.join(td, 'hdf5/t20s_pngs.h5'),
        #                os.path.join(inst, 'sessions/session_000002.h5'))


def create_instance(instance_path, json_file, force):
    instance_path = instance_path or '~/.emhub/instances/test'
    json_file = json_file or os.path.join(here, 'test_instance.json')

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
