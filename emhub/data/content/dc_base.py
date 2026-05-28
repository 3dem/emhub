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

import copy
import os
import datetime as dt
import json
import sys
from collections import defaultdict
from glob import glob
from functools import wraps

import flask
import flask_login
from flask import current_app as app

from emhub.utils import (pretty_datetime, datetime_to_isoformat, pretty_date,
                         datetime_from_isoformat, get_quarter, pretty_quarter,
                         shortname)

from emtools.utils import Pretty, Timer
from emtools.image import Thumbnail
from emtools.metadata import Bins, TsBins, EPU


class DataContent:
    """ This class acts as an intermediary between the DataManager and
    the Flask application.

    Here information is retrieved from the DataManager (dealing with stored
    data structure) and prepare the "content" for required views.
    """

    def __init__(self):
        """ Create a new content for the given Flask application. """
        self.app = app
        self._contentDict = {}

    def _dateStr(self, datetime):
        return

    def get_content_func(self, name):
        return self._contentDict.get(name, getattr(self, name, None))

    def get_data(self, name, **kwargs):
        if get_func := self.get_content_func(name):
            return get_func(**kwargs)
        else:
            raise Exception(f"Missing content function for '{name}'")

    def get(self, **kwargs):
        content_id = kwargs['content_id']
        get_func_name = content_id.replace('-', '_')
        return self.get_data(get_func_name, **kwargs)

    def content(self, func):
        self._contentDict[func.__name__] = func
        # No need for a do-nothing wrapper
        return func

    def get_lab_members(self, user):
        # FIXME: Check how we want to display units/teams or staff members
        # unit = user.staff_unit
        # if user.is_staff(unit):
        #     return [u.json() for u in self._get_facility_staff(unit)]

        pi = user.get_pi()
        if pi is None:
            return []
        members = [u.json() for u in pi.get_lab_members()]
        members.insert(0, pi.json())
        return members

    def set_form_values(self, form, values):
        """ Load values to form parameters based on the ids.
        """
        definition = form.definition
        values = values or {}  # Stored None in some booking.experiment

        def set_value(p):
            if 'id' not in p:
                return
            p['value'] = values.get(p['id'], p.get('default', ''))

        if 'params' in definition:
            for p in definition['params']:
                set_value(p)
        else:
            for section in definition['sections']:
                for p in section['params']:
                    set_value(p)

    def load_form_content(self, form, data):
        """ Forms can define several 'content' to be loaded when
        rendering the form and its components.
        """
        if 'content' in form.definition:
            for contentFunc in form.definition['content']:
                data.update(self.get(content_id=contentFunc['func'],
                                     **contentFunc.get('kwargs', {})))

    def dynamic_form(self, form, **kwargs):
        form_values = kwargs.get('form_values', None) or {}
        if isinstance(form_values, str):
            form_values = json.loads(form_values)
        self.set_form_values(form, form_values)
        data = {'form': form,
                'definition': form.definition}
        self.load_form_content(form, data)
        return data

    def get_period(self, kwargs):
        """ Helper function to update period in kwargs if not present. """
        dm = self.app.dm  # shortcut
        period = None
        period_id = kwargs.get('period', None)

        if period_id is None:
            for p in dm.get_invoice_periods():
                if p.status == 'active':
                    period = p
        else:
            period = dm.get_invoice_period_by(id=int(period_id))

        kwargs['start'] = pretty_date(period.start)
        kwargs['end'] = pretty_date(period.end)

        return period

    def get_pi_user(self, kwargs):
        """ Helper function to get pi user. """
        u = self.app.user
        pi_id_value = kwargs.get('pi_id', u.id)
        bag_visible = kwargs.get('bag_visible', True)

        try:
            pi_id = int(pi_id_value)

        except Exception:
            raise Exception("Provide a valid integer id.")

        pi_user = self.app.dm.get_user_by(id=pi_id)
        if pi_user is None:
            raise Exception("Invalid user id: %s" % pi_id)

        def _has_access():
            if u.is_manager:
                return True

            if not u.is_pi:
                return False

            # When bag_visible is False, only the own PI can bee seen
            if not bag_visible and u.id != pi_user.id:
                return False

            pi_apps = set(a.id for a in pi_user.get_applications())
            u_apps = set(a.id for a in u.get_applications())

            return bool(pi_apps.intersection(u_apps))

        if not _has_access():
            raise Exception("You do not have access to this information. u.is_pi: %s" % u.is_pi)

        return pi_user

    def booking_to_event(self, booking, **kwargs):
        """ Return a dict that can be used as calendar Event object. """
        resource = booking.resource
        # Bookings should have resources, just in case an erroneous one
        if resource is None:
            resource = self.app.dm.Resource(
                name='Error: MISSING',
                status='inactive',
                tags='',
                image='',
                color='rgba(256, 256, 256, 1.0)',
                extra={})

        owner = booking.owner
        operator = booking.operator  # shortcut
        creator = booking.creator
        a = booking.application
        user = self.app.user
        dm = self.app.dm
        b_title = booking.title
        b_description = booking.description

        user_can_book = False
        # Define which users are allowed to modify the booking
        # - managers
        # - application creators
        # - the owner and pi of the owner
        can_modify_list = [owner.id] if owner else []

        if a is not None:
            can_modify_list.append(a.creator.id)

        if user.is_manager and (a is None or a.allows_access(user)):
            can_modify_list.append(user.id)

        pi = owner.get_pi() if owner else None
        if pi is not None:
            can_modify_list.append(pi.id)

        user_can_modify = user.id in can_modify_list
        user_can_view = user_can_modify or user.same_pi(owner)
        color = resource.color if resource else 'grey'

        application_label = 'None'

        types_colors = {
            'downtime': 'rgba(181,4,0,1.0)',
            'cryo-cycle': 'rgb(255,213,128,1.0)',
            'maintenance': 'rgba(255,107,53,1.0)',
            'repair': 'rgba(255,75,51,1.0)',
            'training': '#702963',
            'special': 'rgba(98,50,45,1.0)'
        }

        if booking.type in types_colors:
            color = types_colors[booking.type]
            title = f"{resource.name} ({booking.type.upper()}): {b_title}"
        elif booking.type == 'slot':
            color = color.replace('1.0', '0.5')  # transparency for slots
            title = "%s (SLOT): %s" % (resource.name,
                                       booking.slot_auth.get('applications', ''))
            user_can_book = user.can_book_slot(booking)
        else:
            # Show all booking information in title in some cases only
            display = dm.get_config('bookings')['display']
            emptyApp = a is None or not display['show_application']
            appStr = '' if emptyApp else ', %s' % a.code
            emptyPi = (owner is None or owner.is_manager or owner.is_pi or
                       pi is None or not display.get('show_pi', False))
            piStr = '' if emptyPi else shortname(pi) + '/'
            emptyOp = operator is None or not display.get('show_operator', False)
            opStr = '' if emptyOp else ' -> ' + shortname(operator)

            extra = "%s%s%s%s" % (piStr, shortname(owner), appStr, opStr)
            if user_can_view:
                title = "%s (%s) %s" % (resource.name, extra, b_title)
                if a:
                    application_label = a.code
                    if a.alias:
                        application_label += "  (%s)" % a.alias
            else:
                title = "%s (%s)" % (resource.name, extra)
                b_title = "Hidden title"
                b_description = "Hidden description"

        bd = {
            'id': booking.id,
            'title': title,
            'resource': {'id': resource.id},
            'start': datetime_to_isoformat(booking.start),
            'end': datetime_to_isoformat(booking.end),
            'color': color,
            'textColor': 'white',
            'booking_title': b_title,
            'type': booking.type
        }

        if kwargs.get('prettyDate', False):
            bd['pretty_start'] = pretty_datetime(booking.start)
            bd['pretty_end'] = pretty_datetime(booking.end)

        if kwargs.get('piApp', False):
            if pi is not None:
                bd['pi_id'] = pi.id
                bd['pi_name'] = pi.name

            app = booking.application
            if app is not None:
                bd['app_id'] = app.id

        return bd

    def booking_from_entry(self, entry, scopes):
        """ Create a booking instance from an existing entry of type
        'microscope_access'
        """
        dm = self.app.dm  # shortcut

        if entry.type == 'access_microscopes':

            data = entry.extra['data']
            dstr = data.get('suggested_date', None)
            rid = int(data.get('microscope_id', 0))
            if dstr and rid:
                r = scopes[rid]
                days = data.get('days', '1')
                # When using 'default', we read the config in the entry form
                if days == 'default':
                    formDef = dm.get_form_definition('access_microscopes')
                    reqResources = formDef['config']['request_resources']
                    days = reqResources.get(r.name, {'days': '1'})['days']

                sdate = dm.date(dt.datetime.strptime(dstr, '%Y/%m/%d'))
                endDay = sdate + dt.timedelta(days=int(days) - 1)  # - 1
                p = entry.project

                edate = endDay.replace(hour=23, minute=59)
                return dm.Booking(
                    title='',
                    type='request',
                    start=sdate.replace(hour=9),
                    end=edate,
                    owner=p.user,
                    owner_id=p.user.id,
                    resource=r,
                    resource_id=rid,
                    project_id=p.id,
                    project=p,
                    extra={
                        'entry_id': entry.id
                    },
                    experiment={
                        'session_type': data.get('session_type', ''),
                        'bsl2': data.get('bsl2', False)
                    }
                )

    def booking_active_today(self, b):
        """ Return True if booking is active today. """
        dm = self.app.dm
        now = dm.now().date()
        # Allow users to create sessions during a grace time
        grace = dt.timedelta(hours=23)

        def _local(dt):
            return dm.dt_as_local(dt).date()

        return _local(b.start) <= now <= _local(b.end) or dm.now() - dm.dt_as_local(b.end) < grace

    def user_profile_image(self, user):
        if getattr(user, 'profile_image', None):
            return flask.url_for('images.user_profile', user_id=user.id)
        else:
            return flask.url_for('images.static', filename='user-icon.png')

    def get_users_list(self, **kwargs):
        status = kwargs.get('status', 'active')
        all_users = self.app.dm.get_users()
        users = []
        for u in all_users:
            if status == 'all' or u.status == status:
                u.image = self.user_profile_image(u)
                u.project_codes = [p.code for p in u.get_applications()]
                users.append(u)

        return {'users': users}

    def check_user_access(self, permissionKey):
        if not self.app.dm.check_user_access(permissionKey):
            raise Exception('Invalid access')

    def _get_facility_staff(self, unit):
        """ Return the list of facility personnel.
        First users in the list should  be the facility Head.
        """
        staff = []

        for u in self.app.dm.get_users():
            if u.is_staff(unit):
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

    def _get_users_from_portal(self, status=None):
        """ Retrieve users from Portal with a given status.
        If status is None, all will be retrieved.
        """
        dm = self.app.dm
        users = []

        for pu in self.app.sll_pm.fetchAccountsJson():
            user = dm.get_user_by(email=pu['email'])

            if user is None:
                invoiceRef = pu['invoice_ref']

                if pu['status'] == 'enabled':
                    pu['pi_user'] = None

                    if not pu['pi']:
                        pi = dm.get_user_by(email=invoiceRef)
                        if pi is None:
                            pu['status'] = 'error: Missing PI'
                        else:
                            pu['status'] = 'ready: user'
                            pu['pi_user'] = pi
                    else:
                        if invoiceRef.strip():
                            pu['status'] = 'ready: pi'
                        else:
                            pu['status'] = 'error: Missing Invoice Reference'

                    if status is None or pu['status'].startswith(status):
                        users.append(pu)

        return users

    def get_pi_labs(self, all=False):
        # Send a list of labs( used for possible owners of bookings or collaborators)
        # 1) Managers or admins can change the ownership to any user
        # 2) Application managers can change the ownership to any user in their
        #    application
        # 3) Other users can not change the ownership
        # If all = True, all labs will be returned
        user = self.app.user  # shortcut
        dm = self.app.dm

        if not user.is_authenticated:
            return []

        if user.is_manager or all:
            piList = [u for u in dm.get_users(condition='status="active"') if u.is_pi]
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

        # Group managers by staff units
        if user.is_manager:
            for unit in dm.get_staff_units():
                unit_members = [_userjson(u) for u in self._get_facility_staff(unit)]
                if unit_members:
                    labs.append(unit_members)

        return labs

    def get_possible_operators(self):
        dm = self.app.dm

        if self.app.user.is_authenticated and self.app.user.is_manager:
            return [{'id': u.id, 'name': u.name, 'roles': u.roles}
                    for u in dm.get_users() if 'manager' in u.roles]
        return []

    def get_booking_in_range(self, kwargs,
                             asJson=True, filter=None, bookingFunc=None):
        """ Return the list of bookings in the given time range.

         It will also attach PI information to each booking.
         This function is used from report functions.
         If 'start' and 'end' keys are not in kwargs, the current
         year quarter will be used for the range.

         Args:
             kwargs (dict): dict from where to read 'start' and 'end'
             asJson (bool): if True return json entries for each booking
             filter: function to filter bookings. If None, the non-slot bookings
                with non-zero cost resource will be used.
            bookingFunc: if asJson is True, function used to convert
                booking into a jsonDict. If it is none, booking_to_event is used.
        """

        if 'start' in kwargs and 'end' in kwargs:
            # d = request.json or request.form
            d = {'start': kwargs['start'], 'end': kwargs['end']}
        else:
            # If date range is not passed, let's use by default the
            # current quarter
            now = dt.datetime.now()
            qi = (now.month - 1) // 3
            start, end = [
                ('01/01', '03/31'),
                ('01/04', '06/30'),
                ('01/07', '09/30'),
                ('01/10', '12/31')
            ][qi]
            d = {'start': '%d/%s' % (now.year, start),
                 'end': '%d/%s' % (now.year, end)
                 }

        bookings = self.app.dm.get_bookings_range(
            datetime_from_isoformat(d['start'].replace('/', '-')),
            datetime_from_isoformat(d['end'].replace('/', '-'))
        )

        bookingFunc = bookingFunc or self.booking_to_event

        def process_booking(b):
            if not asJson:
                return b
            return bookingFunc(b, prettyDate=True, piApp=True)

        def _filter(b):
            return b.resource.daily_cost > 0 and not b.is_slot

        filterFunc = filter or _filter
        bookings = [process_booking(b) for b in bookings if filterFunc(b)]

        return bookings, d

    def get_resources(self, **kwargs):
        user = self.app.user
        dm = self.app.dm

        if not user.is_authenticated:
            return {'resources': []}

        all = kwargs.get('all', False)
        get_image = kwargs.get('image', False)
        # Return only one resource with that id
        resource_id = kwargs.get('resource_id', None)

        def _image(r):
            if not get_image or r.id is None:
                return None

            fn = dm.get_resource_image_path(r)
            if os.path.exists(fn):
                thumb = Thumbnail(output_format='base64', max_size=(128, 128))
                return 'data:image/%s;base64, ' + thumb.from_path(fn)
            else:
                return flask.url_for('images.static', filename=r.image)

        def _filter(r):
            return (all or r.is_active) and ((not resource_id) or r.id == int(resource_id))

        resource_list = [
            {'id': r.id,
             'name': r.name,
             'status': r.status,
             'tags': r.tags,
             'requires_slot': r.requires_slot,
             'latest_cancellation': r.latest_cancellation,
             'color': r.color,
             'image': _image(r),
             'user_can_book': dm.check_resource_access(r, 'create_booking'),
             'is_microscope': r.is_microscope,
             'is_active': r.is_active,
             'min_booking': r.min_booking,
             'max_booking': r.max_booking,
             'daily_cost': r.daily_cost
             }
            for r in dm.get_resources() if _filter(r)
        ]
        return {'resources': resource_list}


    @Timer.timeit
    def get_user_projects(self, user, **kwargs):
        dm = self.app.dm
        status = kwargs.get('status', 'active')
        extra = 'extra' in kwargs
        pid = int(kwargs.get('pid', 0))
        scope = kwargs.get('scope', 'lab')
        stats = bool(int(kwargs.get('stats', 0)))
        print(">>>>> get_user_projects: stats = ", stats, flush=True)

        project_perms = dm.get_config("permissions")['projects']
        project_config = dm.get_config("projects")

        view_options = project_perms['view_options']

        # FIXME Define access/permissions for other users
        projects = {}
        is_manager = user.is_manager

        if 'pid' in kwargs and not is_manager:
            raise Exception("You do not have permissions to see these projects")

        scopes_set = set(ps['key'] for ps in view_options)
        if 'scope' in kwargs and not scope in scopes_set:
            raise Exception(f"Invalid scope '{scope}', or invalid permissions.")

        pi_select = {}

        for p in dm.get_projects():
            if status and p.status != status:
                continue

            pi = p.user.get_pi()

            if pi:
                if pi.id not in pi_select:
                    pi_select[pi.id] = {'name': pi.name, 'count': 1}
                else:
                    pi_select[pi.id]['count'] += 1

            # Check filters to exclude projects from the list
            if pid and (not pi or pi.id != pid):
                continue

            # Show as visible if the user is manager or can edit a project
            # If not, some filters will be applied, based on user's lab
            if not is_manager and not user.can_edit_project(p):
                if scope == 'mine':
                    if user != p.user:
                        continue
                elif scope == 'lab':
                    if not user.same_pi(p.user):
                        continue

            if pi:
                apps = pi.get_applications()
                # skip this project from the list if the application is confidential
                # and the user has not access to it
                if apps and not apps[0].allows_access(user):
                    continue
            p.sessions = []
            projects[p.id] = p


        display_table = project_config.get('display_table', {})
        resource_days_tag = display_table.get('resource_days_tag', 'instrument')
        extra_columns = display_table.get('extra_columns',
                                          ['days', 'sessions', 'images', 'data'])

        if stats:
            # Find sessions for each project (based on project_id or booking's project)
            for s in dm.get_sessions():
                if p := s.project:
                    if p.id in projects:
                        projects[p.id].sessions.append(s)

            # Update Sessions stats
            for i, p in enumerate(projects.values()):
                days = sessions = images = size = 0
                for b in p.bookings:
                    # Only count days for microscopes

                    if resource_days_tag not in b.resource.tags:
                        continue
                    days += b.units(hours=24)
                    for s in b.session:
                        sessions += 1
                        images += s.images
                        size += s.size

                p.stats = {
                    'days': days,
                    'sessions': sessions,
                    'images': images,
                    'size': Pretty.size(size)
                }
                p.user_can_edit = user.can_edit_project(p)
                p.display_title = 'Hidden title' if (p.is_confidential and not p.user_can_edit) else p.title


        can_create = self.app.dm.user_can_create_projects(self.app.user)
        return {'projects': projects.values(),
                'user_can_create_projects': can_create,
                'show_extra': extra and user.is_admin,
                'pi_select': pi_select,
                'pid': pid,
                'possible_scopes': view_options,
                'scope': scope,
                'resource_days_tag': resource_days_tag,
                'extra_columns': extra_columns
                }

    def get_session_data(self, session, **kwargs):
        result = kwargs.get('result', 'micrographs')

        defocus = []
        defocusAngle = []
        resolution = []
        astigmatism = []
        timestamps = []
        gridsquares = []
        tsRange = {}
        beamshifts = []
        tsList = []

        sdata = self.app.dm.get_processing_project(session_id=session.id)['project']

        def _microns(v):
            return round(v * 0.0001, 3)

        def _ts(fn):
            return os.path.getmtime(sdata.join(fn))

        data = {
            'session': session.json(),
            'classes2d': []
        }

        if not sdata:
            data['stats'] = {'movies': {'count': 0}}
            raise Exception('OTF project not found.')

        data['stats'] = sdata.get_stats()

        if result == 'micrographs':
            firstMic = lastMic = None
            dbins = Bins([1, 2, 3])
            rbins = Bins([3, 4, 6])
            epuData = None

            if data['stats']['ctfs']['count'] > 0:
                for i, mic in enumerate(sdata.get_micrographs()):
                    micFn = mic['micrograph']
                    micName = mic.get('micName', micFn)
                    gridsquares.append(mic.get('gs', None))
                    if not defocus:
                        firstMic = micFn
                    lastMic = micFn
                    d = _microns(mic['ctfDefocus'])
                    defocus.append(d)
                    dbins.addValue(d)
                    defocusAngle.append(mic['ctfDefocusAngle'])
                    astigmatism.append(_microns(mic['ctfAstigmatism']))
                    r = round(mic['ctfResolution'], 3)
                    resolution.append(r)
                    rbins.addValue(r)
                    if 'ts' in mic:
                        tsList.append(mic['ts'] * 1000)  # Timestamp in milliseconds

                if firstMic and lastMic:
                    tsFirst, tsLast = _ts(firstMic), _ts(lastMic)
                    step = (tsLast - tsFirst) / len(defocus)
                else:
                    tsFirst = dt.datetime.timestamp(dt.datetime.now())
                    step = 1000
                    tsLast = tsFirst + len(defocus) * step

                epuData = sdata.getEpuData()
                if epuData is None:
                    beamshifts = []
                else:
                    beamshifts = [{'x': row.beamShiftX, 'y': row.beamShiftY}
                                  for row in epuData.moviesTable]
                tsRange = {'first': tsFirst * 1000,  # Timestamp in milliseconds
                           'last': tsLast * 1000,
                           'step': step * 1000}
            data.update({
                'defocus': defocus,
                'defocusAngle': defocusAngle,
                'astigmatism': astigmatism,
                'resolution': resolution,
                'tsRange': tsRange,
                'timestamps': tsList,
                'beamshifts': beamshifts,
                'defocus_bins': dbins.toList(),
                'resolution_bins': rbins.toList(),
                'gridsquares': gridsquares,
                'gs_info': True,  # epuData is not None,
                'ctfs_run_id': sdata.get_ctfs_runid()
            })

        elif result == 'classes2d':
            runId = int(kwargs.get('run_id', -1))

            if selection := kwargs.get('selection', None):  # Save selection file, not load classes 2d
                data['selection_file'] = sdata.save_classes2d_selection(runId, selection)
            else:
                data['classes2d'] = sdata.get_classes2d(runId=runId)

        return data

    def get_news(self, **kwargs):
        """ Return news after creating HTML markup. """
        from markupsafe import Markup
        status = kwargs.get('status', 'all')
        dm = self.app.dm  # shortcut
        news = ([], [])  # active/inactive lists

        project = dm.get_project_by(status='special:news')
        if project is not None:
            for e in project.entries:
                data = e.extra['data']
                active = data.get('active', False)
                i = 0 if active else 1
                news[i].append({
                    'id': e.id,
                    'title': e.title,
                    'text': e.description,
                    'html': Markup(e.description),
                    'active': active,
                    'type': data['type']
                })

        return {
            'news': news,
            'display': kwargs.get('display', 'table'),
            'project_id': project.id if project else 0
        }

    def get_inventory_project(self):
        """ Return the inventory project, creating it if it does not exist."""
        dm = self.app.dm
        inventory_status = 'special:inventory'
        project = dm.get_project_by(status=inventory_status)
        if project is None:
            project = dm.create_project(
                status=inventory_status,
                title='Inventory Project',
                description='Facility inventory',
                validate=False,
            )

        if project is None:
            raise Exception("Inventory project not found and could not be created")

        return project


    def get_inventory_items(self, project):
        items = []
        entry_type = 'inventory_item'
    
        # Skip entries that are being created
        entries = [e for e in project.entries if e.id]


        for e in sorted(entries, key=lambda x: x.id, reverse=True):
            if e.type != entry_type:
                continue
            data = e.extra.get('data', {})
            icon = data.get('icon')
            icon_url = None
            if icon:
                icon_url = flask.url_for('images.entry', entry=e.id, file=icon)
            items.append({
                'id': e.id,
                'title': e.title,
                'quantity': int(data.get('quantity', 0)),
                'total_cost': 0.0,
                'history': [],
                'date': e.date,
                'description': e.description,
                'data': data,
                'icon_url': icon_url,
            })

        return items

    def get_inventory(self, **kwargs):
        """Return inventory items from the special:inventory project."""
        project = self.get_inventory_project()
        inventory_items = self.get_inventory_items(project)
        items_dict = {item['id']: item for item in inventory_items}

        # Compute the total quantity of each item, taking into account 
        # the initial quantity and the added/removed quantities
        entry_type_operations = {
            'inventory_add': 1,
            'inventory_remove': -1
        }

        for e in project.entries:
            data = e.extra['data']

            if sign := entry_type_operations.get(e.type, None):
                quantity = sign * int(data.get('quantity', 0))
                item_id = int(data['item']) # item id
                if item := items_dict.get(item_id, None):
                    item['quantity'] += quantity
                    if e.type == 'inventory_add':
                        cost_val = data.get('total_cost', 0)
                        try:
                            item['total_cost'] += float(cost_val) if cost_val not in (None, '') else 0.0
                        except (TypeError, ValueError):
                            pass
                    item['history'].append({
                        'type': e.type,
                        'quantity': quantity,
                        'date': e.date,
                        'user': e.last_update_user.email,
                    })
                else:
                    raise Exception(f"Item ID {item_id} not found in inventory items")

        dm = self.app.dm
        currency = dm.get_config('resources').get('currency', '')

        return {
            'inventory_items': inventory_items,
            'project_id': project.id,
            'currency': currency,
        }

    def get_inventory_item_history(self, item_id):
        """Return add/remove history for an inventory item with running balance."""
        dm = self.app.dm
        item_id = int(item_id)
        project = self.get_inventory_project()
        item_entry = dm.get_entry_by(id=item_id)

        if item_entry is None or item_entry.type != 'inventory_item':
            raise Exception(f"Invalid inventory item id: {item_id}")

        if item_entry.project_id != project.id:
            raise Exception(f"Entry {item_id} does not belong to the inventory project")

        initial_qty = int(item_entry.extra.get('data', {}).get('quantity', 0))
        operations = []
        total_cost = 0.0

        for e in project.entries:
            if e.type not in ('inventory_add', 'inventory_remove'):
                continue

            data = e.extra.get('data', {})
            if int(data.get('item', 0)) != item_id:
                continue

            qty = int(data.get('quantity', 0))
            is_add = e.type == 'inventory_add'
            signed_qty = qty if is_add else -qty

            if is_add:
                cost_val = data.get('total_cost', 0)
                try:
                    cost = float(cost_val) if cost_val not in (None, '') else 0.0
                except (TypeError, ValueError):
                    cost = 0.0
                total_cost += cost
            else:
                cost = 0.0

            operations.append({
                'entry_id': e.id,
                'entry_type': e.type,
                'date': e.date,
                'operation': 'Add' if is_add else 'Remove',
                'quantity': signed_qty,
                'quantity_display': f"+{qty}" if is_add else f"-{qty}",
                'cost': cost,
            })

        operations.sort(key=lambda x: x['date'])
        balance = initial_qty
        for op in operations:
            balance += op['quantity']
            op['balance'] = balance

        operations.sort(key=lambda x: x['date'], reverse=True)

        currency = dm.get_config('resources').get('currency', '')

        return {
            'item': {
                'id': item_id,
                'title': item_entry.title,
            },
            'history': operations,
            'total_cost': total_cost,
            'currency': currency,
            'project_id': project.id,
        }


def register_content(dc):

    @dc.content
    def pucks(**kwargs):
        dm = app.dm  # shortcut
        dewar = cane = puck = None
        
        # JMRT: 2026-05-27: range is used to limit the number of pucks to load
        pucks_range = kwargs.get('pucks_range', '1-9999')  
        min_id, max_id = pucks_range.split('-')
        condStr = 'id>=%s and id<=%s' % (min_id, max_id)
        pucks = dm.get_pucks(condition=condStr, orderBy='id')
        storage = dm.PuckStorage(pucks)

        # This function is used when selecting a dewar or a cane or a puck
        if dewar_id := int(kwargs.get('dewar', 0) or 0):
            dewar = storage.get_dewar(dewar_id)
            if cane_id := int(kwargs.get('cane', 0) or 0):
                cane = storage.get_cane(dewar_id, cane_id)
        if puck_id := int(kwargs.get('puck', 0) or 0):
            puck = storage.get_puck(puck_id)

        return {
            'storage': storage,
            'dewar': dewar,
            'cane': cane,
            'puck': puck,
            'pucks_range': pucks_range
        }

    @dc.content
    def pucks_cane(**kwargs): 
        return pucks(**kwargs)

    @dc.content
    def pucks_cane_details(**kwargs):
        return pucks(**kwargs)

    @dc.content
    def puck_details(**kwargs):
        return pucks(**kwargs)

    @dc.content
    def cane_form(**kwargs):
        dm = app.dm
        dewar_id = int(kwargs.get('dewar_id', 0) or 0)
        cane_id = int(kwargs.get('cane_id', 0) or 0)
        is_new = cane_id <= 0

        config_form = dm.get_form_by_name('config:dewars')
        if config_form is None:
            raise Exception("Missing config:dewars form")

        pucks_range = kwargs.get('pucks_range', '1-9999')
        min_id, max_id = pucks_range.split('-')
        condStr = 'id>=%s and id<=%s' % (min_id, max_id)
        pucks = dm.get_pucks(condition=condStr, orderBy='id')
        storage = dm.PuckStorage(pucks)

        if is_new:
            if not dewar_id:
                raise Exception("dewar_id is required to add a cane")
            storage.get_dewar(dewar_id)
            cane = {
                'id': storage.next_cane_id(dewar_id),
                'label': '',
                'color': '#d3d3d3',
            }
            cane_pucks = []
        else:
            cane = storage.get_cane(dewar_id, cane_id)
            cane_pucks = [
                {'id': p.id, 'label': p.label, 'position': p.position}
                for p in storage.pucks(dewar_id, cane_id)
            ]

        return {
            'cane': cane,
            'dewar_id': dewar_id,
            'cane_id': cane['id'],
            'is_new': is_new,
            'form_id': config_form.id,
            'color_value': cane.get('color') or '#d3d3d3',
            'cane_pucks': cane_pucks,
        }

    @dc.content
    def puck_form(**kwargs):
        from types import SimpleNamespace

        dm = app.dm
        puck_id = int(kwargs.get('puck_id', 0) or 0)

        pucks_range = kwargs.get('pucks_range', '1-9999')
        min_id, max_id = pucks_range.split('-')
        condStr = 'id>=%s and id<=%s' % (min_id, max_id)
        pucks = dm.get_pucks(condition=condStr, orderBy='id')
        storage = dm.PuckStorage(pucks)

        is_new = puck_id <= 0
        if is_new:
            dewar_id = int(kwargs.get('dewar', 0) or 0)
            cane_id = int(kwargs.get('cane', 0) or 0)
            position = int(kwargs.get('position', 0) or 0)
            if not dewar_id or not cane_id or not position:
                raise Exception("dewar, cane and position are required for a new puck")
            if storage.puck_at(dewar_id, cane_id, position):
                raise Exception("Position %s is already occupied" % position)

            cane = storage.get_cane(dewar_id, cane_id)
            cane_label = cane.get('label') or ('cane %s' % cane_id)
            location_value = storage.location_value(dewar_id, cane_id, position)
            location_options = [{
                'value': location_value,
                'label': 'Dewar %s / %s / %s' % (dewar_id, cane_label, position),
            }]
            puck = SimpleNamespace(
                id=None,
                label='',
                color='#d3d3d3',
                dewar=dewar_id,
                cane=cane_id,
                position=position,
            )
            puck_extra = {}
        else:
            puck = dm.get_puck_by(id=puck_id)
            if puck is None:
                raise Exception("Puck %s not found" % puck_id)
            location_value = storage.location_value(
                puck.dewar, puck.cane, puck.position)
            location_options = storage.location_options(puck_id=puck.id)
            puck_extra = puck.extra or {}

        return {
            'puck': puck,
            'storage': storage,
            'is_new': is_new,
            'location_value': location_value,
            'location_options': location_options,
            'puck_extra': puck_extra,
        }

    @dc.content
    def puck_gridbox_form(**kwargs):
        dm = app.dm
        puck_id = int(kwargs.get('puck_id', 0) or 0)
        position = int(kwargs.get('position', 0) or 0)
        puck = dm.get_puck_by(id=puck_id)

        if puck is None:
            raise Exception("Puck %s not found" % puck_id)

        form = dm.get_form_by_name('form:puck_gridbox')
        if form is None:
            raise Exception("Missing form:puck_gridbox")

        gridboxes_snapshot = copy.deepcopy(puck.gridboxes())
        gridbox = puck.get_gridbox(position)
        if 'form_values' not in kwargs and gridbox:
            kwargs['form_values'] = json.dumps(gridbox)

        data = dc.dynamic_form(form, **kwargs)
        data.update({
            'puck_id': puck_id,
            'position': position,
            'has_gridbox': gridbox is not None,
            'gridboxes_snapshot': gridboxes_snapshot,
        })
        return data

    @dc.content
    def grids_cane(**kwargs):
        dm = app.dm  # shortcut

        range = kwargs.get('pucks_range', '1-9999')  # by default all

        min_id, max_id = range.split('-')
        condStr = 'id>=%s and id<=%s' % (min_id, max_id)

        pucks = dm.get_pucks(condition=condStr, orderBy='id')

        dewars = defaultdict(lambda: defaultdict(dict))

        dewar = int(kwargs.get('dewar', 0) or 0)
        cane = int(kwargs.get('cane', 0) or 0)

        storage = dm.PuckStorage(pucks)

        for puck in storage.pucks():
            puck['gridboxes'] = defaultdict(dict)

        cond = "type=='grids_storage'"
        for entry in dm.get_entries(condition=cond):
            table = entry.extra['data']['grids_storage_table']
            for row in table:
                try:
                    slot = int(row['box_position'])
                    puck = storage.get_puck(int(row['puck_id']))
                    slot_key = ','.join(row['grid_position'])
                    row['entry'] = entry
                    puck['gridboxes'][slot][slot_key] = row
                except:
                    pass

        return {
            'storage': storage,
            'pucks_range': range,
            'dewar': storage.get_dewar(dewar),
            'cane': storage.get_cane(dewar, cane)
        }

    @dc.content
    def grids_puck(**kwargs):
        data = grids_cane(**kwargs)
        data['puck'] = int(kwargs.get('puck', 0) or 0)
        return data

    @dc.content
    def grids_storage(**kwargs):
        return grids_cane(**kwargs)

    @dc.content
    def dashboard(**kwargs):
        dm = app.dm  # shortcut
        user = app.user  # shortcut
        dataDict = dc.get_resources(image=True)
        resource_bookings = {}

        # Provide upcoming bookings sorted by proximity
        bookings = [('Today', []),
                    ('Next 7 days', []),
                    ('Next 30 days', [])]

        def week_start(d):
            return (d - dt.timedelta(days=d.weekday())).date()

        if 'date' in kwargs:
            now = datetime_from_isoformat(kwargs['date'])
        else:
            now = dm.now()
        this_week = week_start(now)
        d7 = dt.timedelta(days=7)
        next_week = week_start(now + d7)
        prev7 = now - dt.timedelta(days=8)
        next7 = now + d7
        next30 = now + dt.timedelta(days=30)

        def is_same_week(d):
            return this_week == week_start(d)

        def is_next_week(d):
            return this_week == week_start(d - d7)

        def add_booking(b):
            start = dm.dt_as_local(b.start)
            end = dm.dt_as_local(b.end)

            r = b.resource
            if r.id not in resource_bookings:
                resource_bookings[r.id] = {
                    'today': [],
                    'this_week': [],
                    'next_week': []
                }

            if is_same_week(start):
                k = 'this_week'
            elif is_next_week(start):
                k = 'next_week'
            else:
                k = None

            if k:
                resource_bookings[r.id][k].append(b)

                if start.date() <= now.date() <= end.date():  # also add in today
                    resource_bookings[r.id]["today"].append(b)
                    bookings[0][1].append(b)
                elif k == 'next_week':
                    bookings[1][1].append(b)
            else:
                bookings[2][1].append(b)

        local_tag = dm.get_config('bookings').get('local_tag', '')
        local_scopes = {}
        resource_create_session = {}

        for b in dm.get_bookings_range(prev7, next30):
            # if not user.is_manager and not user.same_pi(b.owner):
            #     continue
            r = b.resource
            if not local_tag or local_tag in r.tags:
                local_scopes[r.id] = r
                add_booking(b)
                if r.name not in resource_create_session:
                    resource_create_session[r.name] = dm.get_create_session_template(r.name)

        scopes = {r.id: r for r in dm.get_resources()}

        # Retrieve open requests for each scope from entries and bookings
        for p in dm.get_projects():
            if p.is_active:
                last_bookings = {}
                # Find last bookings for each scope
                for b in sorted(p.bookings, key=lambda b: b.end, reverse=True):
                    if len(last_bookings) < len(local_scopes) and b.resource_id not in last_bookings:
                        last_bookings[b.resource.id] = b

                reqs = {}
                for e in reversed(p.entries):
                    # Requests found for each scope, no need to continue
                    if len(reqs) == len(local_scopes):
                        break
                    if b := dc.booking_from_entry(e, scopes):
                        rid = b.resource_id
                        if (rid not in reqs and
                                (rid not in last_bookings or
                                 b.start.date() > last_bookings[rid].end.date())):
                            b.id = e.id
                            add_booking(b)
                            reqs[rid] = b

        # Sort all entries
        for rbookings in resource_bookings.values():
            for k, bookingValues in rbookings.items():
                bookingValues.sort(key=lambda b: b.start)

        dataDict.update({'bookings': bookings,
                         'resource_bookings': resource_bookings,
                         'resource_create_session': resource_create_session,
                         'local_resources': local_scopes
                         })
        dataDict.update(dc.get_news(**kwargs))
        return dataDict

    @dc.content
    def news(**kwargs):
        return dc.get_news(**kwargs)

    @dc.content
    def inventory(**kwargs):
        return dc.get_inventory(**kwargs)

    @dc.content
    def inventory_item_history(**kwargs):
        return dc.get_inventory_item_history(kwargs['item_id'])

    @dc.content
    def inventory_items(**kwargs):
        project = dc.get_inventory_project()
        return {'inventory_items': dc.get_inventory_items(project)}

    @dc.content
    def validate_inventory_item(entry):
        if not entry.title or not entry.title.strip():
            raise Exception("Title can not be empty")

        data = entry.extra.get('data', {})

        def _validate_int_field(key, label, *, required=False, positive=False):
            value = data.get(key)
            if value is None or value == '':
                if required:
                    raise Exception(f"{label} is required")
                return
            try:
                n = int(value)
            except (TypeError, ValueError):
                raise Exception(f"{label} must be an integer")
            if positive and n <= 0:
                raise Exception(f"{label} must be greater than zero")

        _validate_int_field('quantity', 'Quantity', required=True)
        _validate_int_field('low', 'Low', positive=True)
        _validate_int_field('medium', 'Medium', positive=True)
