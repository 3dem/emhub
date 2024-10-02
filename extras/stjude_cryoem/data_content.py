import datetime
import os
from glob import glob
import json
import datetime as dt

from emtools.utils import Pretty
from emhub.utils import datetime_from_isoformat


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

    @dc.content
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
            'workflows': otf['workflows'],
            'workflow_default': otf['workflow_default'],
            'transfer_host': transfer_host,
            'cryolo_models': {_key(cm): cm for cm in cryolo_models}
        }
        data.update(dc.get_user_projects(b.owner, status='active'))
        frames = workers_frames(hours=10)['folderGroups']
        data['frame_folders'] = frames.get(transfer_host, {'entries': []})['entries']
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

    @dc.content
    def create_session_negstain(**kwargs):
        """ Specific information needed to render the create-form template
        # for St.Jude CryoEM center.
        """
        return create_session_form(**kwargs)

    @dc.content
    def dashboard_instrument_card(**kwargs):
        """ Load data for a single instrument. """
        data = dashboard(**kwargs)
        r = None
        for r in data['resources']:
            if r['id'] == int(kwargs['resource_id']):
                break
        data['r'] = r
        data['alignment'] = kwargs.get('alignment', 'v')
        return data

    @dc.content
    def dashboard_createslots_card(**kwargs):
        dm = dc.app.dm
        kwargs['load_requests'] = False
        data = dashboard_instrument_card(**kwargs)
        next_week = data['next_week']
        rid = int(kwargs['resource_id'])
        create_slots = int(kwargs.get('create_slots', 0))

        slots = []
        overlaps = []
        bookings = data['resource_bookings'][rid].get('next_week', [])
        range1 = datetime.time(9), datetime.time(12)
        range2 = datetime.time(13), datetime.time(23)

        def _create_slot(d, r):
            args = {
                'resource_id': rid,
                'type': 'slot',
                'start': dm.date(d, r[0]),
                'end': dm.date(d, r[1])
            }

            s = dm.Booking(**args)
            o = [b for b in bookings if b.overlap_slot(s)]
            slots.append(s)
            overlaps.append(o)
            if create_slots and not o:
                dm.create_booking(**args)

        for i in range(5):
            d = next_week + datetime.timedelta(days=i)
            _create_slot(d, range1)
            _create_slot(d, range2)

        data['slots'] = slots
        data['overlaps'] = overlaps
        return data

    @dc.content
    def dashboard(**kwargs):
        """ Customized Dashboard data for the CryoEM center at St.Jude. """
        dm = dc.app.dm  # shortcut
        user = dc.app.user  # shortcut
        # If 'resource_id' is passed as argument, only display
        # that resource in the dashboard
        resource_id = int(kwargs.get('resource_id', 0))
        dataDict = dc.get_resources(image=True)
        resources = dataDict['resources']
        selected_resources = [r for r in resources if r['id'] == resource_id] or resources


        resource_bookings = {}

        # Provide upcoming bookings sorted by proximity
        bookings = [('Today', []),
                    ('Next 7 days', []),
                    ('Next 30 days', [])]

        def week_start(d):
            return (d - dt.timedelta(days=d.weekday())).date()

        if 'date' in kwargs:
            now = datetime_from_isoformat(kwargs['date'])
        else:
            now = dm.now()
        this_week = week_start(now)
        d7 = dt.timedelta(days=7)
        next_week = week_start(now + d7)
        prev7 = now - dt.timedelta(days=8)
        next7 = now + d7
        next30 = now + dt.timedelta(days=30)

        def is_same_week(d):
            return this_week == week_start(d)

        def is_next_week(d):
            return this_week == week_start(d - d7)

        def add_booking(b):
            start = dm.dt_as_local(b.start)
            end = dm.dt_as_local(b.end)

            r = b.resource
            if r.id not in resource_bookings:
                resource_bookings[r.id] = {
                    'today': [],
                    'this_week': [],
                    'next_week': []
                }

            if is_same_week(start):
                k = 'this_week'
            elif is_next_week(start):
                k = 'next_week'
            else:
                k = None

            if k:
                resource_bookings[r.id][k].append(b)

                if start.date() <= now.date() <= end.date():  # also add in today
                    resource_bookings[r.id]["today"].append(b)
                    bookings[0][1].append(b)
                elif k == 'next_week':
                    bookings[1][1].append(b)
            else:
                bookings[2][1].append(b)

        local_tag = dm.get_config('bookings').get('local_tag', '')
        local_scopes = {}

        for b in dm.get_bookings_range(prev7, next30):
            # if not user.is_manager and not user.same_pi(b.owner):
            #     continue
            r = b.resource
            if not local_tag or local_tag in r.tags:
                local_scopes[r.id] = r
                add_booking(b)

        scopes = {r.id: r for r in dm.get_resources()}

        for rbookings in resource_bookings.values():
            for k, bookingValues in rbookings.items():
                bookingValues.sort(key=lambda b: b.start)

        # Remove slots if there are overlapping bookings
        for rbookings in resource_bookings.values():
            for k, bookingValues in rbookings.items():
                def _slot_overlap(s):
                    return s.is_slot and any(s.overlap_slot(b)
                                             for b in bookingValues)

                slots_overlap = [s for s in bookingValues if _slot_overlap(s)]
                for s in slots_overlap:
                    bookingValues.remove(s)

                bookingValues.sort(key=lambda b: b.start)

        # Retrieve open requests for each scope from entries and bookings
        if kwargs.get('load_requests', True):
            for p in dm.get_projects():
                if p.is_active:
                    last_bookings = {}
                    # Find last bookings for each scope
                    for b in sorted(p.bookings, key=lambda b: b.end, reverse=True):
                        if len(last_bookings) < len(local_scopes) and b.resource_id not in last_bookings:
                            last_bookings[b.resource.id] = b

                    reqs = {}
                    for e in reversed(p.entries):
                        # Requests found for each scope, no need to continue
                        if len(reqs) == len(local_scopes):
                            break
                        if b := dc.booking_from_entry(e, scopes):
                            rid = b.resource_id
                            if (rid not in reqs and
                                    (rid not in last_bookings or
                                     b.start.date() > last_bookings[rid].end.date())):
                                b.id = e.id
                                add_booking(b)
                                reqs[rid] = b

        # Sort all entries
        for rbookings in resource_bookings.values():
            for k, bookingValues in rbookings.items():
                bookingValues.sort(key=lambda b: b.start)

        resource_create_session = dm.get_config('sessions').get('create_session', {})

        # FIXME Now let's hard code Arctica as the only
        # microscope that allows generation of slots.
        # It can be changed to some configuration if needed
        create_slots = {'Arctica01': True}

        dataDict.update({'resource_bookings': resource_bookings,
                         'resource_create_session': resource_create_session,
                         'local_resources': local_scopes,
                         'next_week': next_week,
                         'date': now,
                         'create_slots': create_slots,
                         'resource_id': resource_id,
                         'selected_resources': selected_resources
                         })
        dataDict.update(dc.news())
        return dataDict
