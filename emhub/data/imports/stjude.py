# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (josemiguel.delarosatrevin@scilifelab.se) [1]
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


import os, sys
import shutil
import datetime as dt
import csv

from emhub.data import DataManager
from emhub.data.imports import TestDataBase
from collections import OrderedDict

instance_path = os.environ['EMHUB_INSTANCE']

fn = os.path.join(instance_path, 'PhonebookSearchResults.csv')

def loadUsers(csvFile):

    row_format = u"{:<15}{:<25}{:<45}{:<40}" #{:<35}{:<5}{:<5}{:<20}"

    s1 = 'Supervisor/ContactName'
    s2 = 'Supervisor/ContactEmail'

    usersDict = OrderedDict()
    supervisorsDict = OrderedDict()

    with open(fn) as csv_file:
        csv_reader = csv.DictReader(csv_file, delimiter=',')
        line_count = 0
        for row in csv_reader:
            if line_count == 0:
                print(f'Column names are {", ".join(row)}')
                print(row_format.format('FirstName', 'LastName', 'EmailAddress', 'Supervisor'))
                line_count += 1
            else:
                email = row['EmailAddress']
                userRow = [row["FirstName"], row["LastName"], (row[s1], row[s2]), email, row['Title']]
                usersDict[email] = userRow
                #print(row_format.format(row["FirstName"], row["LastName"], email, s))
                supEmail = row[s2]
                if supEmail not in supervisorsDict:
                    supervisorsDict[supEmail] = []
                supervisorsDict[supEmail].append(userRow)

            line_count += 1

    return usersDict, supervisorsDict


class SJData(TestDataBase):
    """ Class to create a testing dataset for a given DataManager.
    """
    def __init__(self, dm, usersCsv):
        """
        Args:
            dm: DataManager with db to create test data
            usersCsv: CSV file with users info
        """
        dm.create_admin()
        self.usrDict, self.supDict = loadUsers(usersCsv)
        self.__importData(dm, usersCsv)

    def __importData(self, dm, usersCsv):
        print("Populating forms...")
        self._populateForms(dm)

        print("Populating resources...")
        self._populateResources(dm)

        # Create tables with test data for each database model
        print("Importing users...")
        self._populateUsers(dm)

        print("Populating applications...")
        self._populateApplications(dm)

    def _populateResources(self, dm):
        resources = [
            {'name': 'Krios 1', 'tags': 'microscope krios stjude',
             'image': 'titan-krios.png', 'color': 'rgba(58, 186, 232, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8,
                       'max_booking': 72}},
            {'name': 'Krios 2', 'tags': 'microscope krios stjude',
             'image': 'titan-krios.png', 'color': 'rgba(60, 90, 190, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8,
                       'max_booking': 72}},
            {'name': 'Artica', 'tags': 'microscope artica stjude',
             'image': 'talos-artica.png', 'color': 'rgba(43, 84, 36, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8,
                       'max_booking': 72}},
            {'name': 'Talos', 'tags': 'microscope talos solna',
             'image': 'talos.jpeg', 'color': 'rgb(129, 204, 142, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8,
                       'max_booking': 72}},
            {'name': 'Vitrobot', 'tags': 'instrument solna',
             'image': 'vitrobot.png', 'color': 'rgba(158, 142, 62, 1.0)'},
            {'name': 'Carbon Coater', 'tags': 'instrument solna',
             'image': 'carbon-coater.png', 'color': 'rgba(48, 41, 40, 1.0)'},
            {'name': 'Users Drop-in', 'tags': 'service solna',
             'image': 'users-dropin.png', 'color': 'rgba(68, 16, 105, 1.0)',
             'extra': {'requires_slot': True}},
        ]

        for rDict in resources:
            dm.create_resource(**rDict)

    def _populateUsers(self, dm):
        # Create user table
        # for name, roles, pi in usersData:
        # [row["FirstName"], row["LastName"], (row[s1], row[s2]), email]
        def _createUser(row, roles=None, pi_id=None):
            email = row[3]
            first, last = row[0], row[1]
            return dm.create_user(username=email,
                           email=email,
                           phone='%d%d' % (len(first), len(last)),
                           password='1234',
                           name='%s %s' % (first, last),
                           roles=roles or ['user'],
                           pi_id=pi_id)

        piDict = {}
        for email in self.supDict:
            piRow = self.usrDict.get(email, None)
            if piRow is not None:
                title = piRow[4]
                roles = ['pi']
                if 'Directing' in title:
                    roles.append('head')
                pi = _createUser(piRow, roles=roles)
                piDict[email] = pi

        for email, row in self.usrDict.items():
            if email not in self.supDict:
                roles = ['user']
                pi = piDict.get(row[2][1], None)
                pi_id = pi.id if pi else None
                if pi_id:
                    if pi.is_head:
                        roles = ['manager']
                user = _createUser(row, roles=roles, pi_id=pi_id)


    def _populateApplications(self, dm):
        templateInfo = [
            {'title': 'Internal Users Template',
             'description': 'This is a special template used for internal users. ',
             'status': 'closed',
             },
        ]

        templates = [dm.create_template(**ti) for ti in templateInfo]

        applications = [
            {'code': 'SB001',
             'alias': 'Structural Biology',
             'status': 'active',
             'title': 'Internal Structural Biology application',
             'creator': 'admin',
             'template_id': templates[0].id,
             'invoice_reference': 'AAA',
             'invoice_address': '',
             'resource_allocation': {'quota': {'talos': 10, 'krios': 5},
                                     'noslot': []},
             'description': ""
             }
        ]

        for pDict in applications:
            username = pDict.pop('creator')
            u = dm.get_user_by(username=username)
            pDict['creator_id'] = u.id
            a = dm.create_application(**pDict)

        for piEmail in self.supDict.keys():
            u = dm.get_user_by(email=piEmail)
            if u is not None:
                a.users.append(u)

        dm.commit()

    def __firstMonday(self, now):
        td = dt.timedelta(days=now.weekday())
        td7 = dt.timedelta(days=7)

        prevMonday = now - td

        while prevMonday.month == now.month:
            prevMonday = prevMonday - td7

        return prevMonday + td7


    def _populateBookings(self, dm):
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
        dm.create_booking(title='',
                          start=fm(0),
                          end=fm(1).replace(hour=23),
                          type='booking',
                          resource_id=1,
                          creator_id=13,  # first user for now
                          owner_id=13,  # first user for now
                          description="")

        dm.create_booking(title='',
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

    def _populateSessions(self, dm):
        td = os.environ.get('EMHUB_TESTDATA')
        inst = os.environ.get('EMHUB_INSTANCE')

        dm.create_session(
            name='supervisor_23423452_20201223_123445',
            start=self._datetime(2020, 3, 5, 12, 30, 10),
            end=None,
            status='running',
            #data_path=os.path.join(td, 'hdf5/20181108_relion30_tutorial.h5'),
            acquisition={'voltage': 300,
                         'cs': 2.7,
                         'phasePlate': False,
                         'detector': 'Falcon2',
                         'detectorMode': 'Linear',
                         'pixelSize': 1.1,
                         'dosePerFrame': 1.0,
                         'totalDose': 35,
                         'exposureTime': 1.2,
                         'numOfFrames': 48,
                         },
            stats={'numMovies': 423,
                   'numMics': 0,
                   'numCtf': 0,
                   'numPtcls': 0,
                   },
            resource_id=1,  # Krios 1
            booking_id=None,
            operator_id=1,  # User  X
        )

        shutil.copyfile(os.path.join(td, 'hdf5/20181108_relion30_tutorial.h5'),
                        os.path.join(inst, 'sessions/session_000001.h5'))

        dm.create_session(
            name='epu-mysession_20122310_234542',
            start=self._datetime(2020, 4, 5, 12, 30, 10),
            end=None,
            status='failed',
            #data_path=os.path.join(td, 'hdf5/t20s_pngs.h5'),
            acquisition={'voltage': 300,
                         'cs': 2.7,
                         'phasePlate': False,
                         'detector': 'Falcon2',
                         'detectorMode': 'Linear',
                         'pixelSize': 1.1,
                         'dosePerFrame': 1.0,
                         'totalDose': 35,
                         'exposureTime': 1.2,
                         'numOfFrames': 48,
                         },
            stats={'numMovies': 234,
                   'numMics': 234,
                   'numCtf': 234,
                   'numPtcls': 2,
                   },
            resource_id=2,  # Krios 2
            booking_id=None,
            operator_id=6,  # User  6
        )

        shutil.copyfile(os.path.join(td, 'hdf5/t20s_pngs.h5'),
                        os.path.join(inst, 'sessions/session_000002.h5'))

        dm.create_session(
            name='session_very_long_name',
            start=self._datetime(2020, 5, 7, 12, 30, 10),
            end=self._datetime(2020, 5, 8, 9, 30, 10),
            status='finished',
            data_path=os.path.join(td, 'non-existing-file'),
            acquisition={'voltage': 300,
                         'cs': 2.7,
                         'phasePlate': False,
                         'detector': 'Falcon2',
                         'detectorMode': 'Linear',
                         'pixelSize': 1.1,
                         'dosePerFrame': 1.0,
                         'totalDose': 35,
                         'exposureTime': 1.2,
                         'numOfFrames': 48,
                         },
            stats={'numMovies': 2543,
                   'numMics': 2543,
                   'numCtf': 2543,
                   'numPtcls': 2352534,
                   },
            resource_id=3,  # Talos
            booking_id=None,
            operator_id=12,  # User  12
        )


if __name__ == '__main__':
    instance_path = os.path.abspath(os.environ.get("EMHUB_INSTANCE",
                                                   'instance'))

    if not os.path.exists(instance_path):
        raise Exception("Instance folder '%s' not found!!!" % instance_path)

    dm = DataManager(instance_path, cleanDb=True)
    TestData(dm)