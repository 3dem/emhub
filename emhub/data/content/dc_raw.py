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
import re
import json
import datetime as dt

import jinja2
import sqlalchemy
from emtools.utils import Pretty

# Workers status (Workers page), from their last connection or request:
# active (green) if seen in the last hour, inactive (yellow) if seen in the
# last week and not connected (grey) otherwise
WORKER_ACTIVE_TIME = dt.timedelta(hours=1)
WORKER_CONNECTED_TIME = dt.timedelta(days=7)


def register_content(dc):

    @dc.content
    def raw_forms_list(**kwargs):
        # Only managers by default if 'forms' permission is not defined
        dc.check_user_access('forms', ['manager'])

        def _is_config(f):
            """ Return true if this form seems like a config form.
            This is when there are not 'params' or 'sections'.
            """
            d = f.definition
            return not any(k in d for k in ['title', 'params', 'sections'])

        return {'forms': [
            {'id': f.id,
             'name': f.name,
             'definition': json.dumps(f.definition),
             'is_config': _is_config(f)
             } for f in dc.app.dm.get_forms()]}

    @dc.content
    def raw_entries_list(**kwargs):
        # id/type come from the URL, pass them as bound parameters
        params = {k: kwargs[k] for k in ['id', 'type'] if k in kwargs}
        condition = None
        if params:
            condStr = ' and '.join('%s=:%s' % (k, k) for k in params)
            condition = sqlalchemy.text(condStr).bindparams(**params)
        return {
            'entries': dc.app.dm.get_entries(condition=condition)
        }

    @dc.content
    def raw_booking_list(**kwargs):
        if 'user' in kwargs:
            # user comes from the URL and goes into the SQL condition
            uid = int(kwargs['user'])
            return {'bookings': dc.app.dm.get_user_bookings(uid)}

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
        kwargs['content_id'] = 'pucks'
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
        all_logs = [log for log in dm.get_logs()]
        logs = all_logs[-n:]

        for log in logs:
            log.user = dm.get_user_by(id=log.user_id)

        return {'logs': logs}

    @dc.content
    def pages(**kwargs):
        page_id = kwargs.get('page_id', '')

        if not re.fullmatch(r'[\w-]+', page_id):
            raise Exception(f"Invalid page id: '{page_id}'")

        if not dc.app.dm.check_page_access(page_id):
            raise Exception('Invalid access')

        try:
            template = dc.app.jinja_env.get_template(f'pages/{page_id}.md')
        except jinja2.TemplateNotFound:
            raise Exception(f"Page '{page_id}' not found")

        # Use the .md file modification time as the last update
        mtime = os.path.getmtime(template.filename)

        return {
            'page_id': page_id,
            'page': 'pages/%s.md' % page_id,
            'page_updated': dt.datetime.fromtimestamp(mtime)
        }

    @dc.content
    def page_body(**kwargs):
        """ Only the page content, without header (e.g. for a modal). """
        return pages(**kwargs)

    @dc.content
    def workers(**kwargs):
        dm = dc.app.dm
        workers = {}
        now = dt.datetime.now()
        seen = dm.get_workers_seen()
        for k, v in dm.get_hosts().items():
            workers[k] = w = dict(v)
            w['updated'] = seen.get(k, '')  # last request to the server
            times = []
            for key in ['updated', 'connected']:
                if value := w.get(key, ''):
                    t = Pretty.parse_datetime(value)
                    times.append(t)
                    w[f'{key}_elapsed'] = f"({Pretty.elapsed(t, now=now)})"
            # Status from the last connection or request to the server
            age = now - max(times) if times else None
            if age is not None and age < WORKER_ACTIVE_TIME:
                w['status'], w['badge'] = 'active', 'success'
            elif age is not None and age < WORKER_CONNECTED_TIME:
                w['status'], w['badge'] = 'inactive', 'warning'
            else:
                w['status'], w['badge'] = 'not connected', 'secondary'

        def _sort_key(item):
            """ Last request first, then last connection (missing ones last). """
            w = item[1]
            return (w.get('updated', ''), w.get('connected', ''))

        workers = dict(sorted(workers.items(), key=_sort_key, reverse=True))

        return {'workers': workers,
                'has_redis': dm.r is not None,
                'now': Pretty.now()
                }

    @dc.content
    def workers_content(**kwargs):
        return workers()

    @dc.content
    def task_history(**kwargs):
        return {'task_events': dc.app.dm.get_task_history(kwargs['task_id'])}

    @dc.content
    def session_log(**kwargs):
        session_id = int(kwargs['session_id'])
        log_id = f"log:session:{session_id}"
        data = log_events(log_id=log_id, **kwargs)
        data['session'] = dc.app.dm.get_session_by(id=session_id)
        return data

    @dc.content
    def log_events(**kwargs):
        log_id = kwargs['log_id']
        return {
            'log_id': log_id,
            'log_events': dc.app.dm.get_log_events(log_id),
            'title': f'Log {log_id}'
        }

    @dc.content
    def raw_test_page(**kwargs):
        return {}

    @dc.content
    def raw_projects_list(**kwargs):
        if 'status' not in kwargs:
            kwargs['status'] = None  # projects with any status
        if 'stats' not in kwargs:
            kwargs['stats'] = True
        data = dc.get_user_projects(dc.app.user, **kwargs)
        return data

    @dc.content
    def test_widget(**kwargs):
        return {}

    def _get_project_widget_data(data, project_id, project_path, entry_extra=None):
        """ Add the data needed by the project widget (project_widget.html)
        to the processing content data of a project. """
        pp = data['processing_project']
        pm = pp.project
        protocols = pp.get_workflow(widget=True)

        project_details = {
            'id': project_id,
            "name": project_path,
            "shortName": os.path.basename(project_path),
            "createdAt": "2025-09-13 15:29:00.670242+02:00",
            "status": "active",
            "path": project_path,
            'protocols': protocols,
            'tags': pm.getLabels()
        }

        from emhub.data.widget_menu import get_widget_menu, fix_widget_menu_icons

        pmenu = get_widget_menu()
        fix_widget_menu_icons(pmenu)

        data.update({
            'project_id': project_id,
            'project_details': project_details,
            'project_ids': [43, 871, 878],
            'project_entry_extra': entry_extra or {},
            'menu': pmenu
        })
        return data

    @dc.content
    def project_widget(**kwargs):
        project_id = int(kwargs['entry_id'])
        entry = dc.app.dm.get_entry_by(id=project_id)
        if entry is None:
            raise Exception(f"Unexisting tomo project with id: {project_id}")
        project_path = entry.extra['data'].get('processing_path', '')
        data = dc.get_data('processing_content', **kwargs)
        pm = data['processing_project'].project
        # Labels (tags) are stored in the project folder (.emhub/labels.json).
        # Migrate old labels stored in the entry's extra (DB) if needed.
        # The DB copy is kept for now, but no longer used.
        tags = entry.extra.get('tags')
        if tags and not pm.hasLabels():
            pm.importLabels(tags.get('project', []), tags.get('protocols', {}))

        # with open(f'project_{project_id}.json', 'w') as f:
        #     json.dump(project_details, f, indent=4)

        return _get_project_widget_data(data, project_id, project_path, entry.extra)

    @dc.content
    def session_workflow(**kwargs):
        """ Project widget for the OTF project of a session, from the session
        data_path (extra['otf']['path']), without registering the project. """
        session_id = int(kwargs['session_id'])
        session = dc.app.dm.get_session_by(id=session_id)
        if session is None:
            raise Exception(f"Unexisting session with id: {session_id}")
        from emhub.data.processing import get_processing_type, resolve_processing_path
        path = resolve_processing_path(session.data_path or '')
        if not path or get_processing_type(path) == 'unknown':
            raise Exception(f"No processing project found in the session "
                            f"OTF folder: '{session.data_path}'")
        data = dc.get_data('processing_content', session_id=session_id)
        project_path = data['processing_project'].path
        data['session'] = session
        data = _get_project_widget_data(data, session_id, project_path)
        # Links from the widget (e.g. the OTF dashboard) go to the session
        data['project_details']['session_id'] = session_id
        return data

    @dc.content
    def project_flowchart(**kwargs):
        data = project_widget(**kwargs)
        # Convert project_details into a flowchart workflow
        workflow = []
        for jobId, job in data['project_details']['protocols'].items():
            workflow.append({
                'id': jobId,
                'label': job['label'],
                'links': job['children'],
                'status': job['status'],
                'type': job.get('type', '')
            })
        data['workflow'] = workflow
        return data

    @dc.content
    def project_widget_fake(**kwargs):
        fake_id = kwargs['fake_id']
        project_id = int(fake_id)
        from emhub.data.fake_projects import load_json
        project_json = load_json(project_id)
        return {
            'project_json': project_json
        }


