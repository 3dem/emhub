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

    @dc.content
    def projects_list(**kwargs):
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

        pi_labs = dc.get_pi_labs(all=True)
        from pprint import pprint
        pprint(pi_labs)

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
        }

    @dc.content
    def entry_form(**kwargs):
        dm = dc.app.dm
        user_id = dc.app.user.id
        now = dm.now()
        entry_id = kwargs['entry_id']
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

        data = {}

        if form:
            dc.set_form_values(form, entry.extra.get('data', {}))
            if 'config' in form.definition:
                form_config = form.definition['config']
            dc.load_form_content(form, data)

        data.update({
            'entry': entry,
            'entry_type_label': entry_config['label'],
            'definition': None if form is None else form.definition,
            'form_config': form_config
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
        base64 = image.Base64Converter(max_size=(512, 512))

        for k, v in data.items():
            if k.endswith('_image') and v.strip():
                fn = dm.get_entry_path(entry, v)
                data[k] = 'data:image/%s;base64, ' + base64.from_path(fn)

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
            if not template.code_prefix:
                raise Exception("It is not possible to create Applications from this template. \n"
                                "Maybe they need to be imported from the Portal. ")

            max_code = 0
            for a in dm.get_applications():
                code = a.code
                if code.startswith(template.code_prefix):
                    try:
                        max_code = max(max_code, int(code[3:]))
                    except:
                        pass

            app = dm.Application(code='%s%05d' % (template.code_prefix.upper(), max_code + 1),
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



