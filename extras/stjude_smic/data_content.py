
class Batch:
    """ Helper class to store plates information. """
    def __init__(self, batch_id, status):
        # Store info about plates (e.g. number and channels)
        self.id = batch_id
        self.status = status
        self._plates = {}

    @property
    def active(self):
        return self.status == 'active'

    @property
    def inactive(self):
        return self.status == 'inactive'

    def addPlate(self, p, status):
        self._plates[p.id] = {
            'id': p.id,
            'number': p.cane,
            'label': p.label,
            'status': status,
            'channels': {}
        }
        if channels := p.extra.get('channels', {}):
            for channel, info in channels.items():
                self.registerPlateChannelInfo(p.id, int(channel), info)

    def registerPlateChannelInfo(self, plate_id, channel, info,
                                 booking=None, project=None):
        if plate_id in self._plates:
            channels = self._plates[plate_id]['channels']
            channels[channel] = {
                'booking': booking,
                'project': project,
                'issues': info.get('issues', False),
                'sample': info.get('sample', ''),
                'comments': info.get('comments', '')
            }

    @property
    def plates(self):
        """ Iterate over the plates sorted by plate_number. """
        return sorted(self._plates.values(),
                      key=lambda p: p['number'])

    def platesAvailable(self):
        """ Return available plates and channels. """
        def __availableChannels(p):
            return [c for c in range(1, 11)
                    if c not in p['channels']]
        def __availablePlate(p):
            return p['status'] == 'active' and len(p['channels']) < 10

        def _usedChannel(p):
            return (p['booking'] is not None or
                    p['project'] is not None or
                    p['issues'] or p['sample'].strip() or p['comments'].strip())

        for p in self.plates:
            if p['status'] == 'active':
                used_channels = len([c for c, cInfo in p['channels'].items()
                                     if _usedChannel(cInfo)])
                if used_channels < 10:
                    yield p


def register_content(dc):
    def load_batches(batch_id=None):
        """ Load one of all batches. """
        dm = dc.app.dm  # shortcut
        platesConfig = dm.get_config('plates')
        inactive_batches = platesConfig['inactive_batches']
        batches = {}
        plateBatches = {}

        for p in dm.get_pucks():
            b = p.dewar
            if batch_id is None or batch_id == b:
                if b not in batches:
                    bstatus = 'inactive' if b in inactive_batches else 'active'
                    batches[b] = Batch(b, bstatus)
                pstatus = p.extra.get('status', 'active')
                batches[b].addPlate(p, pstatus)
                plateBatches[p.id] = batches[b]

        def _registerInfo(info, **kwargs):
            plate_id = int(info.get('plate', -1))
            if plate_id in plateBatches:
                channel = int(info['channel'])
                plateBatches[plate_id].registerPlateChannelInfo(plate_id, channel, info, **kwargs)

        # Fixme: get a range of bookings only
        for b in dm.get_bookings(orderBy='start'):
            e = b.experiment
            if e and 'plates' in e:
                for plateInfo in e['plates']:
                    _registerInfo(plateInfo, booking=b)

        cond = "type=='update_plate'"
        for entry in dm.get_entries(condition=cond):
            _registerInfo(entry.extra['data'], project=entry.project)

        return batches

    @dc.content
    def batch_content(**kwargs):
        batch_id = int(kwargs['batch'])
        data = {
            'batch': load_batches(batch_id)[batch_id]
        }
        return data

    @dc.content
    def plates(**kwargs):
        batches = list(batches_map()['batches'])
        batch = batches[0]

        if 'batch' in kwargs:
            batch_id = int(kwargs['batch'])
            for b in batches:
                if b.id == batch_id:
                    batch = b
        return {
            'batches': batches,
            'batch': batch
        }

    @dc.content
    def plate_form(**kwargs):
        dm = dc.app.dm
        form = dm.get_form_by(name='form:plate')
        info = {'status': 'active'}
        plateDict = {}
        plate_id = int(kwargs.get('plate', 0))
        batch_id = int(kwargs.get('batch', 0))

        if plate_id:
            plate = dm.get_puck_by(id=plate_id)
            extra = plate.extra
            batch_id = plate.dewar
            info = {
                'plate': plate.cane,
                'status': extra.get('status', 'active'),
                'comments': extra.get('comments', '')
            }
            plateDict = {'id': plate_id, 'number': plate.cane}

        data = dc.dynamic_form(form, form_values=info)
        data.update(plates(**kwargs))
        data.update({
            'plate': plateDict,
            'batch_id': batch_id
        })
        return data

    @dc.content
    def plate_channel_form(**kwargs):
        form = dc.app.dm.get_form_by(name='form:plate_channel')
        plate_id = int(kwargs['plate'])
        channel = int(kwargs['channel'])
        p = dc.app.dm.get_puck_by(id=plate_id)

        if p is None:
            raise Exception("Invalid Plate with id %s" % plate_id)

        plate = {
            'id': p.id,
            'number': p.cane,
            'label': p.label,
            'batch': p.dewar
        }
        data = {
            'plate': plate,
            'channel': channel
        }
        info = p.extra.get('channels', {}).get(str(channel))
        data.update(dc.dynamic_form(form, form_values=info))

        return data

    @dc.content
    def batches_map(**kwargs):
        batches = sorted(load_batches().values(),
                         key=lambda b: b.id, reverse=True)

        return {'batches': batches}


