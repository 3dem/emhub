
import base64
import h5py
from collections import namedtuple
from io import BytesIO
from PIL import Image


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

    def getMicrographSets(self, attrList=None, condition=None, setId=None):
        return [{'id': 1}]

    def _getMicPath(self, setId, micId=None):
        return ('/Micrographs/set%03d%s'
                % (setId, '' if micId is None else '/item%05d' % micId))

    def createMicrographSet(self, setId, **attrs):
        self._file.create_group(self._getMicPath(setId))
        #self._file.create_dataset(name='setId',
        #                          data=str(self._getMicPath(setId)).encode('utf-8'),
        #                          dtype=h5py.string_dtype(encoding='utf-8'),
        #                          compression='gzip')

    def getMicrographs(self, setId, attrList=None, condition=None,
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

    def getMicrograph(self, setId, micId, dataAttrs=None):
        micAttrs = self._file[self._getMicPath(setId, micId)].attrs
        keys = list(micAttrs.keys())
        if dataAttrs is not None:
            for da in dataAttrs:
                if da not in keys:
                    keys.append(da)
        Micrograph = namedtuple('Micrograph', keys)
        values = {k: micAttrs[k] for k in keys}
        values['id'] = int(values['id'])
        return Micrograph(**values)

    def addMicrograph(self, setId, micId, **attrsDict):
        micAttrs = self._file.create_group(self._getMicPath(setId, micId)).attrs

        micAttrs['id'] = micId

        for key, value in attrsDict.items():
            micAttrs[key] = value

    def updateMicrograph(self, setId, **attrsDict):
        raise Exception("Not supported.")

    def close(self):
        self._file.close()


def fn_to_base64(filename):
    """ Read the image filename as a PIL image
    and encode it as base64.
    """
    img = Image.open(filename)
    encoded = pil_to_base64(img)
    img.close()
    return encoded


def pil_to_base64(pil_img):
    """ Encode as base64 the PIL image to be
    returned as an AJAX response.
    """
    img_io = BytesIO()
    pil_img.save(img_io, format='PNG')
    return base64.b64encode(img_io.getvalue()).decode("utf-8")


if __name__ == '__main__':
    setId = 1

    from session_test import TestSessionData
    tsd = TestSessionData()
    mics = tsd.getMicrographs(setId)

    hsd = H5SessionData('/tmp/data.h5', 'w')
    hsd.createMicrographSet(setId, label='Test set')

    for mic in mics:
        micData = tsd.getMicrograph(setId, mic.id,
                                    dataAttrs=['micThumbData',
                                               'psdData',
                                               'shiftPlotData'])
        hsd.addMicrograph(setId, micId=mic.id, **micData._asdict())

    hsd.close()

    hsd = H5SessionData('/tmp/data.h5', 'r')
    for mic in hsd.getMicrographs(setId):
        print(mic)
