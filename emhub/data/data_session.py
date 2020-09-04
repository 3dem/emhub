# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *              Grigory Sharov (gsharov@mrc-lmb.cam.ac.uk) [2]
# *
# * [1] SciLifeLab, Stockholm University
# * [2] MRC Laboratory of Molecular Biology (MRC-LMB)
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# * This program is distributed in the hope that it will be useful,
# * but WITHOUT ANY WARRANTY; without even the implied warranty of
# * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# * GNU General Public License for more details.
# *
# * You should have received a copy of the GNU General Public License
# * along with this program; if not, write to the Free Software
# * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA
# * 02111-1307  USA
# *
# *  All comments concerning this program package may be sent to the
# *  e-mail address 'delarosatrevin@scilifelab.se'
# *
# **************************************************************************

import os
from collections import namedtuple
import h5py
import sqlite3

from emhub.utils import image


class SessionData:
    """
    Class that will handle the underlying data associate with a given Session.
    It will store information of the acquisition as well as the pre-processing.
    """

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

    def get_sets(self, attrList=None, condition=None, setId=None):
        """ Get a list with all available micrograph sets.

        Args:
            attrList: An optional list of attributes, to avoid returning
                all properties for each set. (e.g 'id')
            condition: An optional condition string to filter out
                the result list of objects
            setId: If not None, only the set with that id will be returned
        """
        pass

    def create_set(self, setId, setType, **attrs):
        """ Create a new set of micrographs.

        Args:
            setId: The id of the new set that will be created.
            setType: The type of the set (Either Movies, Micrographs or Ctfs

        Keyword Args:
            Extra attributes that will be set to the set object.

        Return:
            True if the set was successfully created, False otherwise.
        """
        pass

    def get_items(self, setId, attrList=None, condition=None, itemId=None):
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
        pass

    def get_item(self, setId, itemId, dataAttrs=None):
        """
        Retrieve the information of a given Micrograph, optionally with
        some images data.

        Args:
            setId: The id of the set where the requested micrograph belongs.
            itemId: The id of the micrograph to be retrieved.
            dataAttrs: Optional list of image data attributes.

        Returns:
            A Micrograph (namedtuple) with the metadata and maybe some
            data attributes (in base64 string format).
        """
        pass

    def add_item(self, setId, itemId, **attrsDict):
        pass

    def update_item(self, setId, itemId, **attrsDict):
        pass


class H5SessionData(SessionData):
    """
    Container of Session Data based on HDF5 file.
    """
    def __init__(self, h5File, mode='r'):
        #h5py.get_config().track_order = True
        if mode == 'r':
            print("Reading file: ", h5File)
        elif mode in ['w', 'a']:
            os.makedirs(os.path.dirname(h5File), exist_ok=True)
            print("Writing file: ", h5File)

        self._file = h5py.File(h5File, mode)

    def get_sets(self, attrList=None, condition=None, setId=None):
        setList = []
        if setId is not None:
            setList.append(self._file[self._getMicPath(setId)].attrs)
        else:
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
            attrs = list(self.MICROGRAPH_ATTRS.keys())
        elif 'id' not in attrList:
            attrs = ['id'] + attrList
        else:
            attrs = attrList

        # Check that all requested attributes in attrList are valid for Micrograph
        if any(a not in self.MICROGRAPH_ATTRS for a in attrs):
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
        print("Requesting item: setId: %s, itemId: %s" % (setId, itemId))
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

    def update_item(self, setId, itemId, **attrsDict):
        micAttrs = self._file[self._getMicPath(setId, itemId)].attrs
        micAttrs.update(**attrsDict)

    def close(self):
        self._file.close()

    def _getMicPath(self, setId, itemId=None):
        return ('/Micrographs/set%03d%s'
                % (setId, '' if itemId is None else '/item%05d' % itemId))


class ImageSessionData(SessionData):
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

        self._rows = self.get_micrograph_rows(self.getFile('ctfs.sqlite'))
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
            attrs = list(self.MICROGRAPH_ATTRS.keys())
        elif 'id' not in attrList:
            attrs = ['id'] + attrList
        else:
            attrs = attrList

        # Check that all requested attributes in attrList are valid for Micrograph
        if any(a not in self.MICROGRAPH_ATTRS for a in attrs):
            raise Exception("Invalid attribute for micrograph")

        Micrograph = namedtuple('Micrograph', attrs)
        micList = []

        for row in self._rows:
            values = {a: row[self.MICROGRAPH_ATTRS[a]] for a in attrs}
            micList.append(Micrograph(**values))

        return micList

    def get_item(self, setId, itemId, dataAttrs=None):

        dattrs = dataAttrs or []

        if any(da not in self.MICROGRAPH_DATA_ATTRS for da in dattrs):
            raise Exception("Invalid data attribute for micrograph. ")

        attrs = list(self.MICROGRAPH_ATTRS.keys())
        row = self._rowsDict[itemId]
        values = {a: row[self.MICROGRAPH_ATTRS[a]] for a in attrs}

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

    def get_micrograph_rows(self, sqliteFn, micId=None):
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
