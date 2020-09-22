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

from emhub.data import DataManager
from emhub.data.imports import TestDataBase


class TestData(TestDataBase):
    """ Class to create a testing dataset for a given DataManager.
    """
    def _populateUsers(self, dm):
        # Create user table
        usersData = [
            # dev (D)
            ('Don Stairs', 'admin', None),  # 1

            # admin (A)
            ('Anna Mull', 'admin,manager,head', None),   # 2
            ('Arty Ficial', 'admin', None),  # 3

            # managers (M)
            ('Monty Carlo', 'manager', None),  # 4
            ('Moe Fugga', 'manager', None),  # 5

            # pi (P)
            ('Polly Tech', 'pi', None),  # 6
            ('Petey Cruiser', 'pi', None),  # 7
            ('Pat Agonia', 'pi', None),  # 8
            ('Paul Molive', 'pi', None),  # 9
            ('Pat Ernity', 'pi', None),  # 10

            # users (R, S)
            ('Ray Cyst', 'user', 7),  # 11
            ('Rick Shaw', 'user', 7),  # 12
            ('Rachel Slurs', 'user', 7),  # 13
            ('Reggie Stration', 'user', 8),  # 14
            ('Reuben Sandwich', 'user', 8),  # 15
            ('Sara Bellum', 'user', 8),  # 16
            ('Sam Owen', 'user', 8),  # 17
            ('Sam Buca', 'user', 10),  # 18
            ('Sarah Yevo', 'user', 10),  # 19
            ('Sven Gineer', 'user', 10),  # 20
            ('Sharon Needles', 'user', 10),  # 21
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

    def _populateApplications(self, dm):
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
             'status': 'closed'
             },
            {'title': 'Single Particle Application 161026',
             'description': 'Information required to request time for one year.',
             'status': 'rejected',
             },
            {'title': 'Internal Users Template',
             'description': 'This is a special template used for internal users. ',
             'status': 'rejected',
             },
        ]

        templates = [dm.create_template(**ti) for ti in templateInfo]

        applications = [
            {'code': 'CEM00297',
             'alias': 'BAG Lund',
             'status': 'active',
             'title': 'Bag Application for Lund University 2019/20',
             'creator_id': 7,
             'template_id': templates[0].id,
             'invoice_reference': 'AAA',
             'invoice_address': '',
             'resource_allocation': {'quota': {'talos': 10, 'krios': 5},
                                     'noslot': []},
             'description': "Current application BAG for Lund University."
             },
            {'code': 'CEM00315',
             'alias': 'BAG SU',
             'status': 'active',
             'title': 'Bag Application for Stockholm University',
             'description': '',
             'creator_id': 8,
             'template_id': templates[0].id,
             'invoice_reference': 'BBB',
             'invoice_address': '',
             'resource_allocation': {'quota': {'talos': 10, 'krios': 5},
                                     'noslot': []}
             },
            {'code': 'CEM00332',
             'alias': 'RAA Andersson',
             'status': 'active',
             'title': 'Rapid Access application',
             'description': '',
             'creator_id': 9,
             'template_id': templates[1].id,
             'invoice_reference': 'ZZZ',
             'invoice_address': '',
             'resource_allocation': {'quota': {'talos': 2, 'krios': 1},
                                     'noslot': []}
             },
            {'code': 'DBB00001',
             'alias': 'SU-DBB',
             'status': 'active',
             'title': 'Internal DBB project',
             'description': '',
             'creator_id': 10,
             'template_id': templates[-1].id,
             'invoice_reference': 'DDD',
             'invoice_address': '',
             'resource_allocation': {'quota': {},
                                     'noslot': [1, 2]}
             },
            {'code': 'CEM00345',
             'alias': 'BAG GU',
             'status': 'review',
             'title': 'Bag Application for Gothenberg University',
             'description': '',
             'creator_id': 8,
             'template_id': templates[0].id,
             'invoice_reference': 'BBB',
             'invoice_address': '',
             'resource_allocation': {'quota': {'talos': 10, 'krios': 5},
                                     'noslot': []}
             },
            {'code': 'CEM00346',
             'alias': 'BAG SU 2021',
             'status': 'review',
             'title': 'Bag Application for Stockholm University 2021',
             'description': '',
             'creator_id': 8,
             'template_id': templates[0].id,
             'invoice_reference': 'BBB',
             'invoice_address': '',
             'resource_allocation': {'quota': {'talos': 10, 'krios': 5},
                                     'noslot': []}
             },
        ]

        for pDict in applications:
            dm.create_application(**pDict)

        def __addPi(appCode, piUser):
            a1 = dm.get_application_by(code=appCode)
            u1 = dm.get_user_by(username=piUser)
            a1.users.append(u1)

        __addPi('DBB00001', 'agonia')
        __addPi('CEM00315', 'ernity')

        dm.commit()

    def _populateBookings(self, dm):
        now = dm.now().replace(minute=0, second=0)
        month = now.month

        # Create a downtime from today to one week later
        dm.create_booking(title='First Booking',
                          start=now.replace(day=21),
                          end=now.replace(day=28),
                          type='downtime',
                          resource_id=1,
                          creator_id=2,  # first user for now
                          owner_id=2,  # first user for now
                          description="Some downtime for some problem")

        # Create a booking at the downtime from today to one week later
        dm.create_booking(title='Booking Krios 1',
                          start=now.replace(day=1, hour=9),
                          end=now.replace(day=2, hour=23, minute=59),
                          type='booking',
                          resource_id=1,
                          creator_id=3,  # first user for now
                          owner_id=12,  # first user for now
                          description="Krios 1 for user 2")

        # Create booking for normal user
        dm.create_booking(title='Booking Krios 2',
                          start=now.replace(day=4, hour=9),
                          end=now.replace(day=6, hour=23, minute=59),
                          type='booking',
                          resource_id=2,
                          creator_id=11,  # first user for now
                          owner_id=11,  # first user for now
                          description="Krios 1 for user 10")

        # Create a booking at the downtime from today to one week later
        dm.create_booking(title='Booking Krios 1',
                          start=now.replace(day=2, hour=9),
                          end=now.replace(day=3, hour=23, minute=59),
                          type='booking',
                          resource_id=2,
                          creator_id=2,  # first user for now
                          owner_id=16,  # Sara Belum
                          description="Krios 2 for user 3")

        # Create a booking at the downtime from today to one week later
        dm.create_booking(title='Slot 1: BAGs',
                          start=now.replace(day=6, hour=9),
                          end=now.replace(day=10, hour=23, minute=59),
                          type='slot',
                          slot_auth={'applications': ['CEM00297', 'CEM00315']},
                          resource_id=3,
                          creator_id=2,  # first user for now
                          owner_id=2,  # first user for now
                          description="Talos slot for National BAGs")

        dm.create_booking(title='Slot 2: RAPID',
                          start=now.replace(day=20, hour=9),
                          end=now.replace(day=24, hour=23, minute=59),
                          type='slot',
                          slot_auth={'applications': ['CEM00332']},
                          resource_id=3,
                          creator_id=2,  # first user for now
                          owner_id=2,  # first user for now
                          description="Talos slot for RAPID applications")

        # create a repeating event
        dm.create_booking(title='Dropin',
                          start=now.replace(day=6, hour=9),
                          end=now.replace(day=6, hour=13),
                          type='slot',
                          repeat_value='bi-weekly',
                          repeat_stop=now.replace(month=month+2),
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