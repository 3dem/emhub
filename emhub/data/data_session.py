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


class RelionSessionData:
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
                                         contrast_factor=0.15,
                                         gaussian_filter=0)
                    psdThumb = Thumbnail(output_format='base64',
                                         max_size=(128, 128),
                                         contrast_factor=1,
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
        gsId = kwargs.get('gsId', '')
        locData = {
            'gridSquare': {},
            'foilHole': {}
        }
        thumb = Thumbnail(output_format='base64',
                          max_size=(512, 512))

        for row in epuData.gsTable:
            if row.id == gsId:
                imgPath = self.join('EPU', row.folder, row.image)
                locData['gridSquare'] = {
                    'id': row.id,
                    'image': row.image,
                    'folder': row.folder,
                    'thumbnail': thumb.from_path(imgPath)
                }
                break

        def _microns(v):
            return round(v * 0.0001, 3)

        defocus = []
        resolution = []
        for mic in self.get_micrographs():
            loc = EPU.get_movie_location(mic['micrograph'])
            if loc['gs'] == gsId:
                defocus.append(_microns(mic['ctfDefocus']))
                resolution.append(round(mic['ctfResolution'], 3))

        locData.update({'defocus': defocus, 'resolution': resolution})

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