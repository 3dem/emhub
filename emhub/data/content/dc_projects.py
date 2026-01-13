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
import flask

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
            dc.set_form_values(form, entry.extra.get('data', {}))
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

        entry_config = dm.get_entry_config(entry.type)
        data = entry.extra['data']

        if not 'report' in entry_config:
            raise Exception("There is no Report associated with this Entry. ")

        images = []

        # Convert images in data form to base64
        thumb = Thumbnail(output_format='base64')

        for k, v in data.items():
            if k.endswith('_image') and v.strip():
                fn = dm.get_entry_path(entry, v)
                data[k] = 'data:image/%s;base64, ' + thumb.from_path(fn)

        for k, v in data.items():
            if k.endswith('_images') or k.endswith('images_table'):
                for row in v:
                    if 'image_file' in row:
                        fn = dm.get_entry_path(entry, row['image_file'])
                        row['image_data'] = 'data:image/%s;base64, ' + base64.from_path(fn)
                        images.append(row)

        # Group data rows by gridboxes (label)
        if entry.type in ['grids_preparation', 'grids_storage']:
            # TODO: Some possible validations
            # TODO:      - There are no more that 4 slots per gridbox
            # TODO:      - There are no duplicated slots
            table = data[entry.type + '_table']
            gridboxes = {}

            for row in table:
                label = row.get('gridbox_label', '')
                if label not in gridboxes:
                    gridboxes[label] = {}
                slots = map(int, row['grid_position'])
                for s in slots:
                    gridboxes[label][s] = row

            data['gridboxes'] = gridboxes

        session = None
        if entry.type == 'data_acquisition':
            session_name = data.get('session_name', '').strip().lower()
            session = dm.get_session_by(name=session_name)

        pi = entry.project.user.get_pi()
        # TODO: We should store some properties in EMhub and avoid this request
        try:
            pi_info = dc.app.sll_pm.fetchAccountDetailsJson(pi.email) if pi else None
        except:
            pi_info = None

        # Create a default dict based on data to avoid missing key errors in report
        ddata = defaultdict(lambda: 'UNKNOWN')
        ddata.update(data)

        return {
            'entry': entry,
            'entry_config': entry_config,
            'data': ddata,
            'images': images,
            'pi_info': pi_info,
            'session': session
        }

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
        for r, p in _logbooks():
            if r:
                rlogbooks.append(p)
            else:
                logbooks.append(p)

        return {
            'logbooks': logbooks,
            'rlogbooks': rlogbooks,
            'resources_dict': {r['id']: r for r in _resources()}
        }

    @dc.content
    def logbook_content(**kwargs):
        dm = dc.app.dm
        logbook_id = int(kwargs.get('logbook', 0))
        logbook = dm.get_project_by(id=logbook_id)

        if logbook is None:
            raise Exception(f"There is no logbook with id: {logbook_id}")

        if logbook.status != 'special:logbook':
            raise Exception(f"Project with id {logbook_id} is not a logbook.")

        logentries = [{
            'id': e.id,
            'date': e.date,
            'type': e.type,
            'title': e.title,
            'desc': e.description,
            'user': e.creation_user,
            'last_update_date': e.last_update_date
            } for e in logbook.entries
        ]
        if r := logbook.extra.get('resource_id', 0):
            resource = dm.get_resource_by(id=r)
            title = resource.name
            for b in dm.get_bookings(condition=f"resource_id={r}", orderBy='start'):
                e = {
                    'id': b.id,
                    'date': b.start,
                    'type': 'booking',
                    'title': b.title,
                    'desc': b.description,
                    'user': b.creator,
                    'last_update_date': b.end
                }
                logentries.append(e)
                for s in b.session:
                    se = dict(e)
                    se.update(session_id=s.id, type='session', title='Name = ' + s.shortname)
                    logentries.append(se)
        else:
            resource = None
            title = logbook.title

        return {
            'logtitle': title,
            'logbook': logbook,
            'logentries': logentries,
            'entries_menu': logbook.extra['entries_menu']
        }

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

