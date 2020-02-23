
import os
from collections import namedtuple
import sqlite3

from emhub.utils import image


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

    def get_sets(self, attrList=None, condition=None, setId=None):
        return [{'id': 1}]

    def create_set(self, setId, **attrs):
        raise Exception("Not supported.")

    def get_items(self, setId, attrList=None, condition=None,
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

    def get_item(self, setId, itemId, dataAttrs=None):

        dattrs = dataAttrs or []

        if any(da not in MICROGRAPH_DATA_ATTRS for da in dattrs):
            raise Exception("Invalid data attribute for micrograph. ")

        attrs = list(MICROGRAPH_ATTRS.keys())
        row = self._rowsDict[itemId]
        values = {a: row[MICROGRAPH_ATTRS[a]] for a in attrs}

        micPrefix = os.path.basename(values['location']).replace('_aligned_mic.mrc', '')
        for da in dattrs:
            computeFunc = getattr(self, 'compute_%s' % da)
            values[da] = computeFunc(micPrefix)

        attrs.extend(dattrs)
        Micrograph = namedtuple('Micrograph', attrs)
        return Micrograph(**values)

    def add_item(self, setId, **attrsDict):
        raise Exception("Not supported.")

    def update_item(self, setId, **attrsDict):
        raise Exception("Not supported.")

    def compute_micThumbData(self, micPrefix):
        fn = self.getFile('imgMic/%s_thumbnail.png' % micPrefix)
        return image.fn_to_base64(fn)

    def compute_psdData(self, micPrefix):
        fn = self.getFile('imgPsd/%s_aligned_mic_ctfEstimation.png'
                          % micPrefix)
        return image.fn_to_base64(fn)

    def compute_shiftPlotData(self, micPrefix):
        return image.fn_to_base64(self.getFile('imgShift/%s_global_shifts.png'
                                               % micPrefix))
