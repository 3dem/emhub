
import os
import sqlite3


def load_scipion_db(sqliteFn):
    """ Load a sqlite file produced by Scipion. """
    rows = None
    try:
        conn = sqlite3.connect(sqliteFn)
        cur = conn.cursor()
        cur.execute("SELECT * FROM Objects")
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

        self._rows = load_scipion_db(self.getFile('ctfs.sqlite'))

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

    def getMicrographs(self, setId, attrsList=None, condition=None,
                       itemId=None):
        """ Return the list of all movies of the given set.

        Args:
            setId: The id of the set containing the movies
            attrsList: An optional list of attributes, to avoid returning
                all properties for each set. (e.g 'id')
            condition: An optional condition string to filter out
                the result list of objects
            itemId: If not None, only the micrograph with that id will be
                returned

        Return:
            A list with micrographs objects.
        """
        pass

    def addMicrograph(self, setId, **attrsDict):
        pass

    def updateMicrograph(self, setId, **attrsDict):
        pass



