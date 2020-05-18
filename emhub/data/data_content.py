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
            u.project_codes = [p.code for p in self.app.dm.get_user_applications(u)]

        return {'users': users}

    def get_resources_list(self, session_id):

        resource_list = [
            {'id': r.id,
             'name': r.name,
             'tags': r.tags,
             'booking_auth': r.booking_auth,
             'color': r.color,
             'image': flask.url_for('static', filename='images/%s' % r.image),
             'user_can_book': self.app.dm.user_can_book(self.app.user, r.booking_auth)
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
        return {'bookings': [self.booking_to_event(b) for b in bookings]}

    def get_applications_list(self, session_id):
        return {
            'applications': self.app.dm.get_applications()
        }

    def booking_to_event(self, booking):
        """ Return a dict that can be used as calendar Event object. """
        resource = booking.resource
        # Bookings should have resources, just in case an erroneous one
        if resource is None:
            resource_info = {'id': None, 'name': ''}
        else:
            resource_info = {'id': resource.id, 'name': resource.name}
        owner = booking.owner
        owner_name = owner.name
        creator = booking.creator
        user = self.app.user
        b_title = booking.title
        user_can_book = False
        user_can_modify = user.is_manager or user.id == owner.id
        user_can_view = user_can_modify or user.same_pi(owner)
        color = resource.color if resource else 'grey'

        if booking.type == 'downtime':
            color = 'red'
            title = "%s (DOWNTIME): %s" % (resource.name, b_title)
        elif booking.type == 'slot':
            color = color.replace('1.0', '0.5')  # transparency for slots
            title = "%s (SLOT): %s" % (resource.name,
                                       booking.slot_auth['applications'])
            user_can_book = self.app.dm.user_can_book(user, booking.slot_auth)
        else:

            # Show all booking information in title in some cases only
            if user_can_view:
                title = "%s (%s) %s" % (resource_info['name'], owner.name, b_title)
            else:
                title = "Booking"
                owner_name = "Hidden"

        return {
            'id': booking.id,
            'title': title,
            'description': booking.description,
            'start': datetime_to_isoformat(booking.start),
            'end': datetime_to_isoformat(booking.end),
            'color': color,
            'textColor': 'white',
            'resource': resource_info,
            'creator': {'id': creator.id, 'name': creator.name},
            'owner': {'id': owner.id, 'name': owner_name},
            'type': booking.type,
            'booking_title': b_title,
            'user_can_book': user_can_book,
            'user_can_view': user_can_view,
            'user_can_modify': user_can_modify,
            'slot_auth': booking.slot_auth,
            'repeat_id': booking.repeat_id,
            'repeat_value': booking.repeat_value
        }
