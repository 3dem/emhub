
import os
from glob import glob
import json
import datetime as dt

from emtools.utils import Pretty


def register_content(dc):
    @dc.content
    def cluster_queues(**kwargs):
        dm = dc.app.dm
        queuesConf = dm.get_config('queues')
        queuesLayout = queuesConf['layout']
        queueWorker = queuesConf['worker']

        # FIXME: this is just for debugging purposes,
        # get real data from the worker task results
        jobsJson = queuesConf['sample_json']

        task = None
        # # TODO: Get worker that monitor cluster from config
        # ws = dm.get_worker_stream(queueWorker)
        # for t in ws.get_pending_tasks():
        #     task = t

        if task:
            event_id, event = dm.get_task_lastevent(task)
            jobsJson = json.loads(event['queues'])
            updated = Pretty.datetime(dm.dt_from_redis(event_id))
        else:
            updated = ''

        return {
            'queues': queuesLayout,
            'jobs': jobsJson,
            'task': task,
            'updated': updated
        }

    @dc.content
    def cluster_queues_content(**kwargs):
        return cluster_queues(**kwargs)

    def access_microscopes(**kwargs):
        """ Load one of all batches. """
        dm = dc.app.dm  # shortcut
        formDef = dm.get_form_definition('access_microscopes')
        return {
            'request_resources': formDef['config']['request_resources']
        }

    @dc.content
    def create_session_form(**kwargs):
        """ Specific information needed to render the create-form template
        # for St.Jude CryoEM center.
        """
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
        transfer_host = sconfig['raw']['hosts_default'][micName]

        # We provide cryolo_models to be used with the OTF
        cryolo_models_pattern = dm.get_config('sessions')['data']['cryolo_models']

        cryolo_models = glob(cryolo_models_pattern)

        if not user.is_manager:
            group = dm.get_user_group(user)
            cryolo_models = [cm for cm in cryolo_models if group in cm]

        def _key(model):
            d, base = os.path.split(model)
            return base if not user.is_manager else os.path.join(os.path.basename(d), base)

        dateStr = Pretty.date(b.start).replace('-', '')

        otf = sconfig['otf']
        data = {
            'booking': b,
            'acquisition': acq,
            'session_name_prefix': f'{dateStr}{b.resource.name}:',
            'otf_hosts': otf['hosts'],
            'otf_host_default': otf['hosts_default'][micName],
            'otf2d_host_default': otf['hosts_default_2d'][micName][0],
            'otf2d_gpus_default': otf['hosts_default_2d'][micName][1],
            'workflows': otf['workflows'],
            'workflow_default': otf['workflow_default'],
            'transfer_host': transfer_host,
            'cryolo_models': {_key(cm): cm for cm in cryolo_models}
        }
        data.update(dc.get_user_projects(b.owner, status='active'))
        groups = workers_frames(hours=10)['folderGroups']
        frames = groups.get(transfer_host, {'entries': []})
        data['frame_folders'] = frames['entries']
        return data

    @dc.content
    def workers_frames(**kwargs):
        # Some optional parameters
        days = int(kwargs.get('days', 0))
        hours = int(kwargs.get('hours', 0))
        total_hours = days * 24 + hours
        td = dt.timedelta(hours=total_hours)

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
                    if 'error' in event:
                        continue
                    entries = json.loads(event.get('entries', []))
                    usage = json.loads(event['usage'])
                    folders = []
                    now = dm.now()
                    for e in entries:
                        ddt = dm.dt_from_timestamp(e['ts'])
                        if total_hours == 0 or now - ddt < td:
                            e['modified'] = ddt
                            folders.append(e)

                    folders.sort(key=lambda f: f[sortKey], reverse=bool(reverse))
                    folderGroups[h] = {'usage': usage, 'entries': folders}
                    break

        return {
            'folderGroups': folderGroups
        }
