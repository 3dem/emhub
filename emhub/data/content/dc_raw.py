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
import json

import datetime as dt
from emtools.utils import Pretty


def register_content(dc):

    @dc.content
    def raw_forms_list(**kwargs):
        dc.check_user_access('forms')

        return {'forms': [
            {'id': f.id,
             'name': f.name,
             'definition': json.dumps(f.definition)
             } for f in dc.app.dm.get_forms()]}

    @dc.content
    def raw_entries_list(**kwargs):
        cond = ['%s="%s"' % (k, kwargs[k]) for k in ['id', 'type'] if k in kwargs]
        return {
            'entries': dc.app.dm.get_entries(condition=' and '.join(cond))
        }

    @dc.content
    def raw_booking_list(**kwargs):
        return {'bookings': dc.app.dm.get_bookings()}

    @dc.content
    def raw_applications_list(**kwargs):
        return {'applications': dc.app.dm.get_visible_applications()}

    @dc.content
    def raw_templates_list(**kwargs):
        return {'templates': dc.app.dm.get_templates()}

    @dc.content
    def forms_list(**kwargs):
        return {'forms': dc.app.dm.get_forms()}

    @dc.content
    def raw_invoice_periods_list(**kwargs):
        return {'invoice_periods': dc.app.dm.get_invoice_periods()}

    @dc.content
    def raw_transactions_list(**kwargs):
        return {'transactions': dc.app.dm.get_transactions()}

    @dc.content
    def raw_user_issues(**kwargs):
        filterKey = kwargs.get('filter', 'noroles')
        args = {}
        if filterKey == 'noactive':
            args['status'] = 'all'
        users = dc.get_users_list(**args)['users']
        filterName = '_filter_%s' % filterKey

        def _filter_noapp(u):
            """ Users with No Active Application """
            return not u.is_manager and not u.project_codes

        def _filter_noroles(u):
            """ Users with No Roles """
            return not u.is_manager and not u.roles

        def _filter_noactive(u):
            """ Users No Active. """
            return u.status != 'active'

        _filter = locals()[filterName]

        new_users = [u for u in users if _filter(u)]

        return {'users': new_users,
                'filterDesc': _filter.__doc__
                }

    @dc.content
    def raw_pucks_list(**kwargs):
        kwargs['content_id'] = 'grids_cane'
        return dc.get(**kwargs)

    @dc.content
    def dynamic_form_modal(**kwargs):
        form_id = int(kwargs.get('form_id', 1))
        form = dc.app.dm.get_form_by(id=form_id)

        if form is None:
            raise Exception("Invalid form id: %s" % form_id)

        return dc.dynamic_form(form, **kwargs)

    @dc.content
    def logs(**kwargs):
        dm = dc.app.dm
        n = int(kwargs.get('n', 100))
        name = kwargs.get('name', '')
        all_logs = [log for log in dm.get_logs() if log.name == name]
        logs = all_logs[-n:]

        for log in logs:
            log.user = dm.get_user_by(id=log.user_id)

        return {'logs': logs}

    @dc.content
    def pages(**kwargs):
        page_id = kwargs['page_id']
        page_path = os.path.join(dc.app.config['PAGES'], '%s.md' % page_id)

        return {
            'page_id': page_id,
            'page': 'pages/%s.md' % page_id
        }

    @dc.content
    def workers(**kwargs):
        dm = dc.app.dm
        workers = {}
        now = dt.datetime.now()
        for k, v in dm.get_hosts().items():
            workers[k] = w = dict(v)
            updated = w.get('updated', '')
            active = False
            if updated:
                u = Pretty.parse_datetime(updated)
                td = now - u
                active = td < dt.timedelta(minutes=2)
                #v['updated'] = updated + f" ({Pretty.elapsed(u, now=now)})"
                w['elapsed'] = f"({Pretty.elapsed(u, now=now)})"

            w.update({
                'has_specs': bool(w.get('specs', '')),
                'active': active
            })
        return {'workers': workers,
                'taskGroups': {h: tasks for h, tasks in dm.get_all_tasks()},
                'now': Pretty.now()
                }

    @dc.content
    def workers_content(**kwargs):
        return workers()

    @dc.content
    def task_history(**kwargs):
        return {'task_events': dc.app.dm.get_task_history(kwargs['task_id'])}

    @dc.content
    def workers_frames(**kwargs):
        # Some optional parameters
        days = int(kwargs.get('days', 0))
        td = dt.timedelta(days=days)

        sortKey = kwargs.get('sort', 'ts')
        reverse = int(kwargs.get('reverse', 1))

        dm = dc.app.dm
        hosts = dm.get_hosts()

        folderGroups = {}
        # TODO: Get worker that monitor cluster from config
        for h, host in hosts.items():
            ws = dm.get_worker_stream(h)
            for t in ws.get_all_tasks():
                if t['name'] == 'frames' and t['status'] == 'pending':
                    event_id, event = dm.get_task_lastevent(t['id'])
                    entries = json.loads(event['entries'])
                    usage = json.loads(event['usage'])
                    folders = []
                    now = dm.now()
                    for e in entries:
                        ddt = dm.dt_from_timestamp(e['ts'])
                        if days == 0 or now - ddt < td:
                            e['modified'] = ddt
                            folders.append(e)

                    folders.sort(key=lambda f: f[sortKey], reverse=bool(reverse))
                    folderGroups[h] = {'usage': usage, 'entries': folders}
                    break

        return {
            'folderGroups': folderGroups
        }
