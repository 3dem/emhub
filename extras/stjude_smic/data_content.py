
class Batch:
    """ Helper class to store plates information. """
    def __init__(self, batch_id):
        # Store info about plates (e.g. number and channels)
        self.id = batch_id
        self._plates = {}

    def addPlate(self, p):
        self._plates[p.id] = {
            'id': p.id,
            'number': p.cane,
            'label': p.label,
            'channels': {}
        }

    def registerPlateInfo(self, plate, booking=None, project=None):
        plate_id = int(plate['plate'])
        if plate_id in self._plates:
            channel_id = int(plate['channel'])
            channels = self._plates[plate_id]['channels']
            channels[channel_id] = {
                'booking': booking,
                'project': project,
                'issues': plate.get('issues', False),
                'sample': plate.get('sample', ''),
                'comments': plate.get('comments', '')
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
        return {p['id']: __availableChannels(p) for p in self.plates}


def register_content(dc):
    def load_batches(batch_id=None):
        """ Load one of all batches. """
        dm = dc.app.dm  # shortcut
        batches = {}
        plateBatches = {}

        for p in dm.get_pucks():
            b = p.dewar
            if batch_id is None or batch_id == b:
                if b not in batches:
                    batches[b] = Batch(b)
                batches[b].addPlate(p)
                plateBatches[p.id] = batches[b]

        def _registerInfo(plate, **kwargs):
            plate_id = int(plate['plate'])
            if plate_id in plateBatches:
                plateBatches[plate_id].registerPlateInfo(plate, **kwargs)

        # Fixme: get a range of bookings only
        for b in dm.get_bookings(orderBy='start'):
            e = b.experiment
            if e and 'plates' in e:
                for plate in e['plates']:
                    _registerInfo(plate, booking=b)

        cond = "type=='update_plate'"
        for entry in dm.get_entries(condition=cond):
            _registerInfo(entry.extra['data'], project=entry.project)

        return batches

    @dc.content
    def batch_content(**kwargs):
        batch_id = int(kwargs['batch_id'])
        data = {
            'batch': load_batches(batch_id)[batch_id]
        }
        return data

    @dc.content
    def plates(**kwargs):
        plates = dc.app.dm.get_pucks()
        batches = []

        for p in plates:
            batch = p.dewar
            plate = p.cane
            if batch not in batches:
                batches.append(batch)

        batches.reverse()  # more recent first
        data = {'batches': batches}
        if batches:
            batch_id = kwargs.get('batch_id', batches[0])
            data.update(batch_content(batch_id=batch_id))

        return data

    @dc.content
    def plate_form(**kwargs):
        form = dc.app.dm.get_form_by(name='form:plate')
        data = dc.dynamic_form(form, **kwargs)
        data.update(batches_map())
        return data

    @dc.content
    def batches_map(**kwargs):
        batches = sorted(load_batches().values(),
                         key=lambda b: b.id, reverse=True)
        return {'batches': batches}


