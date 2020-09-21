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
import json

import flask
import flask_login

from emhub.utils import pretty_datetime, datetime_to_isoformat


class DataContent:
    """ This class acts as an intermediary between the DataManager and
    the Flask application.

    Here information is retrieved from the DataManager (dealing with stored
    data structure) and prepare the "content" for required views.
    """
    def __init__(self, app):
        """ Create a new content for the given Flask application. """
        self.app = app

    def _dateStr(self, datetime):
        return

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

        for b in self.app.dm.get_bookings(orderBy='start'):
            if not user.is_manager and not user.same_pi(b.owner):
                continue
            bDict = {'owner': b.owner.name,
                     'resource': b.resource.name,
                     'start': pretty_datetime(b.start),
                     'end': pretty_datetime(b.end),
                     }
            if b.start <= now <= b.end:
                i = 0
            elif now <= b.start <= next7:
                i = 1
            elif now <= b.start <= next30:
                i = 2
            else:
                i = -1

            if i >= 0:
                bookings[i][1].append(bDict)

        dataDict['bookings'] = bookings

        if user.is_manager:
            dataDict['lab_members'] = [u.json() for u in self._get_facility_staff()]
        else:
            dataDict['lab_members'] = [u.json() for u in user.get_pi().get_lab_members()]

        return dataDict

    def get_sessions_overview(self, **kwargs):
        sessions = self.app.dm.get_sessions(condition=self._get_display_condition(),
                                            orderBy='resource_id')
        return {'sessions': sessions}

    def get_session_live(self, **kwargs):
        session_id = kwargs['session_id']
        session = self.app.dm.load_session(session_id)
        firstSetId = session.data.get_sets()[0]['id']
        mics = session.data.get_items(firstSetId, ['location', 'ctfDefocus'])
        session.data.close()
        defocusList = [m.ctfDefocus for m in mics]
        resolutionList = []  # m.ctfResolution for m in mics]
        sample = ['Defocus'] + defocusList

        bar1 = {'label': 'CTF Defocus',
                'data': defocusList}

        bar2 = {'label': 'CTF Resolution',
                'data': resolutionList}

        return {'sample': sample,
                'bar1': bar1,
                'bar2': bar2,
                'micrographs': mics,
                'session': session}

    def get_users_list(self, **kwargs):
        users = self.app.dm.get_users()
        for u in users:
            u.image = self.user_profile_image(u)
            u.project_codes = [p.code for p in u.get_applications()]

        return {'users': users}

    def get_user_form(self, **kwargs):
        user = self.app.dm.get_user_by(id=kwargs['user_id'])
        user.image = self.user_profile_image(user)

        return {'user': user}

    def get_resources_list(self, **kwargs):

        resource_list = [
            {'id': r.id,
             'name': r.name,
             'status': r.status,
             'tags': r.tags,
             'requires_slot': r.requires_slot,
             'latest_cancellation': r.latest_cancellation,
             'color': r.color,
             'image': flask.url_for('images.static', filename=r.image),
             'user_can_book': self.app.user.can_book_resource(r),
             'is_microscope': r.is_microscope,
             'min_booking': r.min_booking,
             'max_booking': r.max_booking
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
        dataDict['applications'] = [{'id': a.id,
                                     'code': a.code,
                                     'alias': a.alias}
                                    for a in dm.get_applications()
                                    if a.is_active]

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
            piSet = {user.get_id()}
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
                lab = [_userjson(u)] + [_userjson(u2) for u2 in u.get_lab_members()]
                labs.append(lab)

        if user.is_manager:
            labs.append([_userjson(u) for u in self._get_facility_staff()])

        dataDict['possible_owners'] = labs
        dataDict['resource_id'] = kwargs.get('resource_id', None)
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
        user = self.app.user

        if user.is_manager:
            applications = self.app.dm.get_applications()
        else:
            applications = user.get_applications(status='all')

        return {'applications': applications}

    def get_application_form(self, **kwargs):
        app = self.app.dm.get_application_by(id=kwargs['application_id'])
        mics = [{'id': r.id,
                 'name': r.name,
                 'noslot': app.no_slot(r.id),
                 } for r in self.app.dm.get_resources() if r.is_microscope]
        return {'application': app,
                'microscopes': mics}

    def get_dynamic_form(self, **kwargs):
        form_id = int(kwargs.get('form_id', 1))
        form_values_str = kwargs.get('form_values', None) or '{}'
        form_values = json.loads(form_values_str)

        form = self.app.dm.get_form_by(id=form_id)

        if form is None:
            raise Exception("Invalid form id: %s" % form_id)

        definition = form.definition

        def set_value(p):
            if 'id' not in p:
                return
            p['value'] = form_values.get(p['id'], p.get('default', ''))

        if 'params' in definition:
            for p in definition['params']:
                set_value(p)
        else:
            for section in definition['sections']:
                for p in section['params']:
                    set_value(p)

        return {'form': form}

    def get_forms_list(self, **kwargs):
        return  {'forms': self.app.dm.get_forms()}

    def get_logs(self, **kwargs):
        logs = self.app.dm.get_logs()
        logs.sort(key=lambda o: o.id, reverse=True)
        return  {'logs': logs}

    def get_pages(self, **kwargs):
        page_id = kwargs['page_id']
        page_path = os.path.join(self.app.config['PAGES'], '%s.md' % page_id)

        # with open(page_path) as f:
        #     page = f.read()

        return {
            'page_id': page_id,
            'page': 'pages/%s.md' % page_id
        }

    # --------------------- Internal  helper methods ---------------------------
    def booking_to_event(self, booking):
        """ Return a dict that can be used as calendar Event object. """
        resource = booking.resource
        # Bookings should have resources, just in case an erroneous one
        if resource is None:
            resource_info = {'id': None, 'name': ''}
        else:
            resource_info = {'id': resource.id, 'name': resource.name,
                             'is_microscope': resource.is_microscope
                             }
        owner = booking.owner
        owner_name = owner.name
        creator = booking.creator
        application = booking.application
        user = self.app.user
        b_title = booking.title
        b_description = booking.description

        user_can_book = False
        # Define which users are allowed to modify the booking
        # - managers
        # - application creators
        # - the owner and pi of the owner
        can_modify_list = [owner.id]
        if application is not None:
            can_modify_list.append(application.creator.id)
        if owner.pi is not None:
            can_modify_list.append(owner.pi.id)

        user_can_modify = user.is_manager or user.id in can_modify_list
        user_can_view = user_can_modify or user.same_pi(owner)
        color = resource.color if resource else 'grey'

        if booking.type == 'downtime':
            color = 'red'
            title = "%s (DOWNTIME): %s" % (resource.name, b_title)
        elif booking.type == 'slot':
            color = color.replace('1.0', '0.5')  # transparency for slots
            title = "%s (SLOT): %s" % (resource.name,
                                       booking.slot_auth.get('applications', ''))
            user_can_book = user.can_book_slot(booking)
        else:

            # Show all booking information in title in some cases only
            if user_can_view:
                appStr = '' if application is None else ', %s' % application.code
                extra = "%s%s" % (owner.name, appStr)
                title = "%s (%s) %s" % (resource_info['name'], extra, b_title)
            else:
                title = "%s Booking" % resource.name
                owner_name = "Hidden owner"
                b_title = "Hidden title"
                b_description = "Hidden description"

        return {
            'id': booking.id,
            'title': title,
            'description': b_description,
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
            'days': booking.days,
            'experiment': booking.experiment
        }

    def user_profile_image(self, user):
        if getattr(user, 'profile_image', None):
            return flask.url_for('images.user_profile', user_id=user.id)
        else:
            return flask.url_for('images.static', filename='user-icon.png')

    def _get_facility_staff(self):
        """ Return the list of facility personnel.
        First users in the list should  be the facility Head.
        """
        staff = []

        for u in self.app.dm.get_users():
            if u.is_manager:
                if 'head' in u.roles:
                    staff.insert(0, u)
                else:
                    staff.append(u)

        return staff

    def _get_display_condition(self):
        """ Compose condition str for the get_sessions query.
        Depending on the user role we show specific sessions only.
        """
        user = self.app.user

        if user.is_manager:
            return None

        condition = 'operator_id == %s' % user.get_id()
        lab_members = user.get_lab_members()
        if user.is_pi and len(lab_members):
            membersId = ",".join(u.get_id() for u in lab_members)
            condition = "operator_id IN (%s)" % membersId

        return condition
