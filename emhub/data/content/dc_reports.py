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
import datetime as dt
from collections import defaultdict
from random import shuffle
import json

from emtools.utils import Pretty, Color
from emhub.utils import (shortname, get_quarter, pretty_quarter, pretty_date,
                         datetime_from_isoformat)


def register_content(dc):
    import flask

    @dc.content
    def reports_time_distribution(**kwargs):

        def _booking_to_json(b, **kwargs):
            bj = dc.booking_to_event(b, **kwargs)
            bj.update({
                'total_cost': dc.app.booking_cost(b),
                'days': b.days,
                'type': b.type
            })
            return bj

        bookings, range_dict = dc.get_booking_in_range(kwargs, bookingFunc=_booking_to_json)

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

        app_dict = {a.code: a.alias for a in dc.app.dm.get_applications()}
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

    @dc.content
    def reports_invoices(**kwargs):
        bookings, range_dict = dc.get_booking_in_range(kwargs, asJson=False)

        if hasattr(dc.app, 'sll_pm'):  # Portal Manager
            portal_users = {
                pu['email']: pu for pu in dc.app.sll_pm.fetchAccountsJson()
                if pu['pi']
            }
        else:
            portal_users = {}

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
            pi_info['sum_cost'] += dc.app.booking_cost(b)
            pi_info['sum_days'] += b.days

        # Create a dictionary where pi/bookings are grouped by Application
        # and another one grouped by pi
        apps_dict = {}
        pi_dict = {}

        for a in dc.app.dm.get_applications():
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

                if dc.app.booking_cost(b) == 0:
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

    @dc.content
    def reports_invoices_lab(**kwargs):
        period = dc.get_period(kwargs)
        pi_user = dc.get_pi_user(kwargs)
        app = pi_user.get_applications()[-1]

        data = dc.get_reports_invoices(**kwargs)
        data['apps_dict'] = {app.code: data['apps_dict'][app.code]}
        data['app'] = app
        data.update(transactions_list(period=period.id))
        data['period'] = period
        alias = app.alias
        data['details_title'] = app.code + (' (%s)' % alias if alias else '')

        return data

    @dc.content
    def invoices_per_pi(**kwargs):
        pi_id = kwargs.get('pi_id', None)

        data = {'pi_id': pi_id,
                'pi_list': [u for u in dc.app.dm.get_users() if u.is_pi],
                }

        if pi_id is None:
            return data

        pi_user = dc.get_pi_user(kwargs)
        dm = dc.app.dm  # shortcut

        def _filter(b):
            pi = b.owner.get_pi()
            return (b.resource.daily_cost > 0 and
                    b.start <= dm.now() and
                    b.is_booking and pi and pi.id == pi_user.id)

        entries = []

        for b in dm.get_bookings():
            if _filter(b):
                entries.append({'id': b.id,
                                'title': dc.booking_to_event(b)['title'],
                                'date': b.start,
                                'amount': dc.app.booking_cost(b),
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

        invoice_periods = dc.get_invoice_periods_list()['invoice_periods']
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

    @dc.content
    def invoices_lab_list(**kwargs):

        def _booking(b, **kwargs):
            bjson = dc.booking_to_event(b, **kwargs)
            bjson['total_cost'] = dc.app.booking_cost(b)
            return bjson

        period = dc.get_period(kwargs)
        bookings, range_dict = dc.get_booking_in_range(kwargs, bookingFunc=_booking)

        pi_user = dc.get_pi_user(kwargs)

        apps_dict = {a.id: [] for a in pi_user.get_applications()}
        all_bookings = []
        for b in bookings:
            if b.get('pi_id', None) != pi_user.id:  # or b.get('type', '') != 'booking':
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
        result.update(transactions_list(period=period.id, pi=pi_user.id))

        return result

    @dc.content
    def reports_bookings_extracosts(**kwargs):
        all_bookings, range_dict = dc.get_booking_in_range(kwargs)

        u = dc.app.user
        if not u.is_manager:
            raise Exception("Only manager users can access this page")

        bookings = []

        for b in all_bookings:
            if len(b['costs']):
                bookings.append(b)

        q1 = get_quarter()
        q0 = get_quarter(q1[0] - dt.timedelta(days=1))

        transactions_list(**kwargs)

        result = {
            'bookings': bookings,
            'q0': q0,
            'q1': q1
        }

        result.update(range_dict)

        return result

    def booking_costs_table(**kwargs):
        resources = dc.app.dm.get_resources()

        return {'data': [(r.name, r.status, r.tags) for r in resources]}

    @dc.content
    def report_microscopes_usage(**kwargs):
        metric = kwargs.get('metric', 'all')

        metric_all = {
            'data': {'_value': lambda b: b.total_size},
            'days': {'_value': lambda b: b.units(hours=12)},
            'images': {'_value': lambda b: b.total_images},
            'count': {'_value': lambda b: 1}
            #'hours': {'_value': lambda b: b.hours}
        }

        use_all = metric == 'all'
        use_data = metric == 'data'
        use_days = metric == 'days'

        dc.check_user_access('usage_report')

        dm = dc.app.dm  # shortcut
        centers = dm.get_config('sessions').get('centers', {})
        groups = dm.get_config('sessions').get('groups', {})

        colors = [
            '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#ffe119',
            '#008080', '#f032e6', '#bcf60c', '#fabebe',  '#e6beff', '#9a6324',
            '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075',
            '#808080', '#000000', '#e6194b'
        ]

        pi_colors = {}
        groups_colors = dm.get_config('reports').get('groups_colors', None)

        types_colors = {
            'downtime': '#B22222',
            'cryo-cycle': '#ffd580',
            'maintenance': '#FF7F50',
            'repair': '#FF4B33',
            'training': '#702963',
            'special': '#20B2AA'
        }

        def _pi_color(pi_email):
            if groups_colors:
                return groups_colors.get(groups.get(pi_email, ''), '#E8F0F2')
            else:
                return pi_colors[pi_email]

        def _filter(b):
            return not b.is_slot

        app_id = kwargs.get('application', 'all')

        applications = [a for a in dm.get_visible_applications() if a.is_active]
        app = applications[0]
        selected_apps = [app]

        pi_list = []
        pi_apps = {}
        for app in selected_apps:
            for pi in app.pi_list:
                pi_list.append(pi.id)
                pi_apps[pi.id] = app
                if pi.email not in pi_colors:
                    i = len(pi_colors) % len(colors)
                    pi_colors[pi.email] = colors[i]

        bookings, range_dict = dc.get_booking_in_range(kwargs,
                                                       asJson=False,
                                                       filter=_filter)
        entries_usage = {}
        entries_operators = {}
        entries_down = {}
        total_down = 0
        total_days = 0
        key = kwargs.get('key', '')
        selected_entry = None
        resources_data_usage = defaultdict(lambda: list())

        report_resources = dm.get_config('reports')['resources']
        resources = [r for r in dc.get_resources()['resources']
                     if r['name'] in report_resources]
        resources_dict = {r['id']: r for r in resources}

        if 'r' in kwargs:
            selected_resources = [int(v) for v in kwargs['r'].split(',')]
        elif 'selected_resources' in kwargs:
            selected_resources = [int(v) for v in json.loads(kwargs['selected_resources'])]
        else:
            selected_resources = [r['id'] for r in resources]

        def _entry(key, label, app='', email='', total_days=0, color=''):
            return {
                'key': key,
                'app': app,
                'label': label,
                'email': email,
                'bookings': [],
                'values': {k: 0 for k in metric_all},
                'days': defaultdict(lambda: 0),
                'data': defaultdict(lambda: {'size': 0, 'files': 0}),
                'total_days': total_days,
                'total_data': {'size': 0, 'files': 0},
                'users': set(),
                'color': color,
                'projects': []
            }

        def _values(b):
            return {k: v['_value'](b) for k, v in metric_all.items()}

        def _add_values(e, values):
            for k, v in values.items():
                e['values'][k] += v
            e['total_days'] += values['days']

        total_entry = _entry('Total', 'Total', )

        calendar_days = defaultdict(lambda: defaultdict(lambda: 0))
        calendar_dates = {}
        from datetime import timedelta

        dm = dc.app.dm

        def _register(b, category):
            """ Register all day type of bookings. """
            start = dm.dt_as_local(b.start)
            end = dm.dt_as_local(b.end)
            d = start.date()
            # print(f"{category}: booking: {b}")
            while d <= end.date():
                dkey = Pretty.date(d)
                calendar_days[dkey][category] += b.hours
                calendar_dates[dkey] = d
                # print(f"       - day: {Pretty.date(d)}")
                d += timedelta(days=1)

        for b in bookings:
            rid = b.resource.id
            if rid not in selected_resources:
                continue

            b_values = _values(b)
            entry_app = ''
            entry_project = None

            if b.type in types_colors:
                entry_key = b.type
                entry_label = entry_key.capitalize()
                entry_email = ''
                entries = entries_down
                total_down += b_values['days']
                entry_color = types_colors[entry_key]
                _register(b, b.type)
            else:
                if b.project:
                    pi = b.project.user.get_pi()
                    entry_project = b.project.id
                else:
                    pi = b.owner.get_pi()
                if not pi or pi.id not in pi_list:
                    # Still count toward calendar utilization (pie); only PI
                    # attribution for bar charts is skipped below.
                    _register(b, "used")
                    continue
                entry_key = str(pi.id)
                entry_app = pi_apps[pi.id].code
                entry_label = centers.get(pi.email, pi.name)
                entry_email = pi.email
                entry_color = _pi_color(entry_email)
                entries = entries_usage
                _add_values(total_entry, b_values)
                _register(b, "used")
                ts = dt.datetime.timestamp(b.end)
                resources_data_usage[rid].append((ts * 1000, b_values['data']))

                # Store entries by operator
                if op := b.operator:
                    if op.is_staff:
                        opKey = op.name if op else 'Unknown'
                        if opKey not in entries_operators:
                            entries_operators[opKey] = _entry(opKey, opKey)
                        entry_op = entries_operators[opKey]
                        entry_op['days'][rid] += 1
                        entry_op['total_days'] += 1

            if entry_key not in entries:
                entries[entry_key] = _entry(entry_key, entry_label,
                                            entry_app, entry_email,
                                            color=entry_color)

            entry = entries[entry_key]
            entry['bookings'].append(b)
            _add_values(entry, b_values)
            entry['users'].add(b.owner.email)

            if entry_project:
                if entry_project not in entry['projects']:
                    entry['projects'].append(entry_project)
                if entry_project not in total_entry['projects']:
                    total_entry['projects'].append(entry_project)

            total_days += b_values['days']
            if key == entry_key:
                selected_entry = entry

        def _percent(value):
            return 100 / value if value > 0 else 0

        percent = _percent(total_days)
        total_usage = total_entry['total_days']
        total_sessions = total_entry['values']['count']
        percent_usage = _percent(total_sessions)

        def _name(e):
            name = centers.get(e['email'], e['label'])
            return shortname(name)

        def _sorted_entries(values):
            for v in sorted(values, key=lambda x: x['total_days'], reverse=True):
                yield v

        def _days_value(v):
            return v / 2 if use_days else v

        entries_sorted = list(_sorted_entries(entries_usage.values()))

        # Compute used and unused days per microscope based on
        # total days minus usage (including maintenance, downtime, or special).
        # Use facility-local calendar bounds (same as get_bookings_range /
        # _get_range); _register uses local dates from dm.dt_as_local.
        range_start = datetime_from_isoformat(
            range_dict['start'].replace('/', '-'))
        range_end = datetime_from_isoformat(
            range_dict['end'].replace('/', '-'))
        start = dm.date(range_start.date())
        end = dm.date(range_end.date())
        print(f">>>> start: {Pretty.datetime(start)}:", flush=True)
        print(f">>>> end: {Pretty.datetime(end)}:", flush=True)

        period_days = (end.date() - start.date()).days + 1
        period_units = period_days * 2

        calendar_max = defaultdict(lambda: 0)

        for k in sorted(calendar_days):
            data = calendar_days[k]
            print(f">>>> {k}:", flush=True)
            max_k = None
            max_v = 0
            for k2, v2 in data.items():
                if v2 > max_v:
                    max_v = v2
                    max_k = k2
            if max_k:
                all_str = ','.join(f'{k2}: {v2}' for k2, v2 in data.items())
                print(f"       - ALL: {all_str}", flush=True)
                print(f"       - MAX: {max_k}: {max_v}", flush=True)
                d = calendar_dates[k]
                # Only update stats when the date is in range
                if not (d < start.date() or d > end.date()):
                    calendar_max[max_k] += 1

        # for k, v in calendar_max.items():
        #     print(f">>>> MAX: {k}: {v}", flush=True)

        for k, v in entries_down.items():
            v['total_days'] = calendar_max.get(k, 0) * 2
        total_usage = calendar_max.get('used', 0) * 2

        other_total = sum(e['total_days'] for e in entries_down.values())
        unused_total = period_units - total_usage - other_total
        #
        print(">>>> period_days: ", period_days, flush=True)
        print(">>>> other_total: ", other_total, flush=True)
        print(">>>> unused_total: ", unused_total, flush=True)

        used_entry = _entry(key='used', label='Used', total_days=total_usage,
                            color='#3CB371')
        unused_entry = _entry(key='unused', label='Unused', total_days=unused_total,
                              color='#D3D3D3')
        entries_down.update({'used': used_entry, 'unused': unused_entry})
        percent_pie = _percent(period_units)
        pie_data = [{'name': e['label'], 'y': e['total_days'] * percent_pie,
                     'color': e['color'],
                     'days': _days_value(e['total_days'])}
                    for e in entries_down.values()]

        drilldown_data = []
        bar_data = [{
            'name': _name(e),
            'color': e['color'],
            'days': e['values']['count'],
            'data': e['values']['data'],
            'y': e['values']['count'] * percent_usage,
            'drilldown': e['label']
        } for e in entries_sorted]

        for e in entries_sorted:
            percent = _percent(e['total_days'])
            usage = {}
            for b in e['bookings']:
                name = b.owner.name
                if name not in usage:
                    usage[name] = 0
                usage[name] += _values(b)['days']

            drilldown_data.append({
                'name': _name(e),
                'id': e['label'],
                'data': [(k, v * percent) for k, v in usage.items()]
            })

        # Add a total entry
        entries_sorted.insert(0, total_entry)
        periodStr = start.strftime('%b %y')
        if period_days > 31:
            periodStr += ' - ' + end.strftime('%b %y')

        overall_values = defaultdict(lambda: 0)
        overall_values.update({k: v['total_days'] / 2
                               for k, v in entries_down.items()})

        data = {
            'entries': entries_sorted,
            'entries_down': overall_values,
            # 'entries_overall': entries_overall,
            'entries_operators': list(_sorted_entries(entries_operators.values())),
            'total_days': total_days,
            'total_usage': total_usage,
            'resources_dict': resources_dict,
            #'resource': resource,
            'selected_resources': selected_resources,
            'selected_entry': selected_entry,
            'applications': applications,
            'selected_apps': selected_apps,
            'n_apps': len(selected_apps),
            'app_id': app_id,
            'pie_data': pie_data,
            'bar_data': bar_data,
            'drilldown_data': drilldown_data,
            'resources': resources,
            'metric': metric,
            'use_data': use_data,
            'use_days': use_days,
            'use_all': use_all,
            'start_date': start,
            'end_date': end,
            'period_days': period_days,
            'period': periodStr,
            'total_sessions': total_sessions,
            'types_colors': types_colors
        }
        data.update(range_dict)
        return data

    @dc.content
    def report_microscopes_usage_content(**kwargs):
        return report_microscopes_usage(**kwargs)

    @dc.content
    def report_sessions_distribution(**kwargs):
        data = report_microscopes_usage(**kwargs)
        dm = dc.app.dm  # shortcut
        sessions = dm.get_sessions()
        selected_resources = data['selected_resources']
        start_date = data['start_date']
        end_date = data['end_date']
        sessions_images = []
        sessions_size = []
        active_users = {}
        biggest = [0, 0]

        all_users = {u.email: u for u in dm.get_users()}
        active_emails = set()

        for e in data['entries']:
            for u in e.get('users', []):
                active_emails.add(u)

        # Create monthly histogram for plotting (Highcharts)
        sessions_monthly = defaultdict(lambda: [0, 0, 0])
        # Distinct booking owners per calendar year and instrument (for users_yearly)
        users_yearly_emails = defaultdict(lambda: defaultdict(set))
        for s in sessions:
            movies = s.total_movies
            b = s.booking

            if (s.resource_id not in selected_resources or b is None):
                continue

            users_yearly_emails[s.start.year][s.resource_id].add(b.owner.email)

            if movies <= 100 or b.start < start_date or b.end > end_date:
                continue
            
            dkey = s.start.strftime('%Y-%m-01')
            sm = sessions_monthly[dkey]
            sm[0] += 1
            size = s.total_size
            sm[1] += size
            sm[2] += movies
            if movies > biggest[0]:
                biggest = [movies, size]
            sessions_images.append(movies)
            sessions_size.append(size)
            active_emails.add(b.owner.email)

        n = len(sessions_images)

        active_pi = defaultdict(lambda: [])
        for userEmail in active_emails:
            user = all_users[userEmail]
            pi = user.get_pi()
            active_pi[pi.email].append(user)

        users_monthly = defaultdict(lambda: 0)

        def _add_user(user):
            if user.email not in active_users:
                dkey = user.created.strftime('%Y-%m-01')
                users_monthly[dkey] += 1
                active_users[user.email] = user

        for piEmail, users in active_pi.items():
            _add_user(all_users[piEmail])
            for user in users:
                _add_user(user)

        users_monthly_data = []
        total = 0
        for k in sorted(users_monthly.keys()):
            total += users_monthly[k]
            users_monthly_data.append((k, total))

        users_yearly = {}
        for year in sorted(users_yearly_emails.keys()):
            by_resource = {}
            year_emails = set()
            for rid in selected_resources:
                emails = users_yearly_emails[year].get(rid, set())
                by_resource[rid] = len(emails)
                year_emails.update(emails)
            users_yearly[year] = {
                'by_resource': by_resource,
                'total': len(year_emails),
            }

        data.update(
            {'sessions': sessions,
             'sessions_monthly': [(k, v[0], v[1], v[2]) for k, v in sessions_monthly.items()],
             'users_monthly': users_monthly_data,
             'users_yearly': users_yearly,
             'sessions_images': sessions_images,
             'sessions_size': sessions_size,
             'avg_images': sum(sessions_images) // n,
             'avg_size': sum(sessions_size) // n,
             'active_users': active_users,
             'biggest': '%d images (%s)' % (biggest[0], Pretty.size(biggest[1]))
        })

        return data

    @dc.content
    def report_sessions_distribution_content(**kwargs):
        return report_sessions_distribution(**kwargs)

    @dc.content
    def report_projects_overview(**kwargs):
        data = report_sessions_distribution(**kwargs)
        projects_monthly = defaultdict(lambda : [0, set()])

        for p in dc.app.dm.get_projects():
            dkey = p.creation_date.strftime('%Y-%m-01')
            projects_monthly[dkey][0] += 1

        for s in dc.app.dm.get_sessions():
            b = s.booking
            p = s.project
            if p:
                dkey = s.start.strftime('%Y-%m-01')
                projects_monthly[dkey][1].add(p.id)

        data.update({
            'projects_monthly': [(k, v[0], len(v[1]))
                                 for k, v in sorted(projects_monthly.items(), key=lambda kv: kv[0])],
        })
        return data


    @dc.content
    def report_microscopes_usage_entrylist(**kwargs):
        return report_microscopes_usage(**kwargs)

    @dc.content
    def report_pis_usage(**kwargs):

        bookings, range_dict = dc.get_booking_in_range(kwargs, asJson=False)

        pi_dict = {}
        try:
            univ_dict = dc.app.dm.get_universities_dict()
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


    @dc.content
    def invoice_periods_list(**kwargs):
        c = 0
        periods = []

        for ip in dc.app.dm.get_invoice_periods(orderBy='start'):
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

    @dc.content
    def invoice_period_form(**kwargs):
        dm = dc.app.dm
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

    @dc.content
    def transactions_list(**kwargs):
        dm = dc.app.dm  # shortcut
        period = dm.get_invoice_period_by(id=int(kwargs['period']))

        def _filter(t):
            return ((period.start < t.date < period.end) and
                    ('pi' not in kwargs or t.user.id == kwargs['pi']))

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

    @dc.content
    def invoice_period(**kwargs):
        dm = dc.app.dm  # shortcut
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

        data.update(transactions_list(period=period.id))
        data.update(reports_invoices(**report_args))
        data.update(reports_time_distribution(**report_args))

        return data

    @dc.content
    def transaction_form(**kwargs):
        dm = dc.app.dm
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

    @dc.content
    def report_raw_data(**kwargs):
        dsJsonFile = os.path.expanduser('~/all.json')

        with open(dsJsonFile) as f:
            dsJson = json.load(f)

        cols = ['Group', 'Total-DS', 'Total-Size', 'Total-SizeHidden']
        rows = []

        total_count = 0
        total_size = 0

        years = range(2021, 2026)

        hiddenCols = []

        def _addHidden(index):
            hiddenCols.extend([
                {'targets': index, 'visible': False},
                {'targets': index - 1, 'orderData': [index]}
            ])

        _addHidden(3)

        for year in years:
            cols.append(f"{year}-DS")
            cols.append(f"{year}-Size")
            _addHidden(len(cols))
            cols.append(f"{year}-SizeHidden")

        for g, datasets in dsJson.items():
            size = sum(ds['size'] for ds in datasets)
            count = len(datasets)
            yearsSize = defaultdict(lambda: 0)
            yearsCount = defaultdict(lambda: 0)

            total_size += size
            total_count += count
            for ds in datasets:
                year = int(ds['year'])
                yearsSize[year] += ds['size']
                yearsCount[year] += 1

            newRow = {
                'Group': g,
                'Total-DS': count,
                'Total-Size': Pretty.size(size),
                'Total-SizeHidden': size
            }
            for year in years:
                newRow[f"{year}-DS"] = yearsCount[year]
                newRow[f"{year}-Size"] = Pretty.size(yearsSize[year])
                newRow[f"{year}-SizeHidden"] = yearsSize[year]

            rows.append(newRow)

        totalRow = {
            'Group': 'Total',
            'Total-DS': total_count,
            'Total-Size': Pretty.size(total_size),
            'Total-SizeHidden': total_size
        }
        # Compute totals per year
        for year in years:
            for col in [f"{year}-DS", f"{year}-SizeHidden"]:
                totalRow[col] = sum(row[col] for row in rows)
            totalRow[f"{year}-Size"] = Pretty.size(totalRow[f"{year}-SizeHidden"])

        rows.append(totalRow)

        return {
            'columns': cols,
            'rows': rows,
            'hidden': hiddenCols
        }


