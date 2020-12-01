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

from emhub.data import DataManager
from emhub.data.imports import TestDataBase


class TestData(TestDataBase):
    """ Class to create a testing dataset for a given DataManager.
    """
    def _populateUsers(self, dm):
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
             'creator': 'agonia',
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
             'creator': 'tech',
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
             'creator': 'ernity',
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
             'creator': 'tech',
             'template_id': templates[-1].id,
             'invoice_reference': 'DDD',
             'invoice_address': '',
             'resource_allocation': {'quota': {},
                                     'noslot': [1, 2]}
             },
            {'code': 'CEM00345',
             'alias': 'BAG Lund 2021',
             'status': 'review',
             'title': 'Bag Application for Lund University 2021',
             'description': '',
             'creator': 'agonia',
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
             'creator': 'tech',
             'template_id': templates[0].id,
             'invoice_reference': 'BBB',
             'invoice_address': '',
             'resource_allocation': {'quota': {'talos': 10, 'krios': 5},
                                     'noslot': []}
             },
        ]

        for pDict in applications:
            username = pDict.pop('creator')
            u = dm.get_user_by(username=username)
            pDict['creator_id'] = u.id
            dm.create_application(**pDict)

        def __addPi(appCode, piUser):
            a1 = dm.get_application_by(code=appCode)
            u1 = dm.get_user_by(username=piUser)
            a1.users.append(u1)

        for u in ['cruiser', 'agonia']:
            __addPi('DBB00001', u)

        for u in ['cruiser']:
            __addPi('CEM00315', u)

        for u in ['molive']:
            __addPi('CEM00297', 'ernity')

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