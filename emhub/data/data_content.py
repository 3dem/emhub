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
from collections import defaultdict

import flask
import flask_login

from emhub.utils import (pretty_datetime, datetime_to_isoformat, pretty_date,
                         datetime_from_isoformat, get_quarter, pretty_quarter,
                         image)


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
        resource_bookings = {}

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
                r = b.resource
                if i == 0 and r.is_microscope and 'solna' in r.tags:  # Today's bookings
                    # FIXME: If there is already a session, also return its id
                    resource_bookings[r.id] = b

        dataDict.update({'bookings': bookings,
                         'lab_members': self.get_lab_members(user),
                         'resource_bookings': resource_bookings})
        return dataDict

    def get_lab_members(self, user):
        if user.is_manager:
            return [u.json() for u in self._get_facility_staff()]

        pi = user.get_pi()
        return [] if pi is None else [u.json() for u in pi.get_lab_members()]

    def get_sessions_overview(self, **kwargs):
        sessions = self.app.dm.get_sessions(condition=self._get_display_condition(),
                                            orderBy='resource_id')
        return {'sessions': sessions}

    def get_session_data(self, session):
        firstSetId = session.data.get_sets()[0]['id']
        attrList = ['location', 'ctfDefocus', 'ctfResolution']
        mics = session.data.get_set_items(firstSetId, attrList=attrList)
        session.data.close()

        def _get_hist(label, inputList):
            import numpy as np
            hist, bins = np.histogram(inputList)
            return {
                'label': label,
                'data': [int(h) for h in hist],
                'bins': ['%0.1f' % b for b in bins],
            }

        defocusList = [m['ctfDefocus'] for m in mics]
        resolutionList = [m['ctfResolution'] for m in mics]
        stats = session.stats

        return {
            'defocus_plot': ['Defocus'] + defocusList,
            'ctf_defocus_hist': _get_hist('CTF Defocus', defocusList),
            'resolution_plot': ['Resolution'] + resolutionList,
            'ctf_resolution_hist': _get_hist('CTF Resolution', resolutionList),
            'session': session.json(),
            'counters': {
                'imported': stats['numOfMics'],
                'aligned': stats['numOfMics'],
                'ctf': stats['numOfCtfs'],
                'picked': 0
            }}

    def get_session_live(self, **kwargs):
        session_id = kwargs['session_id']
        session = self.app.dm.load_session(session_id)
        return self.get_session_data(session)

    def get_session_details(self, **kwargs):
        session_id = kwargs['session_id']
        session = self.app.dm.get_session_by(id=session_id)
        days = self.app.dm.get_session_data_deletion(session.name[:3])
        td = (session.start + dt.timedelta(days=days)) - self.app.dm.now()
        errors = []
        # TODO: We might check other type of errors in the future
        status_info = session.extra.get('status_info', '')
        if status_info.lower().startswith('error:'):
            errors.append(status_info)

        return {
            'session': session,
            'deletion_days': td.days,
            'errors': errors
        }

    def get_sessions_list(self, **kwargs):
        sessions = self.app.dm.get_sessions()
        bookingDict = {}
        for s in sessions:
            if s.booking:
                b = self.booking_to_event(s.booking,
                                          prettyDate=True, piApp=True)
                bookingDict[s.booking.id] = b

        return {
            'sessions': sessions,
            'bookingDict': bookingDict,
            'possible_owners': self.get_pi_labs(),
            'possible_operators': self.get_possible_operators(),
        }

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
            pi = user.pi
            pi_label = 'Unknown' if pi is None else pi.name

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
             'max_booking': r.max_booking,
             'daily_cost': r.daily_cost
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
        _add('daily_cost', 'Daily cost')
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
        dataDict['possible_operators'] = self.get_possible_operators()

        dataDict['resource_id'] = kwargs.get('resource_id', None)
        return dataDict

    def get_applications(self, **kwargs):
        dataDict = self.get_raw_applications_list()
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


    def get_application_form(self, **kwargs):
        dm = self.app.dm  # shortcut
        app = self.app.dm.get_application_by(id=kwargs['application_id'])

        # Microscopes info to setup some permissions on the Application form
        mics = [{'id': r.id,
                 'name': r.name,
                 'noslot': app.no_slot(r.id),
                 } for r in dm.get_resources() if r.is_microscope]

        # Check which PIs are in the application
        in_app = set(pi.id for pi in app.pi_list)

        return {'application': app,
                'application_statuses': ['preparation', 'review', 'accepted',
                                         'active', 'closed'],
                'microscopes': mics,
                'pi_list': [{'id': u.id,
                             'name': u.name,
                             'email': u.email,
                             'in_app': u.id in in_app,
                             'status': 'creator' if u.id == app.creator.id else ''
                             }
                            for u in dm.get_users() if u.is_pi]
                }

    def set_form_values(self, form, values):
        """ Load values to form parameters based on the ids.
        """
        definition = form.definition

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

    def get_dynamic_form_modal(self, **kwargs):
        form_id = int(kwargs.get('form_id', 1))
        form_values_str = kwargs.get('form_values', None) or '{}'
        form_values = json.loads(form_values_str)

        form = self.app.dm.get_form_by(id=form_id)

        if form is None:
            raise Exception("Invalid form id: %s" % form_id)

        self.set_form_values(form, form_values)

        return {'form': form}

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
        # Date since the created orders in the portal will be considered
        sinceArg = kwargs.get('since', None)

        if sinceArg:
            since = datetime_from_isoformat(sinceArg)
        else:
            since = self.app.dm.now() - dt.timedelta(days=183)  # 6 months

        result = {'since': since}

        app_code = None
        if app_code is not None:
            try:
                app_code = app_code.upper()
                app = self._import_order_from_portal(app_code)
                result['order'] = app
            except Exception as e:
                result['errors'] = [str(e)]

        else:
            ordersJson = self.app.sll_pm.fetchOrdersJson()

            def _filter(o):
                s = o['status']
                code = o['identifier'].upper()
                app = self.app.dm.get_application_by(code=code)
                created = datetime_from_isoformat(o['created'])

                return ((s == 'accepted' or s == 'processing') and
                        app is None and created >= since)
                        #created.year == self.app.dm.now().year)

            result['orders'] = [o for o in ordersJson if _filter(o)]

        return result

    def get_reports_time_distribution(self, **kwargs):

        bookings, range_dict = self.get_booking_in_range(kwargs)

        from emhub.reports import get_booking_counters
        counters, cem_counters = get_booking_counters(bookings)

        details_key = kwargs.get('details', None) or 'Reminder'

        def _group(bookings):
            pi_bookings = {}
            for b in bookings:
                pi_id = b['pi_id']
                if pi_id not in pi_bookings:
                    pi_bookings[pi_id] = [[pi_id, b['pi_name'], 0, 0]]

                pi_list = pi_bookings[pi_id]
                pi_list.append(b)
                pi_list[0][2] += b['days']
                pi_list[0][3] += b['total_cost']

            return list(pi_bookings.values())

        app_dict = {a.code: a.alias for a in self.app.dm.get_applications()}
        if details_key.startswith('CEM') and len(details_key) > 3:
            alias = app_dict.get(details_key, None)
            details_title = details_key + (' (%s)' % alias if alias else '')
            details_bookings = cem_counters[details_key].bookings
        else:
            details_title = {
                'Reminder': "Reminder: Uncategorized Bookings (Review and Update)",
                'DBB': "DBB Bookings",
                'Downtime': "Downtime",
                'Maintenance': "Maintenance",
                'Development': "Development"
            }[details_key]
            details_bookings = counters[details_key].bookings

        d = {
            'overall': counters,
            'cem': cem_counters,
            'possible_owners': self.get_pi_labs(),
            'possible_operators': self.get_possible_operators(),
            'app_dict': app_dict,
            'details_bookings': details_bookings,
            'details_title': details_title,
            'details_key': details_key,
            'details_groups': [],
        }

        d.update(range_dict)

        if details_key.startswith('CEM') or details_key.startswith('DBB'):
            d['details_groups'] = _group(details_bookings)

        return d

    def get_reports_invoices(self, **kwargs):
        bookings, range_dict = self.get_booking_in_range(kwargs, asJson=False)

        portal_users = {
            pu['email']: pu for pu in self.app.sll_pm.fetchAccountsJson()
            if pu['pi']
        }

        def create_pi_info_dict(a):
            return {pi.id: {
                'pi_name': pi.name,
                'pi_email': pi.email,
                'bookings': [],
                'sum_cost': 0,
                'sum_days': 0,
                } for pi in a.pi_list
            }

        def update_pi_info(pi_info, b):
            pi_info['bookings'].append(b)
            pi_info['sum_cost'] += b.total_cost
            pi_info['sum_days'] += b.days

        # Create a dictionary where pi/bookings are grouped by Application
        # and another one grouped by pi
        apps_dict = {}
        pi_dict = {}

        for a in self.app.dm.get_applications():
            apps_dict[a.code] = create_pi_info_dict(a)
            pi_dict.update(create_pi_info_dict(a))

        for b in bookings:
            if b.application is None:
                continue

            app_id = b.application.code

            if  app_id not in apps_dict:
                print(">>> Missing app: ", app_id)
                continue

            pi = b.owner.get_pi()

            if pi is None:
                print(">>>  None pi, user: ", b.owner.name)
                continue

            try:
                update_pi_info(apps_dict[app_id][pi.id], b)
                update_pi_info(pi_dict[pi.id], b)

                if b.total_cost == 0:
                    print(">>> 0 cost booking1!!!")
                    print(b.json())

            except KeyError:
                print("Got KeyError, app_id: %s, pi_id: %s"
                      % (app_id, pi.id))

        result = {
            'apps_dict':  apps_dict,
            'pi_dict': pi_dict,
            'portal_users': portal_users,
            'group': int(kwargs.get('group', 1))
        }
        result.update(range_dict)

        return result

    def __get_period(self, kwargs):
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

    def __get_pi_user(self, kwargs):
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

    def get_reports_invoices_lab(self, **kwargs):
        period = self.__get_period(kwargs)
        pi_user = self.__get_pi_user(kwargs)
        app = pi_user.get_applications()[-1]

        data = self.get_reports_invoices(**kwargs)
        data['apps_dict'] = {app.code: data['apps_dict'][app.code]}
        data['app'] = app
        data.update(self.get_transactions_list(period=period.id))
        data['period'] = period
        alias = app.alias
        data['details_title'] = app.code + (' (%s)' % alias if alias else '')

        return data

    def get_invoices_per_pi(self, **kwargs):
        pi_id = kwargs.get('pi_id', None)

        data = {'pi_id': pi_id,
                'pi_list': [u for u in self.app.dm.get_users() if u.is_pi],
                }

        if pi_id is None:
            return data

        pi_user = self.__get_pi_user(kwargs)
        dm = self.app.dm  # shortcut

        def _filter(b):
            pi = b.owner.get_pi()
            return (b.resource.daily_cost > 0 and
                    b.start <= dm.now() and
                    not b.is_slot and pi and pi.id == pi_user.id)

        entries = []

        for b in dm.get_bookings():
            if _filter(b):
                entries.append({'id': b.id,
                                'title': self.booking_to_event(b)['title'],
                                'date': b.start,
                                'amount': b.total_cost,
                                'type': 'booking'
                                })

        for t in dm.get_transactions():
            if t.user.id == pi_user.id:
                entries.append({'id': t.id,
                                'title': t.comment,
                                'date': t.date,
                                'amount': t.amount,
                                'type': 'transaction'
                                })

        invoice_periods = self.get_invoice_periods_list()['invoice_periods']
        for ip in invoice_periods:
            if ip['order'] > 0:
                entries.append({'id': ip['id'],
                                'title': ip['period'],
                                'date': ip['end'],
                                'amount': 0,
                                'type': 'summary'
                                })

        entries.sort(key=lambda e: e['date'])

        total = 0
        for e in entries:
            if e['type'] == 'summary':
                e['amount'] = total
                if total > 0:
                    total = 0
            else:
                total += e['amount']

        data.update({
            'pi': pi_user,
            'entries': entries,
            'total': total,
            'table_file_prefix': 'all_invoices_PI_' + pi_user.name.replace(' ', '_')
        })

        return data

    def get_invoices_lab_list(self, **kwargs):

        period = self.__get_period(kwargs)
        bookings, range_dict = self.get_booking_in_range(kwargs)

        pi_user = self.__get_pi_user(kwargs)

        apps_dict = {a.id: [] for a in pi_user.get_applications()}
        all_bookings = []
        for b in bookings:
            if b.get('pi_id', None) != pi_user.id:
                continue

            app_id = b.get('app_id', None)

            if app_id not in apps_dict:
                continue

            apps_dict[app_id].append(b)
            all_bookings.append(b)

        result = {
            'pi': pi_user,
            'apps_dict':  apps_dict,
            'all_bookings': all_bookings,
            'total': sum(b['total_cost'] for b in all_bookings)
        }

        result.update(range_dict)
        result.update(self.get_transactions_list(period=period.id,
                                                 pi=pi_user.id))

        return result

    def get_reports_bookings_extracosts(self, **kwargs):
        all_bookings, range_dict = self.get_booking_in_range(kwargs)

        u = self.app.user
        if not u.is_manager:
            raise Exception("Only manager users can access this page")

        bookings = []

        for b in all_bookings:
            if len(b['costs']):
                bookings.append(b)

        q1 = get_quarter()
        q0 = get_quarter(q1[0] - dt.timedelta(days=1))

        self.get_transactions_list(**kwargs)

        result = {
            'bookings': bookings,
            'q0': q0,
            'q1': q1
        }

        result.update(range_dict)

        return result

    def get_booking_costs_table(self, **kwargs):
        resources = self.app.dm.get_resources()

        return {'data': [(r.name, r.status, r.tags) for r in resources]}

    def get_applications_check(self, **kwargs):

        dm = self.app.dm

        sinceArg = kwargs.get('since', None)

        if sinceArg:
            since = datetime_from_isoformat(sinceArg)
        else:
            since = self.app.dm.now() - dt.timedelta(days=183)  # 6 months
        results = {}

        accountsJson = self.app.sll_pm.fetchAccountsJson()
        usersDict = {a['email'].lower(): a for a in accountsJson}

        for application in dm.get_applications():
            app_results = {}
            errors = []

            if application.created < since:
                continue

            orderCode = application.code.upper()
            orderJson = self.app.sll_pm.fetchOrderDetailsJson(orderCode)

            if orderJson is None:
                errors.append('Invalid application ID %s' % orderCode)
            else:
                fields = orderJson['fields']
                pi_list = fields.get('pi_list', [])
                pi_missing = []

                for piTuple in pi_list:
                    piName, piEmail = piTuple
                    piEmail = piEmail.lower()

                    pi = dm.get_user_by(email=piEmail)
                    piInfo = ''
                    if pi is None:
                        if piEmail in usersDict:
                            piInfo = "in the portal, pi: %s" % usersDict[piEmail]['pi']
                        else:
                            piInfo = "NOT in the portal"

                    else:
                        if pi.id != application.creator.id and pi not in application.users:
                            piInfo = 'NOT in APP'
                    if piInfo:
                        pi_missing.append((piName, piEmail, piInfo))

                if pi_missing:
                    app_results['pi_missing'] = pi_missing

            if errors:
                app_results['errors'] = errors

            if app_results:
                app_results['application'] = application
                results[orderCode] = app_results

        return {'checks': results,
                'since': since
                }

    def get_report_pis_usage(self, **kwargs):

        bookings, range_dict = self.get_booking_in_range(kwargs, asJson=False)

        pi_dict = {}
        univ_dict = self.app.dm.get_universities_dict()

        def _get_univ(email, default=None):
            for k, v in univ_dict.items():
                if email.endswith(k):
                    return v
            return default


        for b in bookings:
            pi = b.owner.get_pi()
            if pi:
                parts = pi.name.split()
                first_name = ' '.join(parts[:-1])
                last_name = parts[-1]
                if not pi.email in pi_dict:
                    pi_dict[pi.email] = {
                        'first_name': first_name,
                        'last_name': last_name,
                        'email': pi.email,
                        #'email_rev': pi.email[::-1],  # reverse email for sorting
                        'university': _get_univ(pi.email, 'z-Unknown'),
                        'bookings': 0,
                        'days': 0,
                        'users': set()
                    }
                pi_entry = pi_dict[pi.email]
                pi_entry['bookings'] += 1
                pi_entry['days'] += b.days
                pi_entry['users'].add(b.owner.email)

        data = {
            'pi_list': sorted(pi_dict.values(), key=lambda pi: pi['university'].lower())
        }
        data.update(range_dict)

        return data

    # --------------------- RAW (development) content --------------------------
    def get_raw_booking_list(self, **kwargs):
        bookings = self.app.dm.get_bookings()
        return {'bookings': [self.booking_to_event(b) for b in bookings]}

    def get_raw_applications_list(self, **kwargs):
        user = self.app.user

        if user.is_manager:
            applications = self.app.dm.get_applications()
        else:
            applications = user.get_applications(status='all')

        return {'applications': applications}

    def get_forms_list(self, **kwargs):
        return  {'forms': self.app.dm.get_forms()}

    def get_raw_invoice_periods_list(self, **kwargs):
        return {'invoice_periods': self.app.dm.get_invoice_periods()}

    def get_raw_transactions_list(self, **kwargs):
        return {'transactions': self.app.dm.get_transactions()}

    def get_transaction_form(self, **kwargs):
        dm = self.app.dm
        transaction_id = kwargs['transaction_id']
        if transaction_id:
            t = dm.get_transaction_by(id=transaction_id)
        else:
            t = dm.Transaction(date=dt.datetime.now(),
                               amount=0,
                               comment='')

        return {
            'transaction': t,
            'pi_list': [u for u in dm.get_users() if u.is_pi]
        }

    def get_invoice_periods_list(self, **kwargs):
        c = 0
        periods = []

        for ip in self.app.dm.get_invoice_periods(orderBy='start'):
            p = {
                'id': ip.id,
                'status': ip.status,
                'start': ip.start,
                'end': ip.end,
                'period': pretty_quarter((ip.start, ip.end))
            }
            if ip.status != 'disabled':
                c += 1
                p['order'] = c
            else:
                p['order'] = 0
            periods.append(p)

        periods.sort(key=lambda p: p['order'], reverse=True)

        return {'invoice_periods': periods}

    def get_invoice_period_form(self, **kwargs):
        dm = self.app.dm
        invoice_period_id = kwargs['invoice_period_id']
        if invoice_period_id:
            ip = dm.get_invoice_period_by(id=invoice_period_id)
        else:
            ip = dm.InvoicePeriod(status='active',
                                 start=dt.datetime.now(),
                                 end=dt.datetime.now())

        return {
            'invoice_period': ip
        }

    def get_transactions_list(self, **kwargs):
        dm = self.app.dm  # shortcut
        period = dm.get_invoice_period_by(id=int(kwargs['period']))

        def _filter(t):
            return ((period.start < t.date < period.end) and
                    ('pi' not in kwargs or t.user.id == kwargs['pi'] ))

        transactions = [t for t in dm.get_transactions() if _filter(t)]
        transactions_dict = {}

        for t in transactions:
            user_id = t.user.id
            if user_id not in transactions_dict:
                transactions_dict[user_id] = 0
            transactions_dict[user_id] += int(float(t.amount))

        return {
            'transactions': transactions,
            'period': period,
            'transactions_dict': transactions_dict
        }

    def get_invoice_period(self, **kwargs):
        dm = self.app.dm  # shortcut
        period = dm.get_invoice_period_by(id=int(kwargs['period']))
        tabs = [
            {'label': 'overall',
             'template': 'time_distribution.html'
             },
            {'label': 'invoices',
             'template': 'invoices_list.html'
             },
            {'label': 'transactions',
             'template': 'transactions_list.html',
             }
        ]
        tab = kwargs.get('tab', tabs[0]['label'])
        data = {
            'period': period,
            'tabs': tabs,
            'selected_tab': tab,
            'base_url': flask.url_for('main',
                                 content_id='invoice_period',
                                 period=period.id,
                                 tab=tab)
        }

        report_args = {
            'start': pretty_date(period.start),
            'end': pretty_date(period.end),
            'details': kwargs.get('details', None),
            'group': kwargs.get('group', 1)
        }

        data.update(self.get_transactions_list(period=period.id))
        data.update(self.get_reports_invoices(**report_args))
        data.update(self.get_reports_time_distribution(**report_args))

        return data


    def get_projects_list(self, **kwargs):
        # FIXME Define access/permissions for other users
        return {'projects': self.app.dm.get_projects()}

    def get_project_form(self, **kwargs):
        dm = self.app.dm
        project_id = kwargs['project_id']
        if project_id:
            project = dm.get_project_by(id=project_id)
        else:
            user = self.app.user
            now = dm.now()
            project = dm.Project(status='active',
                                 date=now,
                                 last_update_date=now,
                                 last_update_user_id=user.id,
                                 title='',
                                 description='')
            if not self.app.user.is_manager:
                project.creation_user = project.user = user

        return {
            'project': project,
            'possible_owners': self.get_pi_labs()
        }

    def get_project_details(self, **kwargs):
        # FIXME Define access/permissions for other users
        user = self.app.user  # shortchut

        project = self.app.dm.get_project_by(id=kwargs['project_id'])

        if project is None:
            raise Exception("Invalid Project Id %s" % kwargs['project_id'])

        if not user.is_manager and not user.same_pi(project.user):
            raise Exception("You do not have permissions to see this project")


        entries = sorted(project.entries, key=lambda e: e.date, reverse=True)

        return {
            'project': project,
            'entries': entries,
            'entry_types': self.get_entry_types()
        }

    def get_entry_types(self):
        return {
            'grids_preparation':
                {'label': 'Grids Preparation',
                 'group': 1,
                 'iconClass': "fas fa-th fa-inverse",
                 'imageClass': "img--picture",
                 'report': "report_grids_preparation.html"
                 },
            'grids_storage':
                {'label': 'Grids Storage',
                 'group': 1,
                 'iconClass': "fas fa-box fa-inverse",
                 'imageClass': "img--picture",
                 'report': "report_grids_storage.html"
                 },
            'screening':
                {'label': 'Screening',
                 'group': 2,
                 'iconClass': "fas fa-search fa-inverse",
                 'imageClass': "img--location"
                 },
            'data_acquisition':
                {'label': 'Data Acquisition',
                 'group': 2,
                 'iconClass': "far fa-image fa-inverse",
                 'imageClass': "img--location",
                 'report': "report_data_acquisition.html"
                 },
            'note':
                {'label': 'Note',
                 'group': 3,
                 'iconClass': "fas fa-sticky-note fa-inverse",
                 'imageClass': "img--picture"
                 },
        }

    def get_entry_form(self, **kwargs):
        dm = self.app.dm
        now = dm.now()
        entry_id = kwargs['entry_id']
        if entry_id:
            entry = dm.get_entry_by(id=entry_id)
            if kwargs.get('copy_entry', False):
                entry.id = None
                entry.title = "Copy of " + entry.title
                entry.creation_date = now
                entry.creation_user_id = self.app.user.id
                entry.last_update_date = now
                entry.last_update_user_id = self.app.user.id
        else:
            project_id = kwargs['entry_project_id']
            project = dm.get_project_by(id=project_id)

            entry = dm.Entry(date=now,
                             creation_date=now,
                             creation_user_id=self.app.user.id,
                             last_update_date=now,
                             last_update_user_id=self.app.user.id,
                             type=kwargs['entry_type'],
                             project=project,
                             title='',
                             description='',
                             extra={})

        entry_type = self.get_entry_types()[entry.type]
        form_id = "entry_form:%s" % entry.type
        form = dm.get_form_by(name=form_id)
        if form:
            self.set_form_values(form, entry.extra.get('data', {}))
        return {
            'entry': entry,
            'entry_type_label': entry_type['label'],
            'definition': None if form is None else form.definition
        }

    def get_entry_report(self, **kwargs):
        dm = self.app.dm
        entry_id = kwargs['entry_id']
        entry = dm.get_entry_by(id=entry_id) if entry_id else None

        if entry is None:
            raise Exception("Please provide a valid Entry id. ")

        entry_type = self.get_entry_types()[entry.type]
        data = entry.extra['data']

        if not 'report' in entry_type:
            raise Exception("There is no Report associated with this Entry. ")

        images = {}

        for key, value in data.items():
            if key.endswith('_image'):
                fn = dm.get_entry_file(entry, key)
                if os.path.exists(fn):
                    _, ext = os.path.splitext(fn)
                    images[key] = 'data:image/%s;base64, ' + image.fn_to_base64(fn)

        # Group data rows by gridboxes (label)
        if entry.type in ['grids_preparation', 'grids_storage']:
            #TODO: Some possible validations
            #TODO:      - There are no more that 4 slots per gridbox
            #TODO:      - There are no duplicated slots
            table = data[entry.type + '_table']
            gridboxes = {}

            for row in table:
                label = row['gridbox_label']
                if label not in gridboxes:
                    gridboxes[label] = {}
                slots = map(int, row['gridbox_slot'])
                for s in slots:
                    gridboxes[label][s] = row

            data['gridboxes'] = gridboxes

        pi = entry.project.user.get_pi()
        # TODO: We should store some properties in EMhub and avoid this request
        pi_info = self.app.sll_pm.fetchAccountDetailsJson(pi.email) if pi else None

        return {
            'entry': entry,
            'entry_type': entry_type,
            'data': data,
            'images': images,
            'pi_info': pi_info
        }

    def get_grids_storage(self, **kwargs):
        return self.get_grids_cane(**kwargs)

    def get_grids_cane(self, **kwargs):

        dewars = defaultdict(lambda :defaultdict(dict))

        dewar = int(kwargs.get('dewar', 0) or 0)
        cane = int(kwargs.get('cane', 0) or 0)

        for puck in self.app.dm.get_pucks():
            d, c, p = puck.dewar, puck.cane, puck.position
            pucks = dewars[d][c]
            pucks[p] = {
                'position': p,
                'label': puck.label,
                'color': puck.color,
                'gridboxes': defaultdict(dict)
            }

        cond = "type=='grids_storage'"
        for entry in self.app.dm.get_entries(condition=cond):
            print(entry.type, entry.title)
            storage = entry.extra['data']['grids_storage_table']
            for row in storage:
                d = int(row['dewar_number'])
                c = int(row['cane_number'])
                p = int(row['puck_number'])
                slot = int(row['puck_position'])
                puck = dewars[d][c][p]
                slot_key = ','.join(row['gridbox_slot'])
                row['entry'] = entry
                puck['gridboxes'][slot][slot_key] = row
                print("  ", row['dewar_number'], row['cane_number'], row['puck_number'], '-', row['puck_position'], ":", row['gridbox_slot'])

        return {
            'dewars': dewars,
            'dewar': dewar if dewar in dewars else None,
            'cane': cane if dewar and cane in dewars[dewar] else None
        }

    def get_grids_puck(self, **kwargs):
        data = self.get_grids_cane(**kwargs)
        data['puck'] = int(kwargs.get('puck', 0) or 0)
        return data

    def get_raw_user_issues(self, **kwargs):
        users = self.get_users_list()['users']
        filterKey = kwargs.get('filter', 'noroles')
        filterName = '_filter_%s' % filterKey

        def _filter_noapp(u):
            """ Users with No Active Application """
            return not u.is_manager and not u.project_codes

        def _filter_noroles(u):
            """ Users with No Roles """
            return not u.is_manager and not u.roles

        _filter = locals()[filterName]

        new_users = [u for u in users if _filter(u)]

        return {'users': new_users,
                'filterDesc': _filter.__doc__
                }

    def get_raw_forms_list(self, **kwargs):
        return {'forms': [
            {'id': f.id,
             'name': f.name,
             'definition': json.dumps(f.definition)
        } for f in self.app.dm.get_forms()]}

    def get_raw_entries_list(self, **kwargs):
        return {
            'entries': self.app.dm.get_entries()
        }

    def get_raw_pucks_list(self, **kwargs):
        return {
            'pucks': self.app.dm.get_pucks()
        }

    def get_create_session_form(self, **kwargs):
        dm = self.app.dm  # shortcut
        booking_id = kwargs['booking_id']
        b = dm.get_bookings(condition="id=%s" % booking_id)[0]

        return {
            'booking': b,
            'cameras': dm.get_session_cameras(b.resource.id),
            'processing': dm.get_session_processing(),
            'session_name': dm.get_new_session_info(booking_id)['name']
        }

    # --------------------- Internal  helper methods ---------------------------
    def booking_to_event(self, booking, **kwargs):
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
        pi = owner.get_pi()
        o = booking.operator  #  shortcut
        if o:
            operator_dict = {'id': o.id, 'name': o.name}
        else:
            operator_dict = {'id': None, 'name': ''}

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
        if pi is not None:
            can_modify_list.append(pi.id)

        user_can_modify = user.is_manager or user.id in can_modify_list
        user_can_view = user_can_modify or user.same_pi(owner)
        color = resource.color if resource else 'grey'

        application_label = 'None'

        if booking.type == 'downtime':
            color = 'rgba(181,4,0,1.0)'
            title = "%s (DOWNTIME): %s" % (resource.name, b_title)
        if booking.type == 'maintenance' or any(k in b_title for k in ['cycle', 'installation', 'maintenance', 'afis']):
            color = 'rgba(255,107,53,1.0)'
            title = "%s (MAINTENANCE): %s" % (resource.name, b_title)
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

        bd = {
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
            'operator': operator_dict,
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
            'application_label': application_label,
            'costs': booking.costs,
            'total_cost': booking.total_cost
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

    def get_possible_operators(self):
        dm = self.app.dm

        if self.app.user.is_authenticated and self.app.user.is_manager:
            return [{'id': u.id, 'name': u.name}
                    for u in dm.get_users() if 'manager' in u.roles]
        return  []

    def get_booking_in_range(self, kwargs, asJson=True):
        """ Return the list of bookings in the given range.
         It will also attach PI information to each booking.
         This function is used from report functions.
         If 'start' and 'end' keys are not in kwargs, the current
         year quarter will be used for the range.
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

        def process_booking(b):
            if not asJson:
                return b
            return self.app.dc.booking_to_event(b, prettyDate=True, piApp=True)

        def _filter(b):
            return b.resource.daily_cost > 0 and not b.is_slot

        bookings = [process_booking(b) for b in bookings if _filter(b)]

        return bookings, d
