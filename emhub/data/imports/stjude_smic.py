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


import os
import sys
import json
import datetime as dt
import csv
from collections import OrderedDict
from pprint import pprint

from emtools.utils import Color

from emhub.data import DataManager
from emhub.data.imports import TestDataBase


here = os.path.abspath(os.path.dirname(__file__))
instance_path = os.path.abspath(os.environ.get("EMHUB_INSTANCE", ''))


if not (instance_path and os.path.exists(instance_path)):
    raise Exception("Instance folder '%s' not found!!!" % instance_path)

print("\n>>> Using instance: ", Color.green(instance_path))


class SmicData(TestDataBase):
    """ Class to create an initial database and Emhub instance files for
    Single Molecule Imaging Center
    """
    def __init__(self, dm):
        """
        Args:
            dm: DataManager with db to create test data
            instance_path: Path to the folder for this instance
        """
        dm.create_basic_users()
        # It is required a folder input_csv with information about
        # the resources and the users
        self._users = OrderedDict()
        self._projects = OrderedDict()
        self._resources = OrderedDict()
        self._platesDict = {}

        self.dm = dm
        self.__importData()

    def __importData(self):
        def _csv(fn):
            return os.path.join(instance_path, 'input_csv', fn)

        self._populateForms()

        self._populateResources(_csv('smic_resources.csv'))

        self._populateUsers(_csv('smic_users.csv'))

        bookingsCsv = {
            'TIRF2': _csv('smic_bookings_tirf2.csv'),
            'TIRF3': _csv('smic_bookings_tirf3.csv'),
            'MicroTime200': _csv('smic_bookings_mt200.csv'),
            'FluoTime300': _csv('smic_bookings_ft300.csv')
        }
        self._populatePlates(_csv('smic_plates.csv'))

        self._populateBookings(bookingsCsv)

        self._populateApplications()

    def _populateForms(self):
        jsonPath = os.path.join(here, 'forms_smic.json')
        with open(jsonPath) as f:
            formsJson = json.load(f)
            for form in formsJson:
                self.dm.create_form(**form)

    def _populateResources(self, resourcesCsv):
        print(Color.green("\n>>> Populating Resources..."))

        colors = ['rgba(58, 186, 232, 1.0)',
                  'rgba(60, 90, 190, 1.0)',
                  'rgba(43, 84, 36, 1.0)',
                  'rgb(129, 204, 142, 1.0)',
                  'rgba(158, 142, 62, 1.0)',
                  'rgba(48, 41, 40, 1.0)',
                  'rgba(68, 16, 105, 1.0)'
                  ]

        with open(resourcesCsv) as csv_file:
            csv_reader = csv.DictReader(csv_file, delimiter=',')
            line_count = 0
            for i, row in enumerate(csv_reader):
                r = self.dm.create_resource(
                    name=row['\ufeffName'],
                    image='',
                    color=colors[i],
                    tags='instrument',
                    extra={
                        'description': row['Description'],
                        'requires_application': False
                    })
                self._resources[r.id] = r
                self._resources[r.name] = r

    def _populateUsers(self, usersCsv):
        print(Color.green("\n>>> Populating Users..."))

        # Default project
        user_id = self.dm._user.id
        self._projects[user_id] = self.dm.create_project(
            user_id=user_id,
            title='Default Project'
        )

        with open(usersCsv) as csv_file:
            csv_reader = csv.DictReader(csv_file, delimiter=',')
            for i, row in enumerate(csv_reader):
                def _value(key):
                    return row[key].strip()

                email = _value('Email address').lower()
                names = email.split('@')[0].split('.')
                roles = ['user']
                if _value('Site Admin?'):
                    roles.append('admin')
                if _value('Is PI?'):
                    roles.append('pi')

                piName = _value('PI').split(',')[0].strip()
                pi = self._user(piName)
                pi_id = pi.id if pi else None

                print(email, _value('Site Admin?'), _value('Is PI?'), roles)

                user = self.dm.create_user(
                    username=email,
                    email=email,
                    phone='0000',
                    password='1234',
                    name='%s %s' % (names[0].capitalize(), names[1].capitalize()),
                    roles=roles,
                    pi_id=pi_id)
                self._users[user.id] = user

                self._projects[user.id] = self.dm.create_project(
                    user_id=user.id,
                    title='Project of ' + user.name,
                    extra={'user_can_edit': True}
                )

    def _populateApplications(self):
        print(Color.green("\n>>> Populating Applications..."))

        templateInfo = [
            {'title': 'Internal Users Template',
             'description': 'This is a special template used for internal users. ',
             'status': 'active',
             },
        ]

        templates = [self.dm.create_template(**ti) for ti in templateInfo]

        applications = [
            {'code': 'SB001',
             'alias': 'Structural Biology',
             'status': 'active',
             'title': 'Internal Structural Biology application',
             'template_id': templates[0].id,
             'invoice_reference': 'AAA',
             'invoice_address': '',
             'resource_allocation': {'quota': {'talos': 10, 'krios': 5},
                                     'noslot': []},
             'description': ""
             }
        ]

        for pDict in applications:
            pDict['creator_id'] = self.dm._user.id
            a = self.dm.create_application(**pDict)

        for user in self._users.values():
            if user.is_pi:
                print("Adding pi: ", user.name)
                a.users.append(user)

        self.dm.commit()

    def __firstMonday(self, now):
        td = dt.timedelta(days=now.weekday())
        td7 = dt.timedelta(days=7)

        prevMonday = now - td

        while prevMonday.month == now.month:
            prevMonday = prevMonday - td7

        return prevMonday + td7

    def _user(self, alias):
        am = {'dt': 'daniel.terry',
              'ab': 'alessandro.borgia'}
        a = am.get(alias.lower(), alias.lower())
        for u in self._users.values():
            if a in u.email:
                return u
        return None

    def _resource(self, name):
        for r in self._resources.values():
            if name in r.name:
                return r
        return None

    def _date(self, dateStr, delta=None):
        ds = dateStr.strip()
        formats = ['%a %m/%d/%Y %I:%M %p', '%m/%d/%Y %I:%M %p', '%m/%d/%Y', '%d-%b-%Y']
        d = None
        for f in formats:
            try:
                d = dt.datetime.strptime(ds, f)
                break
            except ValueError:
                pass

        if d:
            if delta:
                d += delta
            d = self.dm.dt_as_local(d)

        return d

    def _populateBookings(self, bookingsCsvDict):
        print(Color.green("\n>>> Populating Bookings..."))

        for resourceName, bookingsCsv in bookingsCsvDict.items():
            resource = self._resource(resourceName)

            if resource is None:
                print(Color.red('ERROR, invalid resource: ' + resourceName))
                continue

            with open(bookingsCsv) as csv_file:
                csv_reader = csv.DictReader(csv_file, delimiter=',')
                oneMinuteLess = -dt.timedelta(minutes=1)

                for i, row in enumerate(csv_reader):
                    def _value(key):
                        return row[key].strip()

                    try:
                        parts = row['Name'].split()
                        title = row['Name'] if len(parts) > 1 else ''
                        user = self._user(row['Name'])

                        if user is None:
                            user = self.dm._user
                            title = 'NO-USER: ' + title

                        project = self._projects.get(user.id,
                                                     self._projects[self.dm._user.id])

                        start = self._date(row['Start'])
                        plateKey = user.id, resource.id, start.date()
                        plates = []


                        if plateKey in self._platesDict:
                            for plateRow in self._platesDict[plateKey]:
                                issuesStr = plateRow['Issues?'].strip()
                                issues = issuesStr and issuesStr != 'no'

                                plates.append({
                                    'plate': str(self._platesDict[(plateRow['Plate batch'], plateRow['#'])].id),
                                    'channel': plateRow['Channel'],
                                    'sample': plateRow['Sample type'],
                                    'comments': plateRow['Comments'],
                                    'issues': issues
                                })
                        experiment = {'plates': plates} if plates else None

                        self.dm.create_booking(title=title,
                                          start=start,
                                          end=self._date(row['End'], oneMinuteLess),
                                          type='booking',
                                          resource_id=resource.id,
                                          creator_id=user.id,  # first user for now
                                          owner_id=user.id,  # first user for now
                                          project_id=project.id,
                                          experiment=experiment,
                                          description="")
                    except Exception as e:
                        print(Color.red('ERROR: '), e, "Row: ", row)

    def _populatePlates(self, platesCsv):
        plates = set()
        lastYear = None


        iniDict = {}

        for u in self._users.values():
            if '.' in u.email:
                p = u.email.lower().split('.')
                iniDict[p[0][0] + p[1][0]] = u

        def _user(initials):
            initials = initials.strip().lower().split(',')[0].split(' ')[0]
            if len(initials) > 2:
                return self._user(initials)
            return iniDict.get(initials, None)

        resourcesMap = {
            'pTIRF1': 'TIRF1',
            'pTIRF2': 'TIRF2',
            'pTIRF3': 'TIRF3',
            'MT200': 'MicroTime200'
        }

        with open(platesCsv, encoding='iso-8859-1') as csv_file:
            csv_reader = csv.DictReader(csv_file, delimiter=',')
            #csv_reader = csv.reader(csv_file, delimiter=',')
            for i, row in enumerate(csv_reader):
                if batchStr := row['Plate batch']:
                    try:
                        if batchStr[0] != 'B':
                            continue
                        batch = int(batchStr[1:])
                        plate = int(row['#'])
                        bp = (batch, plate)
                        user = _user(row['User'])
                        date = self._date(row['Date']) or self._date(row['Date'] + lastYear)

                        resource = self._resources.get(resourcesMap.get(row['Instrument'], ''), None)

                        if user is None:
                            pass
                            #print(Color.warn('No-user'), 'row:', row)

                        if date is None:
                            pass
                            print(Color.warn('No-date'), 'row:', row)
                        else:
                            lastYear = '-' + str(date.year)

                        if resource is None:
                            pass
                            #print(Color.warn('No-resource'), 'row:', row)

                        if not (user and date and resource):
                            continue

                        if bp not in plates:
                            code = f"B{batch:03}_{plate:02}"
                            p = self.dm.create_puck(
                                code=code,
                                label=code,
                                dewar=batch,
                                cane=plate,
                                position=0)
                            plates.add(bp)
                            self._platesDict[(f'B{batch}', str(plate))] = p

                        plateKey = user.id, resource.id, date.date()
                        if plateKey not in self._platesDict:
                            self._platesDict[plateKey] = []

                        self._platesDict[plateKey].append(row)

                    except Exception as e:
                        print(Color.red("Error:"), str(e))
                        print(row)
                        raise e

    def _populateSessions(self):
        pass


if __name__ == '__main__':
    dm = DataManager(instance_path, cleanDb=True)
    SmicData(dm)
