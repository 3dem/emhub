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
"""
Register content functions related to Sessions
"""
import os


def register_content(dc):
    def get_reports_time_distribution(**kwargs):

        def _booking_to_json(booking, **kwargs):
            bj = self.booking_to_event(booking, **kwargs)
            bj.update({
                'total_cost': booking.total_cost,
                'days': booking.days,
                'type': booking.type
            })
            return bj

        bookings, range_dict = self.get_booking_in_range(kwargs, bookingFunc=_booking_to_json)

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

    def get_reports_invoices(**kwargs):
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

            if app_id not in apps_dict:
                print(">>> Missing app: ", app_id)
                continue

            pi = b.owner.get_pi()

            if pi is None:
                print(">>>  None pi, user: ", b.owner.name)
                continue

            # Only take into account booking type (i.e no slot, downtime, etc)
            if not b.is_booking:
                continue

            try:
                update_pi_info(apps_dict[app_id][pi.id], b)
                update_pi_info(pi_dict[pi.id], b)

                if b.total_cost == 0:
                    print(">>> 0 cost booking!!!")
                    print(b.json())

            except KeyError:
                print("Got KeyError, app_id: %s, pi_id: %s"
                      % (app_id, pi.id))

        result = {
            'apps_dict': apps_dict,
            'pi_dict': pi_dict,
            'portal_users': portal_users,
            'group': int(kwargs.get('group', 1))
        }
        result.update(range_dict)

        return result

    def get_reports_invoices_lab(**kwargs):
        period = self.get_period(kwargs)
        pi_user = self.get_pi_user(kwargs)
        app = pi_user.get_applications()[-1]

        data = self.get_reports_invoices(**kwargs)
        data['apps_dict'] = {app.code: data['apps_dict'][app.code]}
        data['app'] = app
        data.update(self.get_transactions_list(period=period.id))
        data['period'] = period
        alias = app.alias
        data['details_title'] = app.code + (' (%s)' % alias if alias else '')

        return data

    def get_invoices_per_pi(**kwargs):
        pi_id = kwargs.get('pi_id', None)

        data = {'pi_id': pi_id,
                'pi_list': [u for u in self.app.dm.get_users() if u.is_pi],
                }

        if pi_id is None:
            return data

        pi_user = self.get_pi_user(kwargs)
        dm = self.app.dm  # shortcut

        def _filter(b):
            pi = b.owner.get_pi()
            return (b.resource.daily_cost > 0 and
                    b.start <= dm.now() and
                    b.is_booking and pi and pi.id == pi_user.id)

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

    def get_invoices_lab_list(**kwargs):

        period = self.get_period(kwargs)
        bookings, range_dict = self.get_booking_in_range(kwargs)

        pi_user = self.get_pi_user(kwargs)

        apps_dict = {a.id: [] for a in pi_user.get_applications()}
        all_bookings = []
        for b in bookings:
            if b.get('pi_id', None) != pi_user.id or b['type'] != 'booking':
                continue

            app_id = b.get('app_id', None)

            if app_id not in apps_dict:
                continue

            apps_dict[app_id].append(b)
            all_bookings.append(b)

        result = {
            'pi': pi_user,
            'apps_dict': apps_dict,
            'all_bookings': all_bookings,
            'total': sum(b['total_cost'] for b in all_bookings)
        }

        result.update(range_dict)
        result.update(self.get_transactions_list(period=period.id,
                                                 pi=pi_user.id))

        return result

    def get_reports_bookings_extracosts(**kwargs):
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

    def get_booking_costs_table(**kwargs):
        resources = self.app.dm.get_resources()

        return {'data': [(r.name, r.status, r.tags) for r in resources]}

    def get_report_microscopes_usage_content(**kwargs):
        return self.get_report_microscopes_usage(**kwargs)

    def get_report_microscopes_usage_entrylist(**kwargs):
        return self.get_report_microscopes_usage(**kwargs)

    def get_report_microscopes_usage(**kwargs):
        metric = kwargs.get('metric', 'days')
        use_data = metric == 'data'
        use_days = metric == 'days'

        self.check_user_access('usage_report')

        dm = self.app.dm  # shortcut
        centers = dm.get_config('sessions').get('centers', {})

        def _filter(b):
            return not b.is_slot

        app_id = int(kwargs.get('application', 0))
        selected_app = dm.get_application_by(id=app_id)
        applications = dm.get_visible_applications()
        if not selected_app:
            selected_app = applications[0]
            pi_list = [u.id for u in dm.get_users() if u.is_pi]
        else:
            pi_list = [pi.id for pi in selected_app.pi_list]

        bookings, range_dict = self.get_booking_in_range(kwargs,
                                                         asJson=False,
                                                         filter=_filter)
        entries_usage = {}
        total_usage = 0
        entries_down = {}
        total_down = 0
        key = kwargs.get('key', '')
        selected_entry = None
        total_days = 0
        totalDays = defaultdict(lambda: 0)
        resources_data_usage = defaultdict(lambda: list())

        report_resources = dm.get_config('reports')['resources']
        resources = [r for r in self.get_resources()['resources']
                     if r['name'] in report_resources]

        # selected resources
        if 'selected' in kwargs:
            selected = [int(p) for p in kwargs['selected'].split(',')]
        else:
            selected = [r['id'] for r in resources]

        def _value(b):
            return b.total_size if use_data else (b.units() if use_days else b.hours)

        for b in bookings:
            if b.resource_id not in selected:
                continue

            rid = b.resource.id
            b_value = _value(b)

            if b.type in ['downtime', 'maintenance', 'special']:
                entry_key = b.type
                entry_label = entry_key.capitalize()
                entry_email = ''
                entries = entries_down
                total_down += b_value
            else:
                if b.project:
                    pi = b.project.user.get_pi()
                else:
                    pi = b.owner.get_pi()
                if not pi or pi.id not in pi_list:
                    continue
                entry_key = str(pi.id)
                entry_label = centers.get(pi.email, pi.name)
                entry_email = pi.email
                entries = entries_usage
                total_usage += b_value
                totalDays[rid] += b_value
                ts = dt.datetime.timestamp(b.end)
                resources_data_usage[rid].append((ts * 1000, b_value))

            if entry_key not in entries:
                entries[entry_key] = entry = {
                    'key': entry_key,
                    'label': entry_label,
                    'email': entry_email,
                    'bookings': [],
                    'days': defaultdict(lambda: 0),
                    'data': defaultdict(lambda: {'size': 0, 'files': 0}),
                    'total_data': {'size': 0, 'files': 0},
                    'total_days': 0,
                    'users': set()
                }
            else:
                entry = entries[entry_key]

            entry['bookings'].append(b)
            entry['days'][rid] += b_value
            entry['total_days'] += b_value
            entry['users'].add(b.owner.email)

            total_days += b_value
            if key == entry_key:
                selected_entry = entry

        entries_sorted = [e for e in sorted(entries_usage.values(),
                                            key=lambda e: e['total_days'],
                                            reverse=True)]

        def _percent(value):
            return 100 / value if value > 0 else 0

        percent = _percent(total_days)
        percent_usage = _percent(total_usage)

        def _name(e):
            name = centers.get(e['email'], e['label'])
            return shortname(name)

        pie_data = [{'name': e['label'], 'y': e['total_days'] * percent}
                    for e in entries_down.values()]
        pie_data.append({'name': 'Usage', 'y': total_usage * percent})

        bar_data = [{
            'name': _name(e),
            'y': e['total_days'] * percent_usage,
            'drilldown': e['label']
        } for e in entries_sorted]

        drilldown_data = []

        for e in entries_sorted:
            percent = _percent(e['total_days'])
            usage = {}
            for b in e['bookings']:
                name = b.owner.name
                if name not in usage:
                    usage[name] = 0
                usage[name] += _value(b)

            drilldown_data.append({
                'name': _name(e),
                'id': e['label'],
                'data': [(k, v * percent) for k, v in usage.items()]
            })

        # Add a total entry
        entries_sorted.insert(0, {
            'key': 'Total', 'label': 'Total', 'email': '',
            'bookings': [], 'total_days': total_usage,
            'days': totalDays,
        })

        data_usage_series = []
        for r in resources:
            if r['id'] in selected:
                resources_data_usage[r['id']].sort(key=lambda item: item[0])
                data_usage_series.append({'name': r['name'],
                                          'color': r['color'],
                                          'data': resources_data_usage[r['id']]})

        data = {
            'entries': entries_sorted,
            'total_days': total_days,
            'total_usage': total_usage,
            'resources_dict': {r['id']: r for r in resources},
            'selected_resources': selected,
            'selected_entry': selected_entry,
            'applications': applications,
            'selected_app': selected_app,
            'pie_data': pie_data,
            'bar_data': bar_data,
            'drilldown_data': drilldown_data,
            'data_usage_series': data_usage_series,
            'resources': resources,
            'metric': metric,
            'use_data': use_data
        }
        data.update(range_dict)
        return data

    def get_report_pis_usage(**kwargs):

        bookings, range_dict = self.get_booking_in_range(kwargs, asJson=False)

        pi_dict = {}
        try:
            univ_dict = self.app.dm.get_universities_dict()
        except:
            univ_dict = {}

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
                        # 'email_rev': pi.email[::-1],  # reverse email for sorting
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
