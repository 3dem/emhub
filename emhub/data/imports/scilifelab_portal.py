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
import json

from emhub.utils import datetime_from_isoformat


class PortalData:
    """ Class to import data (users, templates, applications) from the
     Application Portal at SciLifeLab.
    """

    def __init__(self, dm, dataJsonPath, bookingsJsonPath):
        """
        Args:
            dm: DataManager with db to create test data
            dataJsonPath: file path to the JSON file with the data from the Portal.
                It is expected as a Dict with the following entries:
                * users
                * forms (Templates here)
                * orders (Applications here)
        """
        self.__importData(dm, dataJsonPath, bookingsJsonPath)

    def __importData(self, dm, dataJsonPath, bookingsJsonPath):
        # Create tables with test data for each database model
        print("Importing users...")

        with open(dataJsonPath) as jsonFile:
            jsonData = json.load(jsonFile)
            self._jsonUsers = jsonData['users']['items']
            self._dictUsers = {}
            self.__importUsers(dm)

        print("Populating resources...")
        self.__populateResources(dm)

        print("Importing applications...")
        self.__importApplications(dm, jsonData)

        with open(bookingsJsonPath) as bookingsFile:
            bookingsData = json.load(bookingsFile)

            # print("Populating sessions...")
            # self.__populateSessions(dm)
            print("Populating bookings")
            self.__importBookings(dm, bookingsData)

    def __importUsers(self, dm):
        # Create user table
        def createUser(u, **kwargs):
            roles = kwargs.get('roles', ['user'])
            pi = None
            if u['pi']:
                roles.append('pi')
            else:
                pi = kwargs.get('pi', None)

            user = dm.create_user(
                username=u['email'],
                email=u['email'],
                phone='',
                password=u['email'],
                name="%(first_name)s %(last_name)s" % u,
                roles=roles,
                pi_id=pi)

            u['emhub_item'] = user
            self._dictUsers[user.email] = user

        staff = {
            'marta.carroni@scilifelab.se': ['manager', 'head'],
            'julian.conrad@scilifelab.se': ['manager'],
            'karin.walden@scilifelab.se': ['manager'],
            'mathieu.coincon@scilifelab.se': ['manager'],
            'dustin.morado@scilifelab.se': ['admin', 'manager'],
            'stefan.fleischmann@scilifelab.se': ['admin'],
            'delarosatrevin@scilifelab.se': ['admin'],
        }

        #  Create first facility staff
        for u in self._jsonUsers:
            if u['email'] in staff:
                createUser(u, roles=staff[u['email']])

        # Insert first PI users, so we store their Ids for other users
        piDict = {}
        for u in self._jsonUsers:
            if u['pi']:
                createUser(u)
                piDict[u['email']] = u

        for u in self._jsonUsers:
            if not u['pi'] and not u['email'] in staff:
                piEmail = u['invoice_ref']
                if piEmail in piDict:
                    createUser(u, pi=piDict[piEmail]['emhub_item'].id)
                else:
                    print("Skipping user (Missing PI): ", u['email'])

    def __populateResources(self, dm):
        resources = [
            {'name': 'Krios 1', 'tags': 'microscope krios',
             'image': 'titan-krios.png', 'color': 'rgba(58, 186, 232, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8}},
            {'name': 'Krios 2', 'tags': 'microscope krios',
             'image': 'titan-krios.png', 'color': 'rgba(33, 60, 148, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8}},
            {'name': 'Talos', 'tags': 'microscope talos',
             'image': 'talos-artica.png', 'color': 'rgba(43, 84, 36, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8}},
            {'name': 'Vitrobot 1', 'tags': 'instrument',
             'image': 'vitrobot.png', 'color': 'rgba(158, 142, 62, 1.0)'},
            {'name': 'Vitrobot 2', 'tags': 'instrument',
             'image': 'vitrobot.png', 'color': 'rgba(69, 62, 25, 1.0)'},
            {'name': 'Carbon Coater', 'tags': 'instrument',
             'image': 'carbon-coater.png', 'color': 'rgba(48, 41, 40, 1.0)'},
            {'name': 'Users Drop-in', 'tags': 'service',
             'image': 'users-dropin.png', 'color': 'rgba(68, 16, 105, 1.0)',
             'extra': {'requires_slot': True}}
        ]

        for rDict in resources:
            dm.create_resource(**rDict)

    def __importApplications(self, dm, jsonData):
        statuses = {'disabled': 'closed',
                    'review': 'review',
                    'preparation': 'preparation',
                    'enabled': 'active',
                    'rejected': 'rejected'
                    }

        def createTemplate(f):
            return dm.create_template(
                title=f['title'],
                description=f['description'],
                status=statuses[f['status']]
            )

        formsDict = {}

        internalTemplate = dm.create_template(
            title='Template for internal applications (DBB or FAC)',
            description='Special template for internal applications',
            status='closed')

        for f in jsonData['forms'].values():
            f['emhub_item'] = createTemplate(f)
            formsDict[f['iuid']] = f

        now = dm.now()

        def _internalPi(u):
            return (u['pi'] and 'emhub_item' in u and
                    (u['email'].endswith('dbb.su.se')
                     or u['email'].endswith('scilifelab.se')))

        # Insert first PI users, so we store their Ids for other users
        dbbPis = [u['emhub_item'] for u in self._jsonUsers if _internalPi(u)]

        gunnar = self._dictUsers['gunnar@dbb.su.se']

        # Create special bag for internal DBB PIs
        internalApp = dm.create_application(
            code='DBB',
            title='Internal DBB Bag',
            created=now,  # datetime_from_isoformat(o['created']),
            alias='DBB',
            status='active',
            description='Internal application for DBB users',
            creator_id=gunnar.id,
            template_id=internalTemplate.id,
            invoice_reference='DBB invoice',
            resource_allocation={'quota': {'krios': 0, 'talos': 0},
                                 'noslot': [1, 2, 3]}  # allow to book scopes
        )

        for pi in dbbPis:
            internalApp.users.append(pi)

        for o in jsonData['orders']:
            piEmail = o['owner']['email']
            orderId = o['identifier']

            pi = self._dictUsers.get(piEmail, None)

            if pi is None:
                print("Ignoring ORDER '%s', owner email (%s) not found as PI"
                      % (orderId, piEmail))
                continue

            status = o['status']
            # Set some accepted as 'active' and other as 'closed'
            # created = dt.datetime.strptime(o['created'], '%Y-%m-%d')
            created = datetime_from_isoformat(o['created'])

            if status == 'accepted' or status == 'enabled':
                if created.year == now.year or created.year == now.year - 1:
                    status = 'active'
                else:
                    status = 'closed'
            else:
                status = statuses[status]

            fields = o['fields']
            description = fields.get('project_des', None)
            invoiceRef = fields.get('project_invoice_addess', None)

            try:
                app = dm.create_application(
                    code=orderId,
                    title=o['title'],
                    created=created,  # datetime_from_isoformat(o['created']),
                    alias=status,
                    status=status,
                    description=description,
                    creator_id=pi.id,
                    template_id=formsDict[o['form']['iuid']]['emhub_item'].id,
                    invoice_reference=invoiceRef or 'MISSING_INVOICE_REF',
                )

                for piTuple in fields.get('pi_list', []):
                    piEmail = piTuple[1]
                    pi = self._dictUsers.get(piEmail, None)
                    if pi is not None:
                        app.users.append(pi)

            except Exception as e:
                print("Exception when creating Application: %s. IGNORING..." % e)

        dm.commit()

    def __importBookings(self, dm, bookingsJson):
        now = dm.now().replace(minute=0, second=0)
        month = now.month

        resourcesDict = {
            'Titan Krios': 1,
            'Talos Arctica': 3,
            'Vitrobot': 4,
            'Carbon Coater': 6
        }

        for b in bookingsJson:
            name = b['user']['name']
            email = b['user']['email']
            resource = b['resourceName']

            if email not in self._dictUsers or resource not in resourcesDict:
                print(b['startDate'], b['endDate'], b['resourceName'],
                      b['title'], name)
                continue

            title = b['title']
            titleLow = title.lower()

            type = 'booking'
            if 'downtime' in titleLow:
                type = 'downtime'

            user = self._dictUsers[email]

            try:
                dm.create_booking(
                    check_min_booking=False,
                    title=b['title'],
                    start=datetime_from_isoformat(b['startDate']),
                    end=datetime_from_isoformat(b['endDate']),
                    type=type,
                    resource_id=resourcesDict[resource],
                    creator_id=user.id,  # first user for now
                    owner_id=user.id,  # first user for now
                    description="")
            except Exception as e:
                print("Exception when creating Booking: %s. IGNORING..." % e)

        # create a repeating event
        dm.create_booking(title='Dropin',
                          start=now.replace(day=6, hour=9),
                          end=now.replace(day=6, hour=13),
                          type='slot',
                          repeat_value='bi-weekly',
                          repeat_stop=now.replace(month=month + 2),
                          resource_id=7,
                          creator_id=1,  # first user for now
                          owner_id=1,  # first user for now
                          description="Recurrent bi-weekly DROPIN slot. ")

    def __populateSessions(self, dm):
        users = [1, 2, 2]
        session_names = ['supervisor_23423452_20201223_123445',
                         'epu-mysession_20122310_234542',
                         'mysession_very_long_name']

        testData = os.environ.get('EMHUB_TESTDATA')
        fns = [os.path.join(testData, 'hdf5/20181108_relion30_tutorial.h5'),
               os.path.join(testData, 'hdf5/t20s_pngs.h5'), 'non-existing-file']

        scopes = ['Krios 1', 'Krios 2', 'Krios 3']
        numMovies = [423, 234, 2543]
        numMics = [0, 234, 2543]
        numCtfs = [0, 234, 2543]
        numPtcls = [0, 2, 2352534]
        status = ['Running', 'Error', 'Finished']

        for f, u, s, st, sc, movies, mics, ctfs, ptcls in zip(fns, users, session_names,
                                                              status, scopes, numMovies,
                                                              numMics, numCtfs, numPtcls):
            dm.create_session(
                sessionData=f,
                userid=u,
                sessionName=s,
                dateStarted=dm.now(),
                description='Long description goes here.....',
                status=st,
                microscope=sc,
                voltage=300,
                cs=2.7,
                phasePlate=False,
                detector='Falcon',
                detectorMode='Linear',
                pixelSize=1.1,
                dosePerFrame=1.0,
                totalDose=35.0,
                exposureTime=1.2,
                numOfFrames=48,
                numOfMovies=movies,
                numOfMics=mics,
                numOfCtfs=ctfs,
                numOfPtcls=ptcls,
                numOfCls2D=0,
                ptclSizeMin=140,
                ptclSizeMax=160,
            )

        dm.create_session(sessionData='dfhgrth',
                          userid=2,
                          sessionName='dfgerhsrth_NAME',
                          dateStarted=dm.now(),
                          description='Long description goes here.....',
                          status='Running',
                          microscope='KriosX',
                          voltage=300,
                          cs=2.7,
                          phasePlate=False,
                          detector='Falcon',
                          detectorMode='Linear',
                          pixelSize=1.1,
                          dosePerFrame=1.0,
                          totalDose=35.0,
                          exposureTime=1.2,
                          numOfFrames=48,
                          numOfMovies=0,
                          numOfMics=0,
                          numOfCtfs=0,
                          numOfPtcls=0,
                          numOfCls2D=0,
                          ptclSizeMin=140,
                          ptclSizeMax=160, )
