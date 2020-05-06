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
import json
from glob import glob


import flask
import flask_login

from emhub.utils import datetime_from_isoformat, datetime_to_isoformat


class DataContent:
    """ This class acts as an intermediary between the DataManager and
    the Flask application.

    Here information is retrieved from the DataManager (dealing with stored
    data structure) and prepare the "content" for required views.
    """
    def __init__(self, app):
        """ Create a new content for the given Flask application. """
        self.app = app

    def get(self, content_id, session_id):
        get_func_name = 'get_%s' % content_id.replace('-', '_')
        get_func = getattr(self, get_func_name, None)
        return {} if get_func is None else get_func(session_id)

    def get_sessions_overview(self, session_id=None):
        # sessions = self.app.dm.get_sessions(condition='status!="Finished"',
        #                                orderBy='microscope')
        sessions = self.app.dm.get_sessions()  # FIXME
        return {'sessions': sessions}

    def get_session_live(self, session_id):
        session = self.app.dm.load_session(session_id)
        firstSetId = session.data.get_sets()[0]['id']
        mics = session.data.get_items(firstSetId, ['location', 'ctfDefocus'])
        defocusList = [m.ctfDefocus for m in mics]
        sample = ['Defocus'] + defocusList

        bar1 = {'label': 'CTF Defocus',
                'data': defocusList}

        return {'sample': sample,
                'bar1': bar1,
                'micrographs': mics,
                'session': session}

    def get_sessions_stats(self, session_id=None):
        sessions = self.app.dm.get_sessions()
        return {'sessions': sessions}

    def get_users_list(self, session_id):
        users = self.app.dm.get_users()
        for u in users:
            u.project_codes = [p.code for p in self.app.dm.get_user_projects(u)]

        return {'users': users}

    def get_resources_list(self, session_id):

        resource_list = [
            {'id': r.id,
             'name': r.name,
             'tags': r.tags,
             'booking_auth': r.booking_auth,
             'color': r.color,
             'image': flask.url_for('static', filename='images/%s' % r.image),
             'is_user_auth': self.app.dm.is_user_auth(self.app.user, r.booking_auth)
             }
            for r in self.app.dm.get_resources()
        ]
        return {'resources': resource_list}

    def get_booking_calendar(self, session_id):
        dataDict = self.get_resources_list(session_id)
        dataDict['bookings'] = [self.booking_to_event(b)
                                for b in self.app.dm.get_bookings() if b.resource is not None]
        dataDict['current_user_json'] = flask_login.current_user.json()

        return dataDict

    def get_booking_list(self, session_id):
        bookings = self.app.dm.get_bookings()
        dm = self.app.dm

        for b in bookings:
            b.is_user_auth = dm.is_user_auth(self.app.user, b.slot_auth)

        return {'bookings': bookings}

    def get_projects_list(self, session_id):
        return {
            'projects': self.app.dm.get_projects()
        }

    def booking_to_event(self, booking):
        """ Return a dict that can be used as calendar Event object. """
        resource = booking.resource
        owner = booking.owner
        user = self.app.user
        b_title = booking.title
        is_user_auth = False

        if booking.type == 'downtime':
            color = 'red'
            title = "%s (DOWNTIME): %s" % (resource.name, b_title)
        elif booking.type == 'slot':
            color = '#619e3e'
            title = "%s (SLOT): %s" % (resource.name, b_title)
            is_user_auth = self.app.dm.is_user_auth(user, booking.slot_auth)
        else:
            color = resource.color
            # Show all booking information in title in some cases only
            if user.is_manager or user.same_pi(owner):
                title = "%s (%s) %s" % (resource.name, owner.name, b_title)
            else:
                title = "Booking"

        return {
            'id': booking.id,
            'title': title,
            'description': booking.description,
            'start': datetime_to_isoformat(booking.start),
            'end': datetime_to_isoformat(booking.end),
            'color': color,
            'textColor': 'white',
            'resource': {'id': resource.id,
                         'name': resource.name},
            'owner': {'id': owner.id, 'name': owner.name},
            'type': booking.type,
            'booking_title': b_title,
            'is_user_auth': is_user_auth,
            'slot_auth': booking.slot_auth,
            'repeat_id': booking.repeat_id,
            'repeat_value': booking.repeat_value
        }
