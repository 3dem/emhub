
def register_content(dc):

    @dc.content
    def batch_content(**kwargs):
        dm = dc.app.dm  # shortcut

        batch_id = int(kwargs['batch_id'])
        batch = {
            'id': batch_id,
            'plates': []
        }
        plates = dm.get_pucks()
        platesDict = {}
        platesIdMap = {}

        for p in plates:
            b = p.dewar
            plate_number = p.cane
            if batch_id == b:
                platesDict[plate_number] = {}
                platesIdMap[p.id] = plate_number
                batch['plates'].append(plate_number)

        def _infoFromPlate(plate, b=None, p=None):
            plate_id = int(plate['plate'])
            if plate_id in platesIdMap:
                channel_id = int(plate['channel'])
                plate_number = platesIdMap[plate_id]
                platesDict[plate_number][channel_id] = {
                    'booking': b,
                    'project': p,
                    'issues': plate.get('issues', False),
                    'sample': plate.get('sample', ''),
                    'comments': plate.get('comments', '')
                }

        # Fixme: get a range of bookings only
        for b in dm.get_bookings(orderBy='start'):
            e = b.experiment
            if e and 'plates' in e:
                for plate in e['plates']:
                    _infoFromPlate(plate, b=b)

        cond = "type=='update_plate'"
        for entry in dm.get_entries(condition=cond):
            _infoFromPlate(entry.extra['data'], p=entry.project)

        data = {
            'batch': batch,
            'platesDict': platesDict
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
        data.update(plates())

        return data
