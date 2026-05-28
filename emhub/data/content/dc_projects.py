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
import json
import os
import flask
import datetime as dt

from emtools.utils import Path
from emtools.image import Thumbnail


def register_content(dc):

    @dc.content
    def projects_list(**kwargs):
        if 'stats' not in kwargs:
            kwargs['stats'] = True
        return dc.get_user_projects(dc.app.user, **kwargs)

    @dc.content
    def projects_list_table(**kwargs):
        return projects_list(**kwargs)

    @dc.content
    def project_form(**kwargs):
        dm = dc.app.dm
        project_id = kwargs['project_id']
        if project_id:
            project = dm.get_project_by(id=project_id)
        else:
            user = dc.app.user
            now = dm.now()
            project = dm.Project(status='active',
                                 date=now,
                                 last_update_date=now,
                                 last_update_user_id=user.id,
                                 title='',
                                 description='',
                                 extra={'user_can_edit': True})
            if not user.is_manager:
                project.creation_user = project.user = user

        return {
            'project': project,
            'pi_labs': dc.get_pi_labs(all=True)
        }

    @dc.content
    def project_details(**kwargs):
        user = dc.app.user  # shortchut
        dm = dc.app.dm  # shortcut

        project = dm.get_project_by(id=kwargs['project_id'])

        if project is None:
            raise Exception("Invalid Project Id %s" % kwargs['project_id'])

        if not (user.can_edit_project(project) or user.same_pi(project.user)):
            raise Exception("You do not have permissions to see this project")

        config = dm.get_config('projects')
        project_perms = dm.get_config('permissions')['projects']

        def ekey(e):
            if isinstance(e, dm.Booking):  # e.type == 'booking':
                return e.start, e.start
            else:
                return e.date, e.creation_date

        def _update(e):
            """ Format entries depending on their type.
            Hardcoded for now :(
            """
            if e.type == 'access_microscopes':
                t = 'Incomplete Request (select microscope)'
                data = e.extra['data']
                if micid := data.get('microscope_id', None):
                    mic = dm.get_resource_by(id=int(micid))
                    if mic:
                        t = f"Request for {mic.name}"
                        if sample := data.get('sample_name', None):
                            t += f": {sample}"
                e.title = t
            return e

        entries = [_update(e) for e in project.entries]

        # Find all sessions related to this project and their bookings
        bookings = set()

        def _new_booking(b):
            return b.type == 'booking' and b.id not in bookings

        for s in dm.get_sessions():
            if s.project == project:
                b = s.booking
                if _new_booking(b):
                    entries.append(b)
                    bookings.add(b.id)

        entries.extend([b for b in project.bookings if _new_booking(b)])
        entries.sort(key=ekey, reverse=True)

        return {
            'project': project,
            'entries': entries,
            'config': config,
            'user_can_edit_entry': project_perms.get('user_can_edit_entry', False)
        }

    @dc.content
    def entry_form(**kwargs):
        dm = dc.app.dm
        user_id = dc.app.user.id
        now = dm.now()
        entry_id = kwargs['entry_id']
        read_only = bool(int(kwargs.pop('read_only', 0)))

        if entry_id:
            entry = dm.get_entry_by(id=entry_id)
            if kwargs.get('copy_entry', False):
                entry.id = None
                entry.title = "Copy of " + entry.title
                entry.creation_date = now
                entry.creation_user_id = user_id
                entry.last_update_date = now
                entry.last_update_user_id = user_id
        else:
            project_id = kwargs['entry_project_id']
            project = dm.get_project_by(id=project_id)

            entry = dm.Entry(date=now,
                             creation_date=now,
                             creation_user_id=user_id,
                             last_update_date=now,
                             last_update_user_id=user_id,
                             type=kwargs['entry_type'],
                             project=project,
                             title='',
                             description='',
                             extra={})

        entry_config = dm.get_entry_config(entry.type)
        form_id = "entry_form:%s" % entry.type
        form = dm.get_form_by(name=form_id)
        # Default config for the form
        form_config = {
            'show_title': True,
            'show_desc': True,
        }
        entry_label = entry_config['label']

        data = {}

        if form:
            form_data = entry.extra.get('data', {})
            if preload := kwargs.get('data'):
                if isinstance(preload, str):
                    preload = json.loads(preload)
                form_data = {**form_data, **preload}
            dc.set_form_values(form, form_data)
            if 'config' in form.definition:
                form_config = form.definition['config']
            dc.load_form_content(form, data)
            entry_label = entry_label or form.definition['title']

        data.update({
            'entry': entry,
            'entry_type_label': entry_label,
            'definition': None if form is None else form.definition,
            'form_config': form_config,
            'read_only': read_only
        })

        return data

    @dc.content
    def entry_report(**kwargs):
        dm = dc.app.dm
        entry_id = kwargs['entry_id']
        entry = dm.get_entry_by(id=entry_id) if entry_id else None

        if entry is None:
            raise Exception("Please provide a valid Entry id. ")

        formDef = dm.get_form_definition('logbook_microscope')
        entry_config = formDef['config']

        if report := entry_config.get('report', None):
            kwargs['content_id'] = report
            data = dc.get(**kwargs)
            data['template'] = f'{report}.html'
        else:
            raise Exception("There is no Report associated with this Entry. ")

        return data

    @dc.content
    def file_preview(**kwargs):
        filepath = kwargs['file_path']
        filename = os.path.basename(filepath)

        if not os.path.exists(filepath):
            raise Exception("File does not exist. Make you have uploaded it before displaying.")

        thumb = Thumbnail(output_format='base64', max_size=(1024, 1024))

        filetype = 'unknown'
        filedata = ''

        if Path.isImage(filename):
            filetype = 'image'
            filedata = 'data:image/%s;base64, ' + thumb.from_path(filepath)
        elif Path.isText(filename):
            filetype = 'text'
            with open(filepath) as f:
                filedata = f.read()

        data = {
            'file_title': kwargs.get('title', ''),
            'file_data': filedata,
            'file_download': '',  # FIXME: Add download url for non-entry files
            'filename': filename,
            'filetype': filetype
        }
        if entry_id := int(kwargs.get('entry', 0)):
            data['file_download'] = flask.url_for('images.entry', entry=entry_id,
                                                  file=filename, attachment=1)

        return data

    @dc.content
    def entry_file_preview(**kwargs):
        dm = dc.app.dm
        entry_id = int(kwargs['entry'])
        entry = dm.get_entry_by(id=entry_id)
        filename = kwargs['file']
        filepath = dm.get_entry_path(entry, filename)
        kwargs['file_path'] = filepath
        return file_preview(**kwargs)

    @dc.content
    def applications(**kwargs):
        dataDict = dc.get(content_id='raw_applications_list')
        dataDict['template_statuses'] = ['preparation', 'active', 'closed']
        dataDict['template_selected_status'] = kwargs.get('template_selected_status', 'active')
        dataDict['templates'] = [{'id': t.id,
                                  'title': t.title,
                                  'description': t.description,
                                  'status': t.status,
                                  'iuid': t.extra.get('portal_iuid', 'no'),
                                  'code_prefix': t.code_prefix
                                  }
                                 for t in dc.app.dm.get_templates()]

        return dataDict

    @dc.content
    def application_form(**kwargs):
        dm = dc.app.dm  # shortcut

        if 'application_id' in kwargs:
            app = dm.get_application_by(id=kwargs['application_id'])
        else:  # New Application
            template = dm.get_template_by(id=kwargs['template_id'])
            appCode = ''
            if template.code_prefix:
                code_prefix = template.code_prefix.upper()
                # Try to figure out an autonumbering based on the template
                # code prefix and existing applications
                max_code = 0
                for a in dm.get_applications():
                    code = a.code
                    if code.startswith(code_prefix):
                        try:
                            max_code = max(max_code, int(code[3:]))
                        except:
                            pass
                appCode = '%s%05d' % (code_prefix, max_code + 1)

            app = dm.Application(code=appCode,
                                 title='', alias='', description='',
                                 creator=dc.app.user,
                                 resource_allocation=dm.Application.DEFAULT_ALLOCATION,
                                 extra={})

        # Microscopes info to set up some permissions on the Application form
        mics = [{'id': r.id,
                 'name': r.name,
                 'noslot': app.no_slot(r.id),
                 } for r in dm.get_resources() if r.is_microscope]

        # Check which PIs are in the application
        in_app = set(pi.id for pi in app.pi_list)

        return {'application': app,
                'application_statuses': dm.Application.STATUSES,
                'template_id': kwargs.get('template_id', None),
                'microscopes': mics,
                'pi_list': [{'id': u.id,
                             'name': u.name,
                             'email': u.email,
                             'in_app': u.id in in_app,
                             'status': 'representative' if u.id == app.representative_id else ''
                             }
                            for u in dm.get_users() if u.is_pi],
                'users': [u for u in dm.get_users() if u.is_manager]
                }

    def _logbooks():
        for p in dc.app.dm.get_projects():
            if p.status == 'special:logbook':
                r = p.extra.get('resource_id', 0)
                yield r, p

    def _resources():
        return dc.get_resources(all=True, image=True)['resources']

    @dc.content
    def logbooks(**kwargs):
        logbooks = []
        rlogbooks = []

        data = logbook_content(**kwargs)

        for logbook in data['logbooks']:
            if r := logbook.extra.get('resource_id', 0):
                rlogbooks.append(logbook)
            else:
                logbooks.append(logbook)

        def _count_dict():
            return {'total': 0, 'critical': 0, 'high': 0, 'medium': 0, 'low': 0, 'solved': 0}
        
        logbook_count = {}

        for e in data['logentries']:
            lb_id = e['logbook_id']
            for lb_id in [0, e['logbook_id']]:
                if lb_id not in logbook_count:
                    logbook_count[lb_id] = _count_dict()
                logbook_count[lb_id]['total'] += 1
                if e['status']:
                    logbook_count[lb_id][e['status']] += 1

        data.update({
            'logbooks': logbooks,
            'rlogbooks': rlogbooks,
            'logbook_count': logbook_count
        })

        return data

    @dc.content
    def logbook_entryform_content(**kwargs):
        dm = dc.app.dm
        formDef = dm.get_form_definition('logbook_microscope')
        # formDef['config']['request_resources']
        return {
            'users': [{'id': u.id, 'name': u.name} for u in dm.get_users() if u.is_active and u.is_manager],
            'tags': ["k3", "krios", "DMP", "filesystem", "pipeline", "LN2"]
        }

    @dc.content
    def logbook_entryform_validate(entry):
        dm = dc.app.dm  # shortcut
        data = entry.extra['data']

        dates = []

        for a in data.get('actions', []):
            if not a.get('status', ''):
                raise Exception(f"Please select the status for all actions.")
            if not a.get('date', ''):
                raise Exception(f"Please select the date for all actions.")
            try:
                d = dm.date(dt.datetime.strptime(a['date'], '%Y/%m/%d'))
                dates.append(d)
            except ValueError:
                raise Exception(f"Please provide a valid date for all actions.")

        for i, d in enumerate(dates[:-1]):
            if d > dates[i+1]:
                raise Exception(f"All actions must be in chronological order.")

        
    @dc.content
    def logbook_content(**kwargs):
        dm = dc.app.dm
        logbooks = []
        logentries = []

        logbook_ids = kwargs.get('logbook', '0')
        all_logbooks = {lb.id: lb for lb in dm.get_projects(condition='status="special:logbook"')}
        # Add some metadata to each logbook
        for logbook in all_logbooks.values():
            rid = int(logbook.extra.get('resource_id', 0))
            resource = dm.get_resource_by(id=rid)
            logbook_title = resource.name if resource else logbook.title
            logbook.title = logbook_title
            logbook.resource = resource

        if logbook_ids == '0':
            logbooks.extend(list(all_logbooks.values()))
        else:            
            for logbook_id in logbook_ids.split(','):
                logbook = all_logbooks.get(int(logbook_id), None)

                if logbook is None:
                    raise Exception(f"There is no logbook with id: {logbook_id}")

                logbooks.append(logbook)

        if len(logbooks) == 0:
            raise Exception("No logbooks found.")
        else:
            title = 'Logbooks'

        show = kwargs.get('show', '')
        show_bookings = 'b' in show
        show_sessions = 's' in show

        def _entry_status(e):
            actions = e.extra.get('data', {}).get('actions', [])
            return actions[-1].get('status', '') if actions else ''

        for logbook in logbooks:
            rid = int(logbook.extra.get('resource_id', 0))
            logentries.extend([{
                'logbook_id': logbook.id,
                'logbook_title': logbook.title,
                'resource_id': rid,
                'status': _entry_status(e),
                'id': e.id,
                'date': e.date,
                'type': e.type,
                'title': e.title,
                'desc': e.description,
                'user': e.creation_user,
                'last_update_date': e.last_update_date
                } for e in logbook.entries
            ])

            if show_bookings and resource:
                for b in dm.get_bookings(condition=f"resource_id={resource.id}", orderBy='start'):
                    e = {
                        'resource_id': rid,
                        'id': b.id,
                        'date': b.start,
                        'type': 'booking',
                        'title': f"Booking: {b.title}",
                        'user': b.creator,
                        'last_update_date': b.end
                    }
                    logentries.append(e)
                    if show_sessions:
                        for s in b.session:
                            se = dict(e)
                            se.update(session_id=s.id, type='session', title=f"Session: {s.shortname}")
                            logentries.append(se)

        if len(logbooks) == 1:
            entries_menu = logbooks[0].extra.get('entries_menu') or []
        else:
            entries_menu = []

        return {
            'title': title,
            'logtitle': title,
            'logbooks': logbooks,
            'all_logbooks': all_logbooks,
            'logentries': logentries,
            'entries_menu': entries_menu,
            'resources_dict': {r['id']: r for r in _resources()},
            'show': show,
        }

    @dc.content
    def logbooks_entries_content(**kwargs):
        return logbook_content(**kwargs)

    @dc.content
    def logbook_entryform_report(**kwargs):
        dm = dc.app.dm
        entry_id = kwargs['entry_id']
        entry = dm.get_entry_by(id=entry_id) if entry_id else None
        return {
            'entry': entry,
            'logbook_entry_actions': _logbook_entry_report_actions(dm, entry),
        }

    def _logbook_entry_report_actions(dm, entry):
        """Build rows for logbook_entryform_report: date, status, user label, optional base64 thumb."""
        thumb = Thumbnail(output_format='base64', max_size=(128, 128))
        rows = []
        extra_data = (entry.extra or {}).get('data') or {}
        for action in extra_data.get('actions') or []:
            if not isinstance(action, dict):
                continue
            uid = int(action.get('user', 0))
            user = dm.get_user_by(id=uid)
            user_label = app.shortname(user)
            thumb_uri = None
            for key in ('image', 'image_file', 'photo', 'screenshot', 'attachment'):
                fn = (action.get(key) or '').strip()
                if not fn:
                    continue
                path = dm.get_entry_path(entry, fn)
                if os.path.exists(path) and Path.isImage(os.path.basename(path)):
                    try:
                        thumb_uri = 'data:image/%s;base64, ' + thumb.from_path(path)
                        break
                    except Exception:
                        pass

            rows.append({
                'date': action.get('date', '') or '—',
                'status': action.get('status', '') or '—',
                'user': user_label,
                'thumb': thumb_uri,
            })
        return rows

    @dc.content
    def logbook_form(**kwargs):
        dm = dc.app.dm
        logbook_id = int(kwargs['logbook_id'])
        entry_forms = [f for f in dm.get_forms()
                       if f.name.startswith('entry_form:')]
        resources = None

        if logbook_id:
            logbook = dm.get_project_by(id=logbook_id)
            selected_entries = [e[0] for e in logbook.extra['entries_menu']]
        else:
            user = dc.app.user
            now = dm.now()
            logbook = dm.Project(status='special:logbook',
                                 date=now,
                                 last_update_date=now,
                                 last_update_user_id=user.id,
                                 title='',
                                 description='',
                                 extra={'user_can_edit': True})
            logbook.creation_user = logbook.user = user
            selected_entries = []
            rlogbooks = {r: p for r, p in _logbooks() if r}
            if int(kwargs.get('resources', 0)):
                resources = [r for r in _resources() if r['id'] not in rlogbooks]

        def _formToEntry(f):
            return [f.name.replace('entry_form:', ''),
                    f.definition['title']]

        return {
            'logbook': logbook,
            'entries': [_formToEntry(f) for f in entry_forms],
            'selected_entries': selected_entries,
            'logbook_resources': resources,
        }

