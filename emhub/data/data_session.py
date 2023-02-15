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
from glob import glob
import numpy as np
import h5py
import datetime as dt

import mrcfile

from emtools.utils import Path
from emtools.metadata import StarFile, EPU
from emtools.image import Thumbnail


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

    def update_set(self, setId, attrsDict):
        """ Update existing set attributes.

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
        print("H5SessionData: mode: ", mode)

        if mode == 'r':
            print("Reading file: ", h5File)
        elif mode in ['w', 'a']:
            os.makedirs(os.path.dirname(h5File), exist_ok=True)
            print("Writing file: ", h5File)

        self._file = h5py.File(h5File, mode)

    def get_sets(self, attrList=None, condition=None):
        setList = []
        for k, v in self._file[self._getSetPath('')].items():
            if not attrList:
                setAttrs = dict(v.attrs)
            else:
                setAttrs = {a: v.attrs[a] for a in attrList}
            setAttrs['id'] = k
            setList.append(setAttrs)

        return setList

    def _set_group_attrs(self, group, setId, attrDict):
        attrs = {'id': setId}
        attrs.update(attrDict)
        for k, v in attrs.items():
            group.attrs[k] = v

    def create_set(self, setId, attrDict):
        group = self._file.create_group(self._getSetPath(setId))
        self._set_group_attrs(group, setId, attrDict)

    def update_set(self, setId, attrDict):
        group = self._file[self._getSetPath(setId)]
        self._set_group_attrs(group, setId, attrDict)

    def get_set_item(self, setId, itemId, attrList=None):
        itemAttrs = self._file[self._getItemPath(setId, itemId)].attrs
        return {a: itemAttrs[a] for a in attrList if a in itemAttrs}

    def get_set_items(self, setId, attrList=None, condition=None):
        # print(">>> Getting items from ", self._getSetPath(setId))
        # print(self.get_sets())

        if attrList is None:
            attrs = list(ImageSessionData.MIC_ATTRS.keys())
        elif 'id' not in attrList:
            attrs = ['id'] + attrList
        else:
            attrs = attrList

        # Check that all requested attributes in attrList are valid for Micrograph
        # if any(a not in ImageSessionData.MIC_ALL_ATTRS for a in attrs):
        #     raise Exception("Invalid attribute for micrograph")

        itemsList = []

        setGroup = self._file[self._getSetPath(setId)]

        for item in setGroup.values():
            #print("  item: ", item.name)
            values = {a: item.attrs[a] for a in attrs if a in item.attrs}
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
        print("update_set_item:  Getting H5 path: " + self._getItemPath(setId, itemId));
        micAttrs = self._file[self._getItemPath(setId, itemId)].attrs
        micAttrs.update(**attrDict)

    def close(self):
        self._file.close()

    def _getItemPath(self, setId, itemId):
        return '%s/item%06d' % (self._getSetPath(setId), itemId)

    def _getSetPath(self, setId):
        return '/Sets/%s' % setId


class RelionSessionData(SessionData):
    """
    Adapter class for reading Session data from Relion OTF
    """
    def __init__(self, data_path, mode='r'):
        #h5py.get_config().track_order = True
        print("Loading Relion data from:", data_path)
        self._path = data_path
        self._epuData = None

    def join(self, *paths):
        return os.path.join(self._path, *paths)

    def _jobs(self, jobType):
        jobs = glob(self.join(jobType, 'job*'))
        jobs.sort()
        return jobs

    def get_last_star(self, jobType, starFn):
        jobDirs = self._jobs(jobType)
        if not jobDirs:
            return None

        fn = self.join(jobDirs[-1], starFn)

        if '*' in starFn:  # it is a glob pattern, let's find the last file
            files = glob(fn)
            files.sort()
            fn = files[-1]

        return fn

    def getEpuData(self):
        if not self._epuData:
            star = self.join('EPU', 'movies.star')
            self._epuData = EPU.Data(star) if star and os.path.exists(star) else None
        return self._epuData

    def mtime(self, fn):
        return os.path.getmtime(self.join(fn))

    def get_stats(self):

        def _hours(tsFirst, tsLast):
            dtFirst = dt.datetime.fromtimestamp(tsFirst)
            dtLast = dt.datetime.fromtimestamp(tsLast)
            d = dtLast - dtFirst
            return d.days * 24 + d.seconds / 3600

        def _stats_from_star(jobType, starFn, tableName, attribute):
            fn = self.get_last_star(jobType, starFn)
            if not fn or not os.path.exists(fn):
                return {}

            with StarFile(fn) as sf:
                if attribute == 'count':
                    return {'count': sf.getTableSize(tableName)}
                t = sf.getTable(tableName)
                firstRow, lastRow = t[0], t[-1]
                first = self.mtime(getattr(firstRow, attribute))
                last = self.mtime(getattr(lastRow, attribute))

                return {
                    'hours': _hours(first, last),
                    'count': t.size(),
                    'first': first,
                    'last': last,
                }

        moviesStar = self.get_last_star('Import', 'movies.star')
        print(f"Movies star: {moviesStar}")

        if not moviesStar:
            return {}

        if epuData := self.getEpuData():
            moviesTable = epuData.moviesTable
            first = moviesTable[0].timeStamp
            last = moviesTable[-1].timeStamp
            movieStats = {
                'count': moviesTable.size(), 'first': first, 'last': last,
                'hours': _hours(first, last)
            }
        else:
            movieStats = _stats_from_star('Import', 'movies.star',
                                          'movies', 'rlnMicrographMovieName')

        return {
            'movies': movieStats,
            'ctfs': _stats_from_star('CtfFind', 'micrographs_ctf.star',
                                     'micrographs', 'rlnMicrographName'),
            'classes2d': _stats_from_star('Class2D', 'run_it*_model.star',
                                          'model_classes', 'count')
        }

    def _last_micFn(self):
        """ Return micrographs star file from the last CTF job or None
        if there no run yet or output file.
        """
        jobs = self._jobs('CtfFind')
        if jobs:
            micFn = self.join(jobs[-1], 'micrographs_ctf.star')
            if os.path.exists(micFn):
                return micFn
        return None

    def get_micrographs(self):
        """ Return an iterator over the micrographs' CTF information. """
        micFn = self._last_micFn()
        if not micFn:
            return []

        epuData = self.getEpuData()
        epuMovies = {Path}

        with StarFile(micFn) as sf:
            for row in sf.iterTable('micrographs'):
                #micFn = self.join(row.rlnMicrographName)
                micData = {
                    'micrograph': row.rlnMicrographName,
                    #'micTs': os.path.getmtime(micFn),
                    'ctfImage': row.rlnCtfImage,
                    'ctfDefocus': row.rlnDefocusU,
                    'ctfResolution': row.rlnCtfMaxResolution,
                    'ctfDefocusAngle': row.rlnDefocusAngle,
                    'ctfAstigmatism': row.rlnCtfAstigmatism
                }
                yield micData

    def get_micrograph_data(self, micId, attrList=None):
        micFn = self._last_micFn()

        if micFn:
            with StarFile(micFn) as sf:
                otable = sf.getTable('optics')
                for row in sf.iterTable('micrographs', start=micId):
                    micThumb = Thumbnail(output_format='base64',
                                         max_size=(512, 512),
                                         contrast_factor=1,
                                         gaussian_filter=0)
                    psdThumb = Thumbnail(output_format='base64',
                                         max_size=(128, 128),
                                         contrast_factor=3,
                                         gaussian_filter=0)

                    micFn = self.join(row.rlnMicrographName)
                    print(f">>> Reading micrograph: {micFn}")
                    micThumbBase64 = micThumb.from_mrc(micFn)
                    psdFn = self.join(row.rlnCtfImage).replace(':mrc', '')
                    pixelSize = otable[0].rlnMicrographPixelSize

                    loc = EPU.get_movie_location(micFn)

                    return {
                        'micThumbData': micThumbBase64,
                        'psdData': psdThumb.from_mrc(psdFn),
                        # 'shiftPlotData': None,
                        'ctfDefocusU': round(row.rlnDefocusU, 3),
                        'ctfDefocusV': round(row.rlnDefocusV, 3),
                        'ctfResolution': round(row.rlnCtfMaxResolution, 3),
                        'coordinates': self._get_coordinates(micFn),
                        'micThumbPixelSize': pixelSize * micThumb.scale,
                        'pixelSize': pixelSize,
                        'gridSquare': loc['gs'],
                        'foilHole': loc['fh']
                    }
        return {}

    def get_mic_location(self, **kwargs):
        epuData = self.getEpuData()
        locData = {
            'gridSquare': {},
            'foilHole': {}
        }
        thumb = Thumbnail(output_format='base64',
                          max_size=(512, 512))

        def _updateData(table, kw, key):
            if kw in kwargs:
                kwId = kwargs[kw]
                print("Looking for value: ", kwId)
                for row in table:
                    print("   row.id", row.id)
                    if row.id == kwId:
                        imgPath = self.join('EPU', row.folder, row.image)
                        locData[key] = {
                            'id': row.id,
                            'image': row.image,
                            'folder': row.folder,
                            'thumbnail': thumb.from_path(imgPath)
                        }
                        break

        _updateData(epuData.gsTable, 'gsId', 'gridSquare')
        _updateData(epuData.fhTable, 'fhId', 'foilHole')
        return locData

    def get_classes2d(self):
        """ Iterate over 2D classes. """
        items = []
        jobs2d = self._jobs('Class2D')
        if jobs2d:
            # FIXME: Find the last iteration classes
            avgMrcs = self.join(jobs2d[-1], 'run_it*_classes.mrcs')

            if '*' in avgMrcs:
                files = glob(avgMrcs)
                files.sort()
                avgMrcs = files[-1]

            dataStar = avgMrcs.replace('_classes.mrcs', '_data.star')
            modelStar = dataStar.replace('_data.', '_model.')

            mrc_stack = None
            avgThumb = Thumbnail(max_size=(100, 100),
                                 output_format='base64')

            # FIXME: An iterator should be enough here
            with StarFile(dataStar) as sf:
                ptable = sf.getTable('particles')

            with StarFile(modelStar) as sf:
                modelTable = sf.getTable('model_classes', guessType=False)

            n = ptable.size()

            # rowsIter = Table.iterRows(fileName=modelStar,
            #                           tableName='model_classes',
            #                           guessType=False)
            for row in modelTable:
                i, fn = row.rlnReferenceImage.split('@')
                if not mrc_stack:
                    mrc_stack = mrcfile.open(avgMrcs, permissive=True)
                items.append({
                    'id': '%03d' % int(i),
                    'size': round(float(row.rlnClassDistribution) * n),
                    'average': avgThumb.from_array(mrc_stack.data[int(i) - 1, :, :])
                })
            items.sort(key=lambda c: c['size'], reverse=True)
            mrc_stack.close()

        return items

    def _get_coordinates(self, micFn):
        coords = []
        pickingDirs = self._jobs('AutoPick')
        if pickingDirs:
            lastPicking = pickingDirs[-1]
            micBase = os.path.splitext(os.path.basename(micFn))[0]
            coordFn = self.join(lastPicking, 'Frames', micBase + '_autopick.star')
            if os.path.exists(coordFn):
                reader = StarFile(coordFn)
                ctable = reader.getTable('')
                reader.close()
                for row in ctable:
                    coords.append((row.rlnCoordinateX,
                                   row.rlnCoordinateY))

        return coords

    def close(self):
        pass