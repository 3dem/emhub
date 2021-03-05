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
import numpy as np
import h5py
import sqlite3
import tables as tbl

from emhub.utils import image


class SessionData:
    """
    Class that will handle the underlying data associate with a given Session.
    It will store information of the acquisition as well as the pre-processing.
    """

    def get_sets(self, attrList=None, condition=None):
        """ Get a list with all or some sets in the session.

        Args:
            attrList: An optional list of attributes, to avoid returning
                all properties for each set. If None, only id's will be returned.
            condition: An optional condition string to filter out the result.
        """
        pass

    def create_set(self, setId, attrsDict):
        """ Create a new set in the session.

        Args:
            setId: The id of the new set that will be created.
            attrsDict: Dict-like object with keys and values

        Return:
            True if the set was successfully created, False otherwise.
        """
        pass

    def get_set_items(self, setId, attrList=None, condition=None):
        """ Return a list with all or some items from this set.

        Args:
            setId: The id of the set containing the items.
            attrList: An optional list of attributes, to avoid returning
                all properties for each set. (e.g 'id')
            condition: An optional condition string to filter out
                the result list of objects
        Return:
            A list with items (dict objects)
        """
        pass

    def get_set_item(self, setId, itemId, attrList=None):
        pass

    def add_set_item(self, setId, itemId, attrDict):
        pass

    def update_set_item(self, setId, itemId, attrDict):
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

    def get_sets(self, attrList=None, condition=None):
        if attrList is not None and len(attrList) == 0:
            attrList = ['id']
        setList = []
        for k, v in self._file[self._getSetPath('')].items():
            if attrList is None:
                setList.append(dict(v.attrs))
            else:
                setList.append({a: v[a] for a in attrList})

        return setList

    def create_set(self, setId, attrDict):
        group = self._file.create_group(self._getSetPath(setId))
        attrs = {'id': setId}
        attrs.update(attrDict)
        for k, v in attrs.items():
            group.attrs[k] = v

    def get_set_item(self, setId, itemId, attrList=None):
        itemAttrs = self._file[self._getItemPath(setId, itemId)].attrs
        return {a: itemAttrs[a] for a in attrList}

    def get_set_items(self, setId, attrList=None, condition=None):
        if attrList is None:
            attrs = list(ImageSessionData.MIC_ATTRS.keys())
        elif 'id' not in attrList:
            attrs = ['id'] + attrList
        else:
            attrs = attrList

        # Check that all requested attributes in attrList are valid for Micrograph
        if any(a not in ImageSessionData.MIC_ALL_ATTRS for a in attrs):
            raise Exception("Invalid attribute for micrograph")

        itemsList = []

        setGroup = self._file[self._getSetPath(setId)]
        print(self._getSetPath(setId))

        for item in setGroup.values():
            values = {a: item.attrs[a] for a in attrs}
            itemsList.append(values)

        return itemsList

    def add_set_item(self, setId, itemId, attrDict):
        micGroup = self._file.create_group(self._getItemPath(setId, itemId))
        micAttrs = micGroup.attrs
        micAttrs['id'] = itemId

        for key, value in attrDict.items():
            # try:
                if isinstance(value, np.ndarray):
                    micGroup.create_dataset(key, data=value)
                else:
                    micAttrs[key] = value
            # except:
            #     if value is not None:
            #         #micGroup.create_dataset(key, data=value)
            #         print("Setting attribute: ", key)
            #         print("   type: ", type(value))
            #         print("   >>> Value is None")

    def update_set_item(self, setId, itemId, attrDict):
        micAttrs = self._file[self._getMicPath(setId, itemId)].attrs
        micAttrs.update(**attrDict)

    def close(self):
        self._file.close()

    def _getItemPath(self, setId, itemId):
        return '%s/item%06d' % (self._getSetPath(setId), itemId)

    def _getSetPath(self, setId):
        return '/Sets/%s' % setId

    def _getMicPath(self, setId, itemId=None):
        return ('/Micrographs/set%03d%s'
                % (setId, '' if itemId is None else '/item%05d' % itemId))


class ImageSessionData(SessionData):
    """
    Very simple implementation of SessionData for testing purposes.
    This class depends on the definition of EMHUB_TESTDATA environment
    variable and the t20s_pngs folder inside it.
    """

    MIC_ATTRS = {
        'id': 'id',
        'location': 'c11',
        'ctfDefocus': 'c01',
        'ctfDefocusU': 'c01',
        'ctfDefocusV': 'c02',
        'ctfDefocusAngle': 'c03',
        'ctfResolution': 'c06',
        'ctfFit': 'c07'
    }

    MIC_DATA_ATTRS = [
        'micThumbData', 'psdData', 'ctfFitData', 'shiftPlotData'
    ]

    MIC_ALL_ATTRS = list(MIC_ATTRS.keys()) + MIC_DATA_ATTRS

    def __init__(self, useBase64=True):
        self._useBase64 = useBase64

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

    def get_sets(self, attrList=None, condition=None):
        return [{'id': 1}]

    def create_set(self, setId, attrDict):
        raise Exception("Not supported.")

    def get_set_items(self, setId, attrList=None, condition=None):
        if condition is not None:
            raise Exception("condition evaluation not implemented. ")

        attrs = self._get_attrs(attrList)

        return [self._get_dict_from_row(row, attrs) for row in self._rows]

    def get_set_item(self, setId, itemId, attrList=None):
        return self._get_dict_from_row(self._rowsDict[itemId],
                                       self._get_attrs(attrList))

    def add_set_item(self, setId, attrDict):
        raise Exception("Not supported.")

    def update_set_item(self, setId, attrDict):
        raise Exception("Not supported.")

    # ------------------------ Utility functions ------------------------
    def _load_image(self, fn):
        if self._useBase64:
            return image.fn_to_base64(fn)
        else:
            return image.fn_to_blob(fn)

    def compute_micThumbData(self, micPrefix):
        fn = self.getFile('imgMic/%s_thumbnail.png' % micPrefix)
        return self._load_image(fn)

    def compute_psdData(self, micPrefix):
        fn = self.getFile('imgPsd/%s_aligned_mic_ctfEstimation.png'
                          % micPrefix)
        return self._load_image(fn)

    def compute_shiftPlotData(self, micPrefix):
        return self._load_image(self.getFile('imgShift/%s_global_shifts.png'
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

    def _get_attrs(self, attrList):
        if attrList is None:
            attrs = list(self.MIC_ATTRS.keys())
        elif 'id' not in attrList:
            attrs = ['id'] + attrList
        else:
            attrs = attrList

        # Check that all requested attributes in attrList are valid for Micrograph
        if any(a not in self.MIC_ALL_ATTRS for a in attrs):
            raise Exception("Invalid attribute for micrograph")

        return attrs

    def _get_dict_from_row(self, row, attrs):
        values = {a: row[self.MIC_ATTRS[a]] for a in attrs if a in self.MIC_ATTRS}

        micPrefix = os.path.basename(values['location']).replace('_aligned_mic.mrc', '')
        for a in attrs:
            # Compute data for some of the attributes
            computeFunc = getattr(self, 'compute_%s' % a, None)
            if computeFunc:
                values[a] = computeFunc(micPrefix)

        return values


class PytablesSessionData(SessionData):
    """ Implementation of SessionData using pytables. """
    #TODO: pytables stores strings as bytes, need to decode when reading
    # they are also fixed size length :(

    class SetOfMicrographs(tbl.IsDescription):
        id = tbl.Int32Col()
        extra = tbl.StringCol(256)

    class Micrograph(tbl.IsDescription):
        id = tbl.Int32Col()
        location = tbl.StringCol(256)
        ctfDefocus = tbl.Float32Col()
        ctfDefocusU = tbl.Float32Col()
        ctfDefocusV = tbl.Float32Col()
        ctfDefocusAngle = tbl.Float32Col()
        ctfResolution = tbl.Float32Col()
        ctfFit = tbl.Float32Col()
        micThumbData = tbl.StringCol(256000)
        psdData = tbl.StringCol(256000)
        ctfFitData = tbl.StringCol(256000)
        shiftPlotData = tbl.StringCol(256000)

    def __init__(self, h5File, mode='r'):
        if mode == 'r':
            print("Reading file: ", h5File)
        elif mode in ['w', 'a']:
            os.makedirs(os.path.dirname(h5File), exist_ok=True)
            print("Writing file: ", h5File)

        self._file = tbl.open_file(h5File, mode)

    def get_sets(self, attrList=None, condition=None, setId=None):
        setList = []
        if setId is not None:
            setTbl = self._file.get_node(self._getMicSet(setId) + '/set_tbl')
            # setTbl has only one row
            row = setTbl[0]
            setList.append({k: row[k] for k in setTbl.colnames})
        else:
            for grp in self._file.iter_nodes("/Micrographs"):
                values = {k: grp.set_tbl[0][k] for k in grp.set_tbl.colnames}
                setList.append(values)

        return setList

    def create_set(self, setId, attrs):
        self._file.create_group("/Micrographs", "set%03d" % setId,
                                createparents=True)
        setTbl = self._file.create_table(self._getMicSet(setId), 'set_tbl',
                                         self.SetOfMicrographs,
                                         "Set table")
        setRow = setTbl.row
        attrs.update({'id': setId})

        for key, value in attrs.items():
            setRow[key] = value
        setRow.append()
        setTbl.flush()
        mics_table = self._file.create_table(self._getMicSet(setId), 'mics_tbl',
                                             self.Micrograph, "Mics table")
        mics_table.flush()

    def get_items(self, setId, attrList=None, condition=None,
                  itemId=None):
        mics_table = self._file.get_node(self._getMicSet(setId), 'mics_tbl')

        if attrList is None:
            keys = mics_table.colnames
        elif 'id' not in attrList:
            keys = ['id'] + attrList
        else:
            keys = attrList

        Micrograph = namedtuple('Micrograph', keys)
        micList = []

        for row in mics_table:
            values = dict()
            for k in keys:
                if isinstance(row[k], bytes):
                    values[k] = row[k].decode()
                else:
                    values[k] = row[k]

            #values = {k: row[k] for k in keys}
            micList.append(Micrograph(**values))

        return micList

    def get_item(self, setId, itemId, dataAttrs=None):
        print("Requesting item: setId: %s, itemId: %s" % (setId, itemId))
        mics_table = self._file.get_node(self._getMicSet(setId), 'mics_tbl')
        mic = mics_table[itemId-1]  # pytables rows start from 0

        keys = mics_table.colnames if dataAttrs is None else dataAttrs
        Micrograph = namedtuple('Micrograph',keys)
        values = dict()
        for k in keys:
            if isinstance(mic[k], bytes):
                values[k] = mic[k].decode()
            else:
                values[k] = mic[k]

        #values = {k: mic[k] for k in keys}
        return Micrograph(**values)

    def add_item(self, setId, itemId, **attrDict):
        mics_table = self._file.get_node(self._getMicSet(setId), 'mics_tbl')
        mic = mics_table.row

        attrDict.update({'id': itemId})
        for key, value in attrDict.items():
            mic[key] = value

        mic.append()
        mics_table.flush()

    def update_item(self, setId, itemId, **attrDict):
        mics_table = self._file.get_node(self._getMicSet(setId), 'mics_tbl')
        itemId = int(itemId) - 1  # pytables rows start from 0
        mics_table.modify_columns(itemId, itemId+1,
                                  columns=[[x] for x in attrDict.values()],
                                  names=list(attrDict.keys()))
        mics_table.flush()

    def close(self):
        self._file.close()

    def _getMicSet(self, setId):
        return '/Micrographs/set%03d' % setId
