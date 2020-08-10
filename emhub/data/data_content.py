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
import datetime as dt


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

    def get(self, **kwargs):
        content_id = kwargs['content_id']
        get_func_name = 'get_%s' % content_id.replace('-', '_')  # FIXME
        get_func = getattr(self, get_func_name, None)
        return {} if get_func is None else get_func(**kwargs)

    def get_dashboard(self, **kwargs):
        dataDict = self.get_resources_list()
        user = self.app.user  # shortcut

        # Provide upcoming bookings sorted by proximity
        bookings = [('Today', []),
                    ('Next 7 days', []),
                    ('Next 30 days', [])]

        now  = self.app.dm.now()
        next7 = now + dt.timedelta(days=7)
        next30 = now + dt.timedelta(days=30)

        for b in self.app.dm.get_bookings():
            bDict = {'owner': b.owner.name,
                     'resource': b.resource.name,
                     'start': b.start.strftime("%d/%m/%Y %I:%M %p"),
                     'end': b.end.strftime("%d/%m/%Y %I:%M %p"),
                     }
            if b.start <= now <= b.end:
                i = 0
            elif b.start <= now and b.end <= next7:
                i = 1
            elif b.start <= now and b.end <= next30:
                i = 2
            else:
                i = -1

            if i >= 0:
                bookings[i][1].append(bDict)

        dataDict['bookings'] = bookings

        if user.is_manager:
            dataDict['lab_members'] = [u.json() for u in self.app.dm.get_users()
                                       if u.is_manager]
        else:
            dataDict['lab_members'] = [u.json() for u in user.get_pi().lab_members]

        return dataDict

    def get_sessions_overview(self, **kwargs):
        # sessions = self.app.dm.get_sessions(condition='status!="Finished"',
        #                                orderBy='microscope')
        sessions = self.app.dm.get_sessions()  # FIXME
        return {'sessions': sessions}

    def get_session_live(self, **kwargs):
        session_id = kwargs['session_id']
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

    def get_sessions_stats(self, **kwargs):
        sessions = self.app.dm.get_sessions()
        return {'sessions': sessions}

    def get_users_list(self, **kwargs):
        users = self.app.dm.get_users()
        for u in users:
            u.project_codes = [p.code for p in u.get_applications()]

        return {'users': users}

    def get_resources_list(self, **kwargs):

        resource_list = [
            {'id': r.id,
             'name': r.name,
             'tags': r.tags,
             'requires_slot': r.requires_slot,
             'latest_cancellation': r.latest_cancellation,
             'color': r.color,
             'image': flask.url_for('static', filename='images/%s' % r.image),
             'user_can_book': self.app.dm.user_can_book(self.app.user, r),
             'microscope': 'microscope' in r.tags
             }
            for r in self.app.dm.get_resources()
        ]
        return {'resources': resource_list}

    def get_booking_calendar(self, **kwargs):
        dm = self.app.dm  # shortcut
        dataDict = self.get_resources_list()
        dataDict['bookings'] = [self.booking_to_event(b)
                                for b in dm.get_bookings()
                                if b.resource is not None]
        dataDict['current_user_json'] = flask_login.current_user.json()
        dataDict['projects'] = [{'id': p.id, 'code': p.code}
                                for p in dm.get_applications()]

        # Send a list of possible owners of bookings
        # 1) Managers or admins can change the ownership to any user
        # 2) Application managers can change the ownership to any user in their
        #    application
        # 3) Other users can not change the ownership
        user = self.app.user  # shortcut
        if user.is_manager:
            piList = [u for u in dm.get_users() if u.is_pi]
        elif user.is_application_manager:
            apps = [a for a in user.created_applications if a.is_active]
            piSet = set([user.get_id()])
            piList = [user]
            for a in apps:
                for pi in a.users:
                    if pi.get_id() not in piSet:
                        piList.append(pi)
        elif user.is_pi:
            piList = [user]
        else:
            piList = []

        def _userjson(u):
            return {'id': u.id, 'name': u.name}

        # Group users by PI
        labs = []
        for u in piList:
            if u.is_pi:
                lab = [_userjson(u)] + [_userjson(u2) for u2 in u.lab_members]
                labs.append(lab)

        dataDict['possible_owners'] = labs
        return dataDict

    def get_booking_list(self, **kwargs):
        bookings = self.app.dm.get_bookings()
        return {'bookings': [self.booking_to_event(b) for b in bookings]}

    def get_applications(self, **kwargs):
        dataDict = self.get_applications_list()
        dataDict['template_statuses'] = ['preparation', 'active', 'closed']
        dataDict['template_selected_status'] = kwargs.get('template_selected_status', 'active')
        dataDict['templates'] = [{'id': t.id,
                                  'title': t.title,
                                  'description': t.description,
                                  'status': t.status
                                 }
                                 for t in self.app.dm.get_templates()]

        return dataDict

    def get_applications_list(self, **kwargs):
        if 'content_id' in kwargs:
            del kwargs['content_id']

        return {'applications': self.app.dm.get_applications()}

    def get_application_form(self, **kwargs):
        return {'application': self.app.dm.get_application_by(id=kwargs['application_id'])}

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
        application = booking.application
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
                                       booking.slot_auth.get('applications', ''))
            user_can_book = self.app.dm.user_can_book(user, booking.resource)
        else:

            # Show all booking information in title in some cases only
            if user_can_view:
                appStr = '' if application is None else ', %s' %  application.code
                extra = "%s%s" % (owner.name, appStr)
                title = "%s (%s) %s" % (resource_info['name'], extra, b_title)
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
            'repeat_value': booking.repeat_value,
            'days': booking.days
        }
