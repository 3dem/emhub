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
from glob import glob
import datetime as dt

from emtools.utils import Pretty, Path
from emtools.metadata import Bins, TsBins, EPU


def register_content(dc):

    @dc.content
    def session_form(**kwargs):
        session_id = kwargs['session_id']
        session = dc.app.dm.get_session_by(id=session_id)
        data = {'session': session.json()}
        return data

    @dc.content
    def sessions_overview(**kwargs):
        sessions = dc.app.dm.get_sessions(condition=dc._get_display_condition(),
                                          orderBy='resource_id')
        return {'sessions': sessions}

    @dc.content
    def session_default(**kwargs):
        session_id = kwargs['session_id']
        session = dc.app.dm.load_session(session_id)
        otf_status = session.otf_status

        if not otf_status or otf_status == 'created':
            data = session_details(**kwargs)
            data['session_default'] = 'session_details.html'
        else:
            data = session_live(**kwargs)
            data['session_default'] = 'session_live.html'

        return data

    @dc.content
    def session_live(**kwargs):
        session_id = kwargs['session_id']
        session = dc.app.dm.load_session(session_id)
        data = dc.get_session_data(session)
        data.update({'s': session})
        return data

    @dc.content
    def session_details(**kwargs):
        session_id = kwargs['session_id']
        session = dc.app.dm.get_session_by(id=session_id)
        if session.booking:
            a = session.booking.application
            if not (a is None or a.allows_access(dc.app.user)):
                raise Exception("You do not have access to this session information. ")

        # Try to get deletion days (used in SLL based on session name code)
        days = dc.app.dm.get_session_data_deletion(session.name[:3])
        td = (session.start + dt.timedelta(days=days)) - dc.app.dm.now()
        errors = []
        # TODO: We might check other type of errors in the future
        status_info = session.extra.get('status_info', '')
        if status_info.lower().startswith('error:'):
            errors.append(status_info)

        frames = Path.rmslash(session.extra['raw'].get('frames', ''))
        return {
            'session': session,
            'epu_session': os.path.basename(frames),
            'deletion_days': td.days,
            'errors': errors,
            'files': [{'name': k.replace('.', ''),
                       'y': v['count'],
                       'z': v['size'],
                       'sizeH': Pretty.size(v['size'])}
                      for k, v in session.files.items()]
        }

    @dc.content
    def session_hourly_plots(**kwargs):
        session_id = kwargs['session_id']
        plot = kwargs['plot']
        session = dc.app.dm.load_session(session_id)
        data = {'plot_data': [],
                'plot_key': plot
                }

        if os.path.exists(session.data_path):
            if plot == 'imported':
                epuData = session.data.getEpuData()
                items = [{'ts': row.timeStamp} for row in epuData.moviesTable]
            elif plot == 'aligned':
                sdata = session.data
                items = []
                for mic in sdata.get_micrographs():
                    micFn = sdata.join(mic['micrograph'])
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
        session = dc.app.dm.load_session(kwargs['session_id'])
        return {'gridsquares': session.data.get_gridsquares()}

    @dc.content
    def sessions_list(**kwargs):
        show_extra = 'extra' in kwargs and dc.app.user.is_admin
        dm = dc.app.dm  # shortcut
        all_sessions = dm.get_sessions()
        sessions = []
        bookingDict = {}

        for s in all_sessions:
            if s.booking:
                a = s.booking.application
                if a is None or a.allows_access(dc.app.user):
                    sessions.append(s)
                    b = dc.booking_to_event(s.booking,
                                              prettyDate=True, piApp=True)
                    bookingDict[s.booking.id] = b

        return {
            'sessions': sessions,
            'bookingDict': bookingDict,
            'show_extra': show_extra
        }

    @dc.content
    def session_flowchart(**kwargs):
        session = dc.app.dm.load_session(kwargs['session_id'])
        # data = get_session_data(session)
        return {
            'session': session,
            'workflow': session.data.get_workflow()
        }

    @dc.content
    def create_session_form(**kwargs):
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

        # We provide cryolo_models to be used with the OTF
        cryolo_models_pattern = dm.get_config('sessions')['data']['cryolo_models']

        cryolo_models = glob(cryolo_models_pattern)

        if not user.is_manager:
            group = dm.get_user_group(user)
            cryolo_models = [cm for cm in cryolo_models if group in cm]

        def _key(model):
            d, base = os.path.split(model)
            return base if not user.is_manager else os.path.join(os.path.basename(d), base)

        data = {
            'booking': b,
            'acquisition': acq,
            'cameras': dm.get_session_cameras(b.resource.id),
            'processing': dm.get_session_processing(),
            'session_name': dm.get_new_session_info(booking_id)['name'],
            'otf_hosts': sconfig['otf']['hosts'],
            'otf_host_default': sconfig['otf']['hosts_default'][micName],
            'workflows': sconfig['otf']['workflows'],
            'workflow_default': sconfig['otf']['workflow_default'],
            'transfer_host': sconfig['raw']['hosts_default'][micName],
            'cryolo_models': {_key(cm): cm for cm in cryolo_models}
        }
        data.update(dc.get_user_projects(b.owner, status='active'))
        return data