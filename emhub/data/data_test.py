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
import datetime as dt


class TestData:
    """ Class to create a testing dataset for a given DataManager.
    """
    def __init__(self, dm):
        """
        Args:
            dm: DataManager with db to create test data
        """
        self.__populateTestData(dm)

    def __populateTestData(self, dm):
        # Create tables with test data for each database model
        print("Populating users...")
        self.__populateUsers(dm)
        print("Populating resources...")
        self.__populateResources(dm)
        print("Populating applications...")
        self.__populateApplications(dm)
        print("Populating sessions...")
        self.__populateSessions(dm)
        print("Populating Bookings")
        self.__populateBookings(dm)

    def __populateUsers(self, dm):
        # Create user table
        usersData = [
            # dev (D)
            ('Don Stairs', 'developer', None),  # 1

            # admin (A)
            ('Anna Mull', 'admin,manager', None),   # 2
            ('Arty Ficial', 'admin', None),  # 3

            # managers (M)
            ('Monty Carlo', 'manager', None),  # 4
            ('Moe Fugga', 'manager', None),  # 5

            # pi (P)
            ('Polly Tech', 'pi', None),  # 6
            ('Peter Cruiser', 'pi', None),  # 7
            ('Pat Agonia', 'pi', None),  # 8
            ('Paul Molive', 'pi', None),  # 9

            # users (R, S)
            ('Ray Cyst', 'user', 6),  # 10
            ('Rick Shaw', 'user', 6),  # 11
            ('Rachel Slurs', 'user', 6),  # 12
            ('Reggie Stration', 'user', 7),  # 13
            ('Reuben Sandwich', 'user', 7),  # 14
            ('Sara Bellum', 'user', 7),  # 15
            ('Sam Owen', 'user', 7),  # 16
            ('Sam Buca', 'user', 9),  # 17
            ('Sarah Yevo', 'user', 9),  # 18
            ('Sven Gineer', 'user', 9),  # 19
            ('Sharon Needles', 'user', 9)  # 20
        ]

        for name, roles, pi in usersData:
            first, last = name.lower().split()
            dm.create_user(username=last,
                           email='%s.%s@emhub.org' % (first, last),
                           password=last,
                           name=name,
                           roles=roles,
                           pi_id=pi)

    def __populateResources(self, dm):
        resources = [
            {'name': 'Krios 1', 'tags': 'microscope krios',
             'image': 'titan-krios.png', 'color': 'rgba(58, 186, 232, 1.0)',
             # Allow DBB00001 users to book without slot
             'booking_auth': {'applications': ['DBB00001']}},
            {'name': 'Krios 2', 'tags': 'microscope krios',
             'image': 'titan-krios.png', 'color': 'rgba(33, 60, 148, 1.0)',
             'booking_auth': {'applications': ['DBB00001']}},
            {'name': 'Talos', 'tags': 'microscope talos',
             'image': 'talos-artica.png', 'color': 'rgba(43, 84, 36, 1.0)',
             'booking_auth': {'applications': ['DBB00001']}},
            {'name': 'Vitrobot 1', 'tags': 'instrument',
             'image': 'vitrobot.png', 'color': 'rgba(158, 142, 62, 1.0)',
             'booking_auth': {'users': ['any']}},
            {'name': 'Vitrobot 2', 'tags': 'instrument',
             'image': 'vitrobot.png', 'color': 'rgba(69, 62, 25, 1.0)',
             # Allow 'any' user to book without slot
             'booking_auth': {'users': ['any']}},
            {'name': 'Carbon Coater', 'tags': 'instrument',
             'image': 'carbon-coater.png', 'color': 'rgba(48, 41, 40, 1.0)',
             'booking_auth': {'users': ['any']}},
            {'name': 'Users Drop-in', 'tags': 'service',
             'image': 'users-dropin.png', 'color': 'rgba(68, 16, 105, 1.0)',
             'booking_auth': {'users': ['any']}}
        ]

        for rDict in resources:
            dm.create_resource(**rDict)

    def __populateApplications(self, dm):
        templateInfo = [
            {'title': 'BAG Application Form - 2019/2020',
             'description': 'Information required in order to submit a request '
                            'for group allocation time for one year.',
             'status': 'active',
             },
            {'title': 'Rapid Access for SPA and Tomography',
             'description': 'Application Form required to apply for time on a '
                            'project for either screening or data-collection. '
                            'Machine time will be allocate on 24 or 48 hours '
                            'slots. ',
             'status': 'active',
             },
            {'title': 'BAG Application Form - 2020/2021',
             'description': 'Information required in order to submit a request '
                            'for group allocation time for one year.',
             },
            {'title': 'Single Particle Application 161026',
             'description': 'Information required to request time for one year.',
             'status': 'closed',
             },
        ]

        templates = [dm.create_template(**ti) for ti in templateInfo]

        applications = [
            {'code': 'CEM00297',
             'alias': 'BAG Lund',
             'title': 'Bag Application for Lund University 2019/20',
             'description': '',
             'creator_id': 6,
             'invoice_reference': 'AAA',
             'invoice_address': '',
             'resource_allocation': {'talos': 10, 'krios': 5}
             },
            {'code': 'CEM00315',
             'alias': 'BAG SU',
             'title': 'Bag Application for Stockholm University',
             'description': '',
             'creator_id': 7,
             'invoice_reference': 'BBB',
             'invoice_address': '',
             'resource_allocation': {'talos': 10, 'krios': 5}
             },
            {'code': 'CEM00332',
             'alias': 'RAA Andersson',
             'title': 'Rapid Access application',
             'description': '',
             'creator_id': 8,
             'invoice_reference': 'ZZZ',
             'invoice_address': '',
             'resource_allocation': {'talos': 2, 'krios': 1}
             },
            {'code': 'DBB00001',
             'alias': 'SU-DBB',
             'title': 'Internal DBB project',
             'description': '',
             'creator_id': 9,
             'invoice_reference': 'DDD',
             'invoice_address': ''
             },
        ]

        for pDict in applications:
            dm.create_application(**pDict)

        a1 = dm.get_applications(condition="code='DBB00001'")[0]
        u1 = dm.get_users(condition="username='agonia'")[0]

        a1.users.append(u1)
        dm.commit()

    def _localnow(self):
        import pytz  # $ pip install pytz
        from tzlocal import get_localzone  # $ pip install tzlocal

        # get local timezone
        local_tz = get_localzone()

        return dt.datetime.now(local_tz)

    def __populateBookings(self, dm):
        now = self._localnow().replace(minute=0, second=0)
        month = now.month

        # Create a downtime from today to one week later
        dm.create_booking(title='First Booking',
                          start=now.replace(day=21),
                          end=now.replace(day=28),
                          type='downtime',
                          resource_id=1,
                          creator_id=1,  # first user for now
                          owner_id=1,  # first user for now
                          description="Some downtime for some problem")

        # Create a booking at the downtime from today to one week later
        dm.create_booking(title='Booking Krios 1',
                          start=now.replace(day=1, hour=9),
                          end=now.replace(day=2, hour=23, minute=59),
                          type='booking',
                          resource_id=1,
                          creator_id=2,  # first user for now
                          owner_id=2,  # first user for now
                          description="Krios 1 for user 2")

        # Create booking for normal user
        dm.create_booking(title='Booking Krios 1',
                          start=now.replace(day=4, hour=9),
                          end=now.replace(day=6, hour=23, minute=59),
                          type='booking',
                          resource_id=1,
                          creator_id=10,  # first user for now
                          owner_id=10,  # first user for now
                          description="Krios 1 for user 10")

        # Create a booking at the downtime from today to one week later
        dm.create_booking(title='Booking Krios 2',
                          start=now.replace(day=2, hour=9),
                          end=now.replace(day=4, hour=23, minute=59),
                          type='booking',
                          resource_id=2,
                          creator_id=1,  # first user for now
                          owner_id=3,  # first user for now
                          description="Krios 2 for user 3")

        # Create a booking at the downtime from today to one week later
        dm.create_booking(title='Slot 1: BAGs',
                          start=now.replace(day=6, hour=9),
                          end=now.replace(day=10, hour=23, minute=59),
                          type='slot',
                          slot_auth={'applications': ['CEM00297', 'CEM00315']},
                          resource_id=3,
                          creator_id=1,  # first user for now
                          owner_id=1,  # first user for now
                          description="Talos slot for National BAGs")

        dm.create_booking(title='Slot 2: RAPID',
                          start=now.replace(day=20, hour=9),
                          end=now.replace(day=24, hour=23, minute=59),
                          type='slot',
                          slot_auth={'applications': ['CEM00332']},
                          resource_id=3,
                          creator_id=1,  # first user for now
                          owner_id=1,  # first user for now
                          description="Talos slot for RAPID applications")

        # create a repeating event
        dm.create_booking(title='Dropin',
                          start=now.replace(day=6, hour=9),
                          end=now.replace(day=6, hour=13),
                          type='slot',
                          repeat_value='bi-weekly',
                          repeat_stop=now.replace(month=month+2),
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
                dateStarted=self._localnow(),
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
                          dateStarted=self._localnow(),
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


