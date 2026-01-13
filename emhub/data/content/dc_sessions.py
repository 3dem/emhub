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
import base64
from glob import glob
import datetime as dt
import numpy as np


import mrcfile

from emtools.utils import Pretty, Path
from emtools.metadata import Bins, TsBins, EPU, StarFile
from emtools.image import Thumbnail


def register_content(dc):

    @dc.content
    def session_form(**kwargs):
        dm = dc.app.dm
        tdata = {}

        if session_id := int(kwargs.get('session_id', 0)):
            session = dm.get_session_by(id=session_id)
            b = session.booking
            load_form = True

        else:
            load_form = False
            booking_id = int(kwargs['booking_id'])
            b = dm.get_booking_by(id=booking_id)
            session = dm.Session(booking_id=booking_id,
                                 status='active',
                                 data_path='')

        definition = None
        use_editor = 1

        if form := dm.get_session_form(b.resource.name):
            definition = form.definition
            use_editor = 0
            if load_form:
                dc.set_form_values(form, session.extra.get('data', {}))
                dc.load_form_content(form, tdata)

        dateStr = Pretty.date(b.start).replace('-', '')

        tdata.update({
            'booking': b,
            'session': session.json(),
            'definition': definition,
            'new_session': session.id is None,
            'use_editor': use_editor,
            'session_name_prefix': f'{dateStr}{b.resource.name}:',
        })

        return tdata

    @dc.content
    def sessions_overview(**kwargs):
        sessions = dc.app.dm.get_sessions(condition=dc._get_display_condition(),
                                          orderBy='resource_id')
        return {'sessions': sessions}

    @dc.content
    def session_default(**kwargs):
        session = dc.app.dm.get_session_by(id=kwargs['session_id'])
        otf_status = session.otf_status

        if not session.otf_path or not otf_status or otf_status == 'created':
            kwargs['content_id'] = 'session_details'
            data = dc.get(**kwargs)
            data['session_default'] = 'session_details.html'
        else:
            data = session_live(**kwargs)
            data['session_default'] = 'session_live.html'

        return data

    @dc.content
    def session_live(**kwargs):
        session = dc.app.dm.get_session_by(id=kwargs['session_id'])
        otf = session.extra['otf']
        data = {'s': session}

        if 'tomo' in otf:
            data['tomo'] = True
            data['tomo_session'] = {
                'path': otf['path'],
                'tomograms': "External/job001/warp_tomostar",
                'reconstruction': "External/job001/warp_tiltseries/reconstruction",
                'picking': "External/job002"
            }
            data.update(dc.get_data('tomo_session_content',
                                    tomo_session=json.dumps(data['tomo_session'])))
        else:
            data.update(dc.get_session_data(session))

        return data

    @dc.content
    def session_content(**kwargs):
        return session_details(**kwargs)

    @dc.content
    def session_details(**kwargs):
        session_id = kwargs['session_id']
        dm = dc.app.dm  # shortcut
        session = dm.get_session_by(id=session_id)
        session_extra_form = None

        if b := session.booking:
            a = b.application
            rname = b.resource.name
            session_extra_form = dm.get_session_form(rname)
            if session_extra_form:
                dc.set_form_values(session_extra_form, session.extra.get('data', {}))
                #dc.load_form_content(session_extra_form, tdata)
            if not (a is None or a.allows_access(dc.app.user)):
                raise Exception("You do not have access to this session information. ")

        # Try to get deletion days (used in SLL based on session name code)
        days = dm.get_session_data_deletion(session.name[:3])
        td = (session.start + dt.timedelta(days=days)) - dm.now()
        errors = []
        # TODO: We might check other type of errors in the future
        status_info = session.extra.get('status_info', '')
        if status_info.lower().startswith('error:'):
            errors.append(status_info)

        return {
            'session': session,
            'deletion_days': td.days,
            'errors': errors,
            'session_extra_form': session_extra_form
        }

    @dc.content
    def session_hourly_plots(**kwargs):
        project = dc.app.dm.get_processing_project(**kwargs)['project']

        plot = kwargs['plot']
        data = {'plot_data': [],
                'plot_key': plot
                }

        if project.exists():
            if plot == 'imported':
                items = [{'ts': ts} for ts in project.importTimestamps()]

            elif plot == 'aligned':
                items = []
                for mic in project.get_micrographs():
                    micFn = project.join(mic['micrograph'])
                    items.append({'ts': os.path.getmtime(micFn)})
                items.sort(key=lambda item: item['ts'])
            else:
                raise Exception('Unknown plot type: ' + plot)

            data['plot_data'] = TsBins(items).bins

        return data

    @dc.content
    def session_data_card(**kwargs):
        return session_details(**kwargs)

    @dc.content
    def session_micrographs(**kwargs):
        data = session_live(**kwargs)
        return {'micrographs': data['defocus'][:8]}

    @dc.content
    def session_gridsquares(**kwargs):
        project = dc.app.dm.get_processing_project(**kwargs)['project']
        return {'gridsquares': project.get_gridsquares()}

    @dc.content
    def sessions_list(**kwargs):
        show_extra = 'extra' in kwargs and dc.app.user.is_admin
        days = int(kwargs.get('days', 30))
        dm = dc.app.dm  # shortcut
        all_sessions = dm.get_sessions()
        sessions = []
        now = dm.now()
        d30 = dt.timedelta(days=days)

        for s in all_sessions:
            if s.start is not None and now - s.start > d30:
                continue

            if s.booking:
                a = s.booking.application
                if a is None or a.allows_access(dc.app.user):
                    sessions.append(s)
                    #b = dc.booking_to_event(s.booking, prettyDate=True, piApp=True)
                    #bookingDict[s.booking.id] = b

        return {
            'sessions': sessions,
            #'bookingDict': bookingDict,
            'show_extra': show_extra
        }

    @dc.content
    def create_session_form(**kwargs):
        # session_id = int(kwargs['session_id'])
        dm = dc.app.dm  # shortcut
        user = dc.app.user
        booking_id = int(kwargs['booking_id'])
        b = dm.get_booking_by(id=booking_id)
        can_edit = b.project and user.can_edit_project(b.project)

        if not (user.is_manager or user.same_pi(b.owner) or can_edit):
            raise Exception("You can not create Sessions for this Booking. "
                            "Only members of the same lab can do it.")

        sconfig = dm.get_config('sessions')

        # load default acquisition params for the given microscope
        micName = b.resource.name
        acq = sconfig['acquisition'][micName]
        dateStr = Pretty.date(b.start).replace('-', '')

        data = {
            'booking': b,
            'acquisition': acq,
            'session_name_prefix': f'{dateStr}{b.resource.name}:',
            'session_extra_form': dm.get_session_form(b.resource.name)
        }
        data.update(dc.get_user_projects(b.owner, status='active'))
        return data

    @dc.content
    def processing_content(**kwargs):
        ppDict = dc.app.dm.get_processing_project(**kwargs)
        project = ppDict['project']
        from emwrap.base import ProjectManager
        pm = ProjectManager(project.path)
        pm.update()

        pp = ppDict['project']

        return {
            'processing_project': pp,
            'workflow': pp.get_workflow(),
            'get_project_args': ppDict['args']
        }

    @dc.content
    def processing_flowchart(**kwargs):
        return processing_content(**kwargs)

    @dc.content
    def session_flowchart(**kwargs):
        session = dc.app.dm.get_session_by(id=kwargs['session_id'])
        data = processing_content(**kwargs)
        data['session'] = session
        return data

    def get_processing_run_func(funcName, kwargs):
        ppDict = dc.app.dm.get_processing_project(**kwargs)
        pp = ppDict['project']
        run = ppDict['run']
        func = getattr(run, funcName)
        result = func(**kwargs)
        data = {
            'processing_project': pp,
            'get_project_args': ppDict['args'],
            'run': run,
            'template': result['template']
        }
        data.update(result['data'])
        return data

    @dc.content
    def processing_run_summary(**kwargs):
        return get_processing_run_func('getSummary', kwargs)

    @dc.content
    def processing_run_overview(**kwargs):
        return get_processing_run_func('getOverview', kwargs)

    @dc.content
    def processing_textfile_overview(**kwargs):
        textfile = kwargs['file_path']
        known_modes = ['xml', 'json']
        ext = Path.getExt(textfile)[1:]
        config = {
            'mode': ext if ext in known_modes else ''
        }

        with open(textfile) as f:
            if ext == 'json':
                content = json.dumps(json.load(f), indent=4)  # pretty display of json content
            else:
                content = f.read()

        return {
            'title': config['mode'],
            'file_path': textfile,
            'file_content': content,
            'editor_config': config
        }

    @dc.content
    def processing_star_overview(**kwargs):
        starFile = kwargs['file_path']
        data = {'file_path': starFile}

        with StarFile(starFile) as sf:
            # load all tables info and default table rows
            tables = {}
            tableNames = sf.getTableNames()
            defaultTable = kwargs.get('default_table', tableNames[0])
            for tn in tableNames:
                ti = sf.getTableInfo(tn)
                tsize = sf.getTableSize(tn)
                tables[tn] = {
                    'columns': ti.getColumnNames(),
                    'rows': tsize
                }
                if tn == defaultTable:
                    data['default_table'] = defaultTable
                    limit = min(50, tsize)
                    rows_subset = f'(subset of {limit} rows)' if tsize > limit else ''
                    data['rows'] = [r._asdict() for r in sf.iterTable(tn, limit=limit, guessType=False)]
                    data['rows_subset'] = rows_subset

                data['tables'] = tables

        return data

    @dc.content
    def processing_star_card(**kwargs):
        starFile = kwargs['file_path']
        tn = kwargs['table_name']
        data = {}
        with StarFile(starFile) as sf:
            # only load rows for this table, not the all tables info
            ti = sf.getTableInfo(tn)
            tsize = sf.getTableSize(tn)
            limit = min(50, tsize)
            rows_subset = f'(subset of {limit} rows)' if tsize > limit else ''
            data.update({
                'default_table': tn,
                'columns': ti.getColumnNames(),
                'rows_subset': rows_subset,
                'rows': [r._asdict() for r in sf.iterTable(tn, limit=limit, guessType=False)]
            })
        return data

    @dc.content
    def processing_volume_card(**kwargs):
        volPath = kwargs['file_path']

        if not os.path.exists(volPath):
            raise Exception("Volume path %s does not exists." % volPath)

        volume_data = kwargs.get('volume_data', 'info')

        mrc = mrcfile.open(volPath, permissive=True)
        zdim, ydim, xdim = mrc.data.shape
        slice_dim = int(kwargs.get('slice_dim', 128))
        slice_step = int(kwargs.get('slice_step', 1))

        data = {
            'file_path': volPath,
            'dimensions': [xdim, ydim, zdim],
            'slice_dim': slice_dim
        }

        if volume_data == "info":
            return data

        if "slices" in volume_data:
            axis = kwargs.get('axis', 'z')

            # volThumb = Thumbnail(max_size=(slice_dim, slice_dim),
            #                      output_format='base64',
            #                      contrast_factor=0.1)

            volThumb = Thumbnail(output_format='base64',
                                 contrast_factor=0.1)

            # volThumb = Thumbnail(output_format='base64',
            #                      contrast_factor=0.1)
                                 #min_max=(mrc.data.min(), mrc.data.max()))
            # if slice_number := int(kwargs.get('slice_number', 0)):
            #     # Do not take slices from star/end since they are usually empty
            #     n4 = np.round(xdim / 4)
            #     idx = np.round(np.linspace(n4, xdim - n4, slice_number)).astype(int)
            #     pass
            # else:
            #     slice_number = min(xdim, slice_dim)
            #     idx = np.round(np.linspace(0, xdim - 1, slice_number)).astype(int)

            slices = {}
            if 'x' in axis:
                slices['x'] = {int(i): volThumb.from_array(mrc.data[:, :, i].transpose())
                               for i in range(0, xdim, slice_step)}
            if 'y' in axis:
                slices['y'] = {int(i): volThumb.from_array(mrc.data[:, i, :])
                               for i in range(0, ydim, slice_step)}

            if 'z' in axis:
                slices['z'] = {int(i): volThumb.from_array(mrc.data[i, :, :])
                               for i in range(0, zdim, slice_step)}

            print(slices.keys())

            data.update({
                'slices': slices,
                'axis': axis
            })

        if 'array' in volume_data:
            iMax = mrc.data.max()  # min(imean + 10 * isd, imageArray.max())
            iMin = mrc.data.min()  # max(imean - 10 * isd, imageArray.min())
            im255 = ((mrc.data - iMin) / (iMax - iMin) * 255).astype(np.uint8)
            data['array'] = base64.b64encode(im255).decode("utf-8")

        return data

    @dc.content
    def processing_tomogram_card(**kwargs):
        # kwargs['slice_step'] = 10
        data = processing_volume_card(**kwargs)
        x = []
        y = []
        z = []
        data['coordinates'] = {'x': x, 'y': y, 'z': z}

        if coords_md := kwargs.get('coords_md', ''):
            if os.path.exists(coords_md):
                with StarFile(coords_md) as sf:
                    for row in sf.iterTable('particles'):
                        x.append(round(row.rlnCoordinateX))
                        y.append(round(row.rlnCoordinateY))
                        z.append(round(row.rlnCoordinateZ))

        return data

    @dc.content
    def processing_dashboard(**kwargs):
        from emhub.data.processing import get_processing_type
        colors = {'relion': '#caf0f8', 'scipion': '#fcd9d9'}
        workspaces = []
        for p in dc.app.dm.get_projects():
            if p.status == 'special:processing':
                p.project_path = p
                p.label = p.title or os.path.basename(p.project_path)
                p.projects = []
                for e in p.entries:
                    if e.type == 'data_processing':
                        data = e.extra['data']
                        pp = data['project_path']
                        ptype = get_processing_type(pp)
                        pcolor = colors.get(ptype, 'gray')
                        p.projects.append({
                            'id': e.id,
                            'label': e.title or os.path.basename(pp),
                            'type': ptype,
                            'color': pcolor,
                            'description': e.description,
                            'project_path': pp
                        })
                workspaces.append(p)

        return {
            'workspaces': workspaces,
            'mode': kwargs.get('mode', 'table')
        }

    @dc.content
    def processing_dashboard_content(**kwargs):
        return processing_dashboard(**kwargs)

    @dc.content
    def processing_workspace_form(**kwargs):
        kwargs['content_id'] = 'project_form'
        return dc.get(**kwargs)
