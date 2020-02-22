
import h5py
from collections import namedtuple


MICROGRAPH_ATTRS = {
    'id': 'id',
    'location': 'c11',
    'ctfDefocus': 'c01',
    'ctfDefocusU': 'c01',
    'ctfDefocusV': 'c02',
    'ctfDefocusAngle': 'c03',
    'ctfResolution': 'c06',
    'ctfFit': 'c07'
}

MICROGRAPH_DATA_ATTRS = [
    'micThumbData', 'psdData', 'ctfFitData', 'shiftPlotData'
]


class H5SessionData:
    """
    Container of Session Data based on HDF5 file.
    """
    def __init__(self, h5File, mode='r'):
        #h5py.get_config().track_order = True
        self._file = h5py.File(h5File, mode)

    def get_sets(self, attrList=None, condition=None, setId=None):
        setList = []
        for k, v in self._file['/Micrographs/'].items():
            setList.append(dict(v.attrs))
        return setList

    def create_set(self, setId, **attrs):
        group = self._file.create_group(self._getMicPath(setId))
        attrs.update({'id': setId})
        for k, v in attrs.items():
            group.attrs[k] = v

        #self._file.create_dataset(name='setId',
        #                          data=str(self._getMicPath(setId)).encode('utf-8'),
        #                          dtype=h5py.string_dtype(encoding='utf-8'),
        #                          compression='gzip')

    def get_items(self, setId, attrList=None, condition=None,
                       itemId=None):
        if attrList is None:
            attrs = list(MICROGRAPH_ATTRS.keys())
        elif 'id' not in attrList:
            attrs = ['id'] + attrList
        else:
            attrs = attrList

        # Check that all requested attributes in attrList are valid for Micrograph
        if any(a not in MICROGRAPH_ATTRS for a in attrs):
            raise Exception("Invalid attribute for micrograph")

        Micrograph = namedtuple('Micrograph', attrs)
        micList = []

        micSet = self._file[self._getMicPath(setId)]

        for mic in micSet.values():
            micAttrs = mic.attrs
            values = {a: micAttrs[a] for a in attrs}
            values['id'] = int(values['id'])
            micList.append(Micrograph(**values))

        return micList

    def get_item(self, setId, itemId, dataAttrs=None):
        print("Requesting item: sessionId: %s, itemId: %s" % (setId, itemId))
        micAttrs = self._file[self._getMicPath(setId, itemId)].attrs
        keys = list(micAttrs.keys())
        if dataAttrs is not None:
            for da in dataAttrs:
                if da not in keys:
                    keys.append(da)
        Micrograph = namedtuple('Micrograph', keys)
        values = {k: micAttrs[k] for k in keys}
        values['id'] = int(values['id'])
        return Micrograph(**values)

    def add_item(self, setId, itemId, **attrsDict):
        micAttrs = self._file.create_group(self._getMicPath(setId, itemId)).attrs

        micAttrs['id'] = itemId

        for key, value in attrsDict.items():
            micAttrs[key] = value

    def update_item(self, setId, **attrsDict):
        raise Exception("Not supported.")

    def close(self):
        self._file.close()

    def _getMicPath(self, setId, itemId=None):
        return ('/Micrographs/set%03d%s'
                % (setId, '' if itemId is None else '/item%05d' % itemId))


if __name__ == '__main__':
    setId = 1

    from session_test import TestSessionData
    tsd = TestSessionData()
    mics = tsd.get_items(setId)

    hsd = H5SessionData('/tmp/data.h5', 'w')
    hsd.create_set(setId, label='Test set')

    for mic in mics:
        micData = tsd.get_item(setId, mic.id,
                                    dataAttrs=['micThumbData',
                                               'psdData',
                                               'shiftPlotData'])
        hsd.add_item(setId, itemId=mic.id, **micData._asdict())

    hsd.close()

    hsd = H5SessionData('/tmp/data.h5', 'r')
    for mic in hsd.get_items(setId):
        print(mic)
