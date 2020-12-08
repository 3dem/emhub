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

from emhub.utils import (pretty_datetime, datetime_to_isoformat,
                         datetime_from_isoformat)


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
        dataDict = {}  # self.get_resources_list()
        get_func = getattr(self, get_func_name, None)
        if get_func is not None:
            dataDict.update(get_func(**kwargs))
        return dataDict

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
        data = {'user': user}

        pi_label = None

        # Allow to change pi if it is a manager logged
        if user.is_pi:
            pi_label = 'Self'
        elif user.is_manager:
            pi_label = 'None'
        elif self.app.user.is_manager:
            data['possible_pis'] = [
                {'id': u.id, 'name': u.name}
                for u in self.app.dm.get_users() if u.is_pi
            ]
        else:
            pi_label = user.pi.name

        data['pi_label'] = pi_label

        return data

    def get_resources_list(self, **kwargs):
        user = self.app.user
        if not user.is_authenticated:
            return  {'resources': []}

        resource_list = [
            {'id': r.id,
             'name': r.name,
             'status': r.status,
             'tags': r.tags,
             'requires_slot': r.requires_slot,
             'latest_cancellation': r.latest_cancellation,
             'color': r.color,
             'image': flask.url_for('images.static', filename=r.image),
             'user_can_book': user.can_book_resource(r),
             'is_microscope': r.is_microscope,
             'min_booking': r.min_booking,
             'max_booking': r.max_booking
             }
            for r in self.app.dm.get_resources()
        ]
        return {'resources': resource_list}

    def get_resource_form(self, **kwargs):
        r = self.app.dm.get_resource_by(id=kwargs['resource_id'])

        params = []

        def _add(attr, label, **kwargs):
            p = {'id': attr,
                 'label': label,
                 'value': getattr(r, attr)
                 }
            p.update(kwargs)
            params.append(p)

        _add('name', 'Name')
        _add('status', 'Status',
             enum={'display': 'combo',
                   'choices': ['active', 'inactive']})
        _add('tags', 'Tags')
        _add('latest_cancellation', 'Latest cancellation (h)')
        _add('min_booking', 'Minimum booking time (h)')
        _add('min_booking', 'Maximum booking time (h)')
        _add('requires_slot', 'Requires Slot', type='bool')
        _add('requires_application', 'Requires Application', type='bool')

        return {
            'resource': r, 'params': params
        }

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

        dataDict['possible_owners'] = self.get_pi_labs()
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
                                  'status': t.status,
                                  'iuid': t.extra.get('portal_iuid', 'no')
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
        dm = self.app.dm
        logs = int(kwargs.get('n', 100))
        logs = dm.get_logs()[-logs:  ]
        for log in logs:
            log.user = dm.get_user_by(id=log.user_id)

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

    def get_portal_users_list(self, **kwargs):
        dm = self.app.dm
        do_import = 'import' in kwargs
        imported = []
        failed = []

        if do_import:
            users = self._get_users_from_portal(status='ready')
            for u in users:
                roles = ['user', 'pi'] if u['pi'] else ['user']
                pi_id = None if u['pi'] else u['pi_user'].id

                try:
                    user = dm.create_user(
                        username=u['email'],
                        email=u['email'],
                        phone='',
                        password=os.urandom(24).hex(),
                        name="%(first_name)s %(last_name)s" % u,
                        roles=roles,
                        pi_id=pi_id,
                        status='active'
                    )
                    imported.append(u)
                    self.app.mm.send_mail(
                        [user.email],
                        "emhub: New account imported",
                        flask.render_template('email/account_created.txt',
                                              user=user))
                except Exception as e:
                    u['error'] = str(e)
                    failed.append(u)
            status = None
        else:
            status = kwargs.get('status', None)

        users = self._get_users_from_portal(status)

        return {'portal_users': users,
                'status': status,
                'do_import': do_import,
                'users_imported': imported,
                'users_failed': failed
                }

    def get_portal_import_application(self, **kwargs):
        result = {}
        app_code = kwargs.get('code', None)
        errors = []

        if app_code is not None:
            try:
                app_code = app_code.upper()
                app = self._import_order_from_portal(app_code)
                result['order'] = app
            except Exception as e:
                result['errors'] = [str(e)]

        return result

    def get_reports_time_distribution(self, **kwargs):
        #d = request.json or request.form
        d = {'start': '2020-01-01',
             'end': '2020-12-31'
             }
        bookings = self.app.dm.get_bookings_range(
            datetime_from_isoformat(d['start']),
            datetime_from_isoformat(d['end'])
        )
        func = self.app.dc.booking_to_event
        bookings = [func(b) for b in bookings
                    if b.resource.is_microscope]

        from emhub.reports import get_booking_counters
        counters, cem_counters = get_booking_counters(bookings)

        return {'overall': counters,
                'cem': cem_counters,
                'possible_owners': self.get_pi_labs()
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

        application_label = 'None'

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
            appStr = '' if application is None else ', %s' % application.code
            extra = "%s%s" % (owner.name, appStr)
            if user_can_view:
                title = "%s (%s) %s" % (resource_info['name'], extra, b_title)
                if application:
                    application_label = application.code
                    if application.alias:
                        application_label += "  (%s)" % application.alias
            else:
                title = "%s (%s)" % (resource_info['name'], extra)
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
            'experiment': booking.experiment,
            'application_label': application_label
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

    def _import_order_from_portal(self, orderCode):
        """ Try to import a new order from the portal.
        Return an error list or a valid imported application.
        """
        dm = self.app.dm

        app = self.app.dm.get_application_by(code=orderCode)

        if app is not None:
            raise Exception('Application %s already exist' % orderCode)

        orderJson = self.app.sll_pm.fetchOrderDetailsJson(orderCode)

        if orderJson is None:
            raise Exception('Invalid application ID %s' % orderCode)

        piEmail = orderJson['owner']['email']
        # orderId = orderJson['identifier']

        pi = dm.get_user_by(email=piEmail)

        if pi is None:
            raise Exception("Order owner email (%s) not found as PI" % piEmail)

        if orderJson['status'] != 'accepted':
            raise Exception("Only 'accepted' applications can be imported. ")

        fields = orderJson['fields']
        description = fields.get('project_des', None)
        invoiceRef = fields.get('project_invoice_addess', None)

        created = datetime_from_isoformat(orderJson['created'])
        pi_list = fields.get('pi_list', [])

        form = orderJson['form']
        iuid = form['iuid']

        # Check if the given form (here templates) already exist
        # or we need to create a new one
        orderTemplate = None
        templates = dm.get_templates()
        for t in templates:
            if t.extra.get('portal_iuid', None)  == iuid:
                orderTemplate = t
                break

        if orderTemplate is None:
            orderTemplate = dm.create_template(
                title=form['title'],
                status='active',
                extra={'portal_iuid': iuid}
            )
            dm.commit()

        app = dm.create_application(
            code=orderCode,
            title=orderJson['title'],
            created=created,  # datetime_from_isoformat(o['created']),
            status='active',
            description=description,
            creator_id=pi.id,
            template_id=orderTemplate.id,
            invoice_reference=invoiceRef or 'MISSING_INVOICE_REF',
        )

        for piTuple in pi_list:
            piEmail = piTuple[1]
            pi = dm.get_user_by(email=piEmail)
            if pi is not None:
                app.users.append(pi)

        dm.commit()

        return app

    def get_pi_labs(self):
        # Send a list of possible owners of bookings
        # 1) Managers or admins can change the ownership to any user
        # 2) Application managers can change the ownership to any user in their
        #    application
        # 3) Other users can not change the ownership
        user = self.app.user  # shortcut
        if not user.is_authenticated:
            return []

        if user.is_manager:
            piList = [u for u in self.app.dm.get_users() if u.is_pi]
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

        return labs
