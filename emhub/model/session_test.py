
import os
import sqlite3
import base64
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


def get_micrograph_rows(sqliteFn, micId=None):
    """ Load a sqlite file produced by Scipion. """
    rows = None
    try:
        conn = sqlite3.connect(sqliteFn)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        whereStr = '' if micId is None else ' WHERE id=%s' % micId
        cur.execute("SELECT * FROM Objects" + whereStr)
        rows = cur.fetchall()
        conn.close()
    except Exception as e:
        print(e)

    return rows


class TestSessionData:
    """
    Very simple implementation of SessionData for testing purposes.
    This class depends on the definition of EMHUB_TESTDATA environment
    variable and the t20s_pngs folder inside it.
    """
    def __init__(self):
        testData = os.environ.get('EMHUB_TESTDATA', None)

        if testData is None:
            raise Exception('EMHUB_TESTDATA not defined.')

        self.dataDir = os.path.abspath(os.path.join(testData, 't20s_pngs'))

        if not os.path.exists(self.dataDir):
            raise Exception("Missing %s, defined by EMHUB_TESTDATA"
                            % self.dataDir)

        self._rows = get_micrograph_rows(self.getFile('ctfs.sqlite'))
        self._rowsDict = {row['id']: row for row in self._rows}

    def getFile(self, *paths):
        return os.path.join(self.dataDir, *paths)

    def getMicrographSets(self, attrList=None, condition=None, setId=None):
        return [{'id': 1}]

    def createMicrographSet(self, setId, **attrs):
        raise Exception("Not supported.")

    def getMicrographs(self, setId, attrList=None, condition=None,
                       itemId=None):
        """ Return the list of all movies of the given set.

        Args:
            setId: The id of the set containing the movies
            attrList: An optional list of attributes, to avoid returning
                all properties for each set. (e.g 'id')
            condition: An optional condition string to filter out
                the result list of objects
            itemId: If not None, only the micrograph with that id will be
                returned

        Return:
            A list with micrographs objects.
        """
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

        for row in self._rows:
            values = {a: row[MICROGRAPH_ATTRS[a]] for a in attrs}
            micList.append(Micrograph(**values))

        return micList

    def getMicrograph(self, setId, micId, dataAttrs=None):

        dattrs = dataAttrs or []

        if any(da not in MICROGRAPH_DATA_ATTRS for da in dattrs):
            raise Exception("Invalid data attribute for micrograph. ")

        attrs = list(MICROGRAPH_ATTRS.keys())
        row = self._rowsDict[micId]
        values = {a: row[MICROGRAPH_ATTRS[a]] for a in attrs}

        micPrefix = os.path.basename(values['location']).replace('_aligned_mic.mrc', '')
        for da in dattrs:
            computeFunc = getattr(self, 'compute_%s' % da)
            values[da] = computeFunc(micPrefix)

        attrs.extend(dattrs)
        Micrograph = namedtuple('Micrograph', attrs)
        return Micrograph(**values)

    def addMicrograph(self, setId, **attrsDict):
        raise Exception("Not supported.")

    def updateMicrograph(self, setId, **attrsDict):
        raise Exception("Not supported.")

    def compute_micThumbData(self, micPrefix):
        return fn_to_base64(self.getFile('imgMic/%s_thumbnail.png' % micPrefix))

    def compute_psdData(self, micPrefix):
        return fn_to_base64(self.getFile('imgPsd/%s_aligned_mic_ctfEstimation.png' % micPrefix))

    def compute_shiftPlotData(self, micPrefix):
        return fn_to_base64(self.getFile('imgShift/%s_global_shifts.png' % micPrefix))


def fn_to_base64(filename):
    """ Read the image filename as a PIL image
    and encode it as base64.
    """
    try:
        img = Image.open(filename)
        encoded = pil_to_base64(img)
        img.close()
    except:
        encoded = ''
    return encoded


def pil_to_base64(pil_img):
    """ Encode as base64 the PIL image to be
    returned as an AJAX response.
    """
    img_io = BytesIO()
    pil_img.save(img_io, format='PNG')
    return base64.b64encode(img_io.getvalue()).decode("utf-8")
