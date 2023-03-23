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
import datetime as dt
from glob import glob

import mrcfile
from emtools.utils import Path
from emtools.metadata import StarFile, EPU, SqliteFile
from emtools.image import Thumbnail


def hours(tsFirst, tsLast):
    dtFirst = dt.datetime.fromtimestamp(tsFirst)
    dtLast = dt.datetime.fromtimestamp(tsLast)
    d = dtLast - dtFirst
    return d.days * 24 + d.seconds / 3600


class SessionData:
    """ Base class with common functionality. """
    def __init__(self, data_path, mode='r'):
        self._path = data_path
        self._epuData = None

    def join(self, *paths):
        return os.path.join(self._path, *paths)

    def getEpuData(self):
        if not self._epuData:
            epuFolder = self.join('EPU')
            if Path.exists(epuFolder):
                self._epuData = EPU.Data(epuFolder, epuFolder)
        return self._epuData

    def mtime(self, fn):
        from emtools.utils import Pretty
        print(f"Getting time from: {self.join(fn)}: {Pretty.timestamp(os.path.getmtime(self.join(fn)))}")
        return os.path.getmtime(self.join(fn))

    def close(self):
        """ Deprecated, just for backward compatibility. """
        pass

    # ------------ Functions to override in subclasses ---------------------
    def get_stats(self):
        return {'movies': {'count': 0}, 'ctfs': {'count': 0}}

    def get_micrographs(self):
        return []

    def get_micrograph_data(self):
        return {}

    def get_micrograph_coordinates(self, micName):
        return []

    def get_micrograph_gridsquare(self, **kwargs):
        epuData = self.getEpuData()
        gsId = kwargs.get('gsId', '')
        locData = {
            'gridSquare': {},
            'foilHole': {}
        }
        if epuData is None:
            return locData

        thumb = Thumbnail(output_format='base64', max_size=(512, 512))

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
        pass


class RelionSessionData(SessionData):
    """
    Adapter class for reading Session data from Relion OTF
    """
    def get_stats(self):

        def _stats_from_star(jobType, starFn, tableName, attribute):
            fn = self.get_last_star(jobType, starFn)
            if not fn or not os.path.exists(fn):
                return {'count': 0}

            with StarFile(fn) as sf:
                if attribute == 'count':
                    return {'count': sf.getTableSize(tableName)}
                t = sf.getTable(tableName)
                firstRow, lastRow = t[0], t[-1]
                first = self.mtime(getattr(firstRow, attribute))
                last = self.mtime(getattr(lastRow, attribute))

                return {
                    'hours': hours(first, last),
                    'count': t.size(),
                    'first': first,
                    'last': last,
                }

        moviesStar = self.get_last_star('Import', 'movies.star')
        if not moviesStar:
            return {'movies': {'count': 0}, 'ctfs': {'count': 0}}

        countEpu = 0
        if epuData := self.getEpuData():
            moviesTable = epuData.moviesTable
            first = moviesTable[0].timeStamp
            last = moviesTable[-1].timeStamp
            countEpu = moviesTable.size()
            msEpu = {
                'count': countEpu, 'first': first, 'last': last,
                'hours': hours(first, last)
            }

        msImport = _stats_from_star('Import', 'movies.star',
                                    'movies', 'rlnMicrographMovieName')
        movieStats = msEpu if countEpu > msImport['count'] else msImport

        return {
            'movies': movieStats,
            'ctfs': _stats_from_star('CtfFind', 'micrographs_ctf.star',
                                     'micrographs', 'rlnMicrographName'),
            'classes2d': _stats_from_star('Class2D', 'run_it*_model.star',
                                          'model_classes', 'count')
        }

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

    def get_micrograph_data(self, micId):
        micFn = self._last_micFn()
        if micFn:
            with StarFile(micFn) as sf:
                otable = sf.getTable('optics')
                row = sf.getTableRow('micrographs', start=micId - 1)
                micThumb = Thumbnail(output_format='base64',
                                     max_size=(512, 512),
                                     contrast_factor=0.15,
                                     gaussian_filter=0)
                psdThumb = Thumbnail(output_format='base64',
                                     max_size=(128, 128),
                                     contrast_factor=1,
                                     gaussian_filter=0)

                micFn = self.join(row.rlnMicrographName)
                micThumbBase64 = micThumb.from_mrc(micFn)
                psdFn = self.join(row.rlnCtfImage).replace(':mrc', '')
                pixelSize = otable[0].rlnMicrographPixelSize

                loc = EPU.get_movie_location(micFn)

                return {
                    'micThumbData': micThumbBase64,
                    'psdData': psdThumb.from_mrc(psdFn),
                    # 'shiftPlotData': None,
                    'ctfDefocusU': round(row.rlnDefocusU/10000., 2),
                    'ctfDefocusV': round(row.rlnDefocusV/10000., 2),
                    'ctfDefocusAngle': round(row.rlnDefocusAngle, 2),
                    'ctfAstigmatism': round(row.rlnCtfAstigmatism/10000, 2),
                    'ctfResolution': round(row.rlnCtfMaxResolution, 2),
                    'coordinates': self.get_micrograph_coordinates(micFn),
                    'micThumbPixelSize': pixelSize * micThumb.scale,
                    'pixelSize': pixelSize,
                    'gridSquare': loc['gs'],
                    'foilHole': loc['fh']
                }
        return {}

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

    def get_micrograph_coordinates(self, micFn):
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

    # ----------------------- UTILS ---------------------------
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

    def _last_micFn(self):
        """ Return micrographs star file from the last CTF job or None
        if there is no run yet or output file.
        """
        jobs = self._jobs('CtfFind')
        if jobs:
            micFn = self.join(jobs[-1], 'micrographs_ctf.star')
            if os.path.exists(micFn):
                return micFn
        return None


class ScipionSessionData(SessionData):
    """
    Adapter class for reading Session data from Relion OTF
    """
    def __init__(self, data_path, mode='r'):
        SessionData.__init__(self, data_path, mode=mode)
        projDb = self.join('project.sqlite')

        if not os.path.exists(projDb):
            raise Exception("Missing project DB: " + projDb)

        results = glob(self.join('Runs', '??????_*', '*.sqlite'))
        results.sort()
        outputs = {}

        for r in results:
            if r.endswith('ProtImportMovies/movies.sqlite'):
                outputs['movies'] = r
            elif r.endswith('ctfs.sqlite'):
                outputs['ctfs'] = r
            elif r.endswith('coordinates.sqlite'):
                outputs['coordinates'] = r
            elif r.endswith('classes2D.sqlite'):
                outputs['classes2d'] = r

        self.outputs = outputs

    def get_stats(self):
        def _stats_from_sqlite(sqliteFn, fileKey=None):
            with SqliteFile(sqliteFn) as sf:
                size = sf.getTableSize('Objects')
                stats = {
                    'hours': 0,
                    'count': size,
                    'first': '',
                    'last': '',
                }
                if fileKey is not None:
                    first = sf.getTableRow('Objects', 0, classes='Classes')
                    last = sf.getTableRow('Objects', size - 1, classes='Classes')
                    stats['first'] = self.mtime(first[fileKey])
                    stats['last'] = self.mtime(last[fileKey])
                    stats['hours'] = hours(stats['first'], stats['last'])
                return stats

        if 'movies' not in self.outputs:
            return {'movies': {'count': 0}, 'ctfs': {'count': 0}}

        countEpu = 0
        if epuData := self.getEpuData():
            moviesTable = epuData.moviesTable
            first = moviesTable[0].timeStamp
            last = moviesTable[-1].timeStamp
            countEpu = moviesTable.size()
            msEpu = {
                'count': countEpu, 'first': first, 'last': last,
                'hours': hours(first, last)
            }

        return {
            #'movies': _stats_from_sqlite(self.outputs['movies']),
            'movies': msEpu,
            'ctfs': _stats_from_sqlite(self.outputs['ctfs'], fileKey='_psdFile'),
            'classes2d': _stats_from_sqlite(self.outputs['classes2d'])
        }

    def get_micrographs(self):
        """ Return an iterator over the micrographs' CTF information. """
        if 'ctfs' not in self.outputs:
            return []

        ctfSqlite = self.outputs['ctfs']
        with SqliteFile(ctfSqlite) as sf:
            for row in sf.iterTable('Objects', classes='Classes'):
                # yield row
                # continue
                dU, dV = row['_defocusU'], row['_defocusV']
                micData = {
                    'micrograph': row['_micObj._filename'],
                    #'micTs': os.path.getmtime(micFn),
                    'ctfImage': row['_psdFile'],
                    'ctfDefocus': row['_defocusU'],
                    'ctfResolution': min(row['_resolution'], 25),
                    'ctfDefocusAngle': row['_defocusAngle'],
                    'ctfAstigmatism': abs(dU - dV)
                }
                yield micData

    def get_micrograph_data(self, micId):
        if ctfSqlite := self.outputs.get('ctfs', None):
            with SqliteFile(ctfSqlite) as sf:
                row = sf.getTableRow('Objects', micId - 1, classes='Classes')
                micThumb = Thumbnail(output_format='base64',
                                     max_size=(512, 512),
                                     contrast_factor=0.15,
                                     gaussian_filter=0)
                psdThumb = Thumbnail(output_format='base64',
                                     max_size=(128, 128),
                                     contrast_factor=1,
                                     gaussian_filter=0)

                micFn = self.join(row['_micObj._filename'])
                micThumbBase64 = micThumb.from_mrc(micFn)
                psdFn = self.join(row['_psdFile']).replace(':mrc', '')
                pixelSize = row['_micObj._samplingRate']

                loc = EPU.get_movie_location(micFn)
                dU, dV = row['_defocusU'], row['_defocusV']

                return {
                    'micThumbData': micThumbBase64,
                    'psdData': psdThumb.from_mrc(psdFn),
                    # 'shiftPlotData': None,
                    'ctfDefocusU': round(dU/10000., 2),
                    'ctfDefocusV': round(dV/10000., 2),
                    'ctfDefocusAngle': round(row['_defocusAngle'], 2),
                    'ctfAstigmatism': round(abs(dU - dV)/10000, 2),
                    'ctfResolution': round(row['_resolution'], 2),
                    'coordinates': self.get_micrograph_coordinates(row['_micObj._micName']),
                    'micThumbPixelSize': pixelSize * micThumb.scale,
                    'pixelSize': pixelSize,
                    'gridSquare': loc['gs'],
                    'foilHole': loc['fh']
                }
        return {}

    def get_classes2d(self):
        """ Iterate over 2D classes. """
        items = []
        if classesSqlite := self.outputs['classes2d']:
            with SqliteFile(classesSqlite) as sf:
                mrc_stack = None
                avgThumb = Thumbnail(max_size=(100, 100),
                                     output_format='base64')

                for row in sf.iterTable('Objects', classes='Classes'):
                    avgFn = self.join(row['_representative._filename'])
                    avgIndex = row['_representative._index'] - 1

                    if not mrc_stack:
                        mrc_stack = mrcfile.open(avgFn, permissive=True)

                    items.append({
                        'id': '%03d' % row['id'],
                        'size': row['_size'],
                        'average': avgThumb.from_array(mrc_stack.data[avgIndex, :, :])
                    })
            items.sort(key=lambda c: c['size'], reverse=True)
            mrc_stack.close()

        return items

    def get_micrograph_coordinates(self, micFn):
        coords = []
        print("Getting coordinates for: ", micFn)
        if coordSqlite := self.outputs.get('coordinates', None):
            with SqliteFile(coordSqlite) as sf:
                for row in sf.iterTable('Objects', classes='Classes'):
                    if row['_micName'] == micFn:
                        coords.append((row['_x'], row['_y']))

        print("   Total: ", len(coords))
        return coords