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

import datetime as dt


class TestDataBase:
    """ Base class to create a dataset for a given DataManager.
    """

    TZ_DELTA = 0  # Define timezone, UTC '0'
    tzinfo = dt.timezone(dt.timedelta(hours=TZ_DELTA))

    def __init__(self, dm):
        """
        Args:
            dm: DataManager with db to create test data
        """
        dm.create_admin()
        self._populateTestData(dm)

    def _populateTestData(self, dm):
        # Create tables with test data for each database model
        print("Populating forms...")
        self._populateForms(dm)
        print("Populating users...")
        self._populateUsers(dm)
        print("Populating resources...")
        self._populateResources(dm)
        print("Populating applications...")
        self._populateApplications(dm)
        print("Populating bookings...")
        self._populateBookings(dm)
        print("Populating sessions...")
        self._populateSessions(dm)

    def _populateForms(self, dm):
        form1 = {
            'title': 'Sample Form',
            'params': [
                {'id': 'name',
                 'label': 'Name',
                 },
                {'id': 'phone',
                 'default': '88546756777',
                 'label': 'Phone',
                 },
                {'id': 'show-phone',
                 'label': 'Show phone?',
                 'type': 'bool'
                 },
                {'id': 'about',
                 'label': 'About everything that you need',
                 'type': 'text'
                 },
                {'label': 'Options'},
                {'id': 'level',
                 'label': 'Level',
                 'enum': {'choices': ['low', 'medium', 'high'],
                          'display': 'combo'
                          }
                 },
                {'id': 'pet',
                 'label': 'Pet',
                 'enum': {'choices': ['cat', 'dog', 'horse', 'monkey'],
                          'display': 'radio'
                          }
                 },
        ]}

        dm.create_form(name='sample',
                       definition=form1)

        form2 = {
            'title': 'Experiment',
            'sections': [
                {'label': 'Basic',
                 'params': [
                     {'id': 'grid_prep_needed',
                      'label': 'Grids preparation needed?',
                      'type': 'bool'
                      },
                     {'id': 'grid_ready_screen',
                      'label': 'Grids ready to be screened?',
                      'type': 'bool'
                      },
                     {'id': 'data_collection',
                      'label': 'Data collection?',
                      'type': 'bool'
                      },
                     {'id': 'grid_clipped',
                      'label': 'Are grids clipped?',
                      'type': 'bool'
                      },
                     {'id': 'grid_type',
                      'label': 'Grid type',
                      },
                 ]},
                {'label': 'Grid Location',
                 'params': [
                     {'id': 'dewar_number',
                      'label': 'Dewar number',
                      },
                     {'id': 'cane_number',
                      'label': 'Cane number',
                      },
                     {'id': 'puck_number',
                      'label': 'Puck number (color/name)',
                      },
                     {'id': 'gridbox_number',
                      'label': 'Grid box number',
                      },
                     {'id': 'gridbox_label',
                      'label': 'Grid box label',
                      },
                     {'id': 'slot_numbers',
                      'label': ' Slot numbers',
                      },
                 ]},
                {'label': 'Detector',
                 'params': [
                     {'id': 'detector_mode',
                      'label': 'Detector mode',
                      'enum': {'choices': ['linear', 'counting'],
                               'display': 'radio'
                               }
                      },
                     {'id': 'pixel_size',
                      'label': 'Pixel Size (Å)',
                      },
                     {'id': 'dose_rate',
                      'label': 'Dose Rate (e/px/s)',
                      },
                     {'id': 'total_dose',
                      'label': 'Total dose (e/Å2)',
                      },
                     {'id': 'defocuses',
                      'label': 'Defocuses (um)',
                      },
                 ]},
                {'label': 'Other',
                 'params': [
                     {'id': 'screening_instructions',
                      'help': '(for instance protein concentration, blotting '
                              'time and other useful info)',
                      'label': 'Screening instructions',
                      'type': 'text'
                      },
                     {'id': 'sample_information',
                      'help': '(Mw, Dimensions (Å), multimerisation state, etc.)',
                      'label': 'Sample Information',
                      'type': 'text'
                      },
                     {'id': 'aim_experiment',
                      'label': 'Aim of experiment',
                      'type': 'text'
                      },
                 ]},
            ]
        }

        dm.create_form(name='experiment',
                       definition=form2)

    def _populateUsers(self, dm):
        pass

    def _populateResources(self, dm):
        resources = [
            {'name': 'Solna Krios α', 'tags': 'microscope krios solna',
             'image': 'titan-krios.png', 'color': 'rgba(58, 186, 232, 1.0)',
             'extra': {'latest_cancellation': 48,
                       'requires_slot': True,
                       'min_booking': 8,
                       'max_booking': 72}},
            {'name': 'Solna Krios β', 'tags': 'microscope krios solna',
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

        for rDict in resources:
            dm.create_resource(**rDict)

    def _populateApplications(self, dm):
        pass

    def _populateBookings(self, dm):
        pass

    def _populateSessions(self, dm):
        pass

    def _datetime(self, *args):
        return dt.datetime(*args, tzinfo=self.tzinfo)
