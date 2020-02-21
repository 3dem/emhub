
import os
import sqlite3
from collections import namedtuple


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
    This class dependes on the definition of EMHUB_TESTDATA environment
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

    def getFile(self, *paths):
        return os.path.join(self.dataDir, *paths)

    def getMicrographSets(self, attrsList=None, condition=None, setId=None):
        """ Get a list with all available micrograph sets.

        Args:
            attrsList: An optional list of attributes, to avoid returning
                all properties for each set. (e.g 'id')
            condition: An optional condition string to filter out
                the result list of objects
            setId: If not None, only the set with that id will be returned
        """
        return [{'id': 1}]

    def createMicrographSet(self, setId, **attrs):
        """ Create a new set of micrographs.

        Args:
            setId: The id of the new set that will be created.

        Keyword Args:
            Extra attributes that will be set to the set object.

        Return:
            True if the set was successfully created, False otherwise.
        """
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
        MICROGRAPH_ATTRS = {'id': 'id',
                            'location': 'c11',
                            'ctfDefocus': 'c01',
                            'ctfDefocusU': 'c01',
                            'ctfDefocusV': 'c02',
                            'ctfDefocusAngle': 'c03',
                            'ctfResolution': 'c06',
                            'ctfFit': 'c07'
                            }

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


    def addMicrograph(self, setId, **attrsDict):
        pass

    def updateMicrograph(self, setId, **attrsDict):
        pass

    def _get_mic_prefix(self, micId):
        micDict = {
            1: '14sep05c_c_00003gr_00014sq_00010hl_00002es.frames',
            2: '14sep05c_c_00003gr_00014sq_00011hl_00002es.frames',
            3: '14sep05c_c_00003gr_00014sq_00011hl_00003es.frames',
            4: '14sep05c_c_00003gr_00014sq_00011hl_00004es.frames'
        }
        return micDict.get(micId)

    def _get_micthumb_fn(self, micId):
        return self.getFile('imgMic/%s_thumbnail.png' % self._get_mic_prefix(micId))

    def _get_micpsd_fn(self, micId):
        return self.getFile('imgPsd/%s_aligned_mic_ctfEstimation.png'
                            % self._get_mic_prefix(micId))

    def _get_micshifts_fn(self, micId):
        return self.getFile('imgShift/%s_global_shifts.png'
                      % self._get_mic_prefix(micId))

