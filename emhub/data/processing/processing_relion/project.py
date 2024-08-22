# **************************************************************************
# *
# * Authors:     J.M. de la Rosa Trevin (delarosatrevin@gmail.com)
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
# **************************************************************************

import os
from glob import glob
import numpy as np
import base64

import mrcfile
from emtools.utils import Path, Timer, Pretty
from emtools.metadata import StarFile, EPU, SqliteFile
from emtools.image import Thumbnail

from ..base import SessionRun, SessionData, hours
from .runs import RelionRun

location = os.path.dirname(__file__)


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
                try:
                    first = self.mtime(getattr(firstRow, attribute))
                    last = self.mtime(getattr(lastRow, attribute))
                    h = hours(first, last)
                except:
                    first = last = h = 0

                return {
                    'hours': h,
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
            'classes2d': len(self.get_classes2d_runs()),
            'coordinates': {'count': 0}  # FIXME if there are picking jobs or from extraction
        }

        t.toc()

    def get_micrographs(self):
        """ Return an iterator over the micrographs' CTF information. """
        micFn = self._last_micFn()

        if not micFn:
            return []

        with StarFile(micFn) as sf:
            for row in sf.iterTable('micrographs'):
                micData = {
                    'micrograph': row.rlnMicrographName,
                    'ctfImage': row.rlnCtfImage,
                    'ctfDefocus': row.rlnDefocusU,
                    'ctfResolution': min(row.rlnCtfMaxResolution, 10),
                    'ctfDefocusAngle': row.rlnDefocusAngle,
                    'ctfAstigmatism': row.rlnCtfAstigmatism
                }
                yield micData

    def get_micrograph_data(self, micId):
        micFn = self._last_micFn()
        data = {}
        if micFn:
            with StarFile(micFn) as sf:
                otable = sf.getTable('optics')
                row = sf.getTableRow('micrographs', micId - 1)
                micThumb = Thumbnail.Micrograph()
                psdThumb = Thumbnail.Psd()
                micFn = self.join(row.rlnMicrographName)
                micThumbBase64 = micThumb.from_mrc(micFn)
                psdFn = self.join(row.rlnCtfImage).replace(':mrc', '')
                pixelSize = otable[0].rlnMicrographPixelSize

                loc = EPU.get_movie_location(micFn)

                if pickStar := self.get_last_star('*Pick', '*pick.star'):
                    coords = self.get_micrograph_coordinates(pickStar, micId)
                else:
                    coords = []

                data = {
                    'micThumbData': micThumbBase64,
                    'psdData': psdThumb.from_mrc(psdFn),
                    # 'shiftPlotData': None,
                    'ctfDefocusU': round(row.rlnDefocusU/10000., 2),
                    'ctfDefocusV': round(row.rlnDefocusV/10000., 2),
                    'ctfDefocusAngle': round(row.rlnDefocusAngle, 2),
                    'ctfAstigmatism': round(row.rlnCtfAstigmatism/10000, 2),
                    'ctfResolution': round(row.rlnCtfMaxResolution, 2),
                    'coordinates': coords,
                    'micThumbPixelSize': pixelSize * micThumb.scale,
                    'pixelSize': pixelSize,
                    'gridSquare': loc['gs'],
                    'foilHole': loc['fh']
                }
        return data

    def get_workflow(self):
        protList = []
        protDict = {}
        status_map = {
            'Succeeded': 'finished',
            'Running': 'running',
            'Aborted': 'aborted',
            'Failed': 'failed'
        }
        pipelineStar = self.join('default_pipeline.star')
        outputs = {}

        with StarFile(pipelineStar) as sf:
            for row in sf.iterTable('pipeline_processes'):
                name = row.rlnPipeLineProcessName
                alias = row.rlnPipeLineProcessAlias
                status = status_map.get(row.rlnPipeLineProcessStatusLabel, 'unknown')
                prot = {
                    'id': name,
                    'label': alias if alias != 'None' else name,
                    'links': [],
                    'status': status,
                    'type': row.rlnPipeLineProcessTypeLabel
                }
                protList.append(prot)
                protDict[name] = prot

            for row in sf.iterTable('pipeline_output_edges'):
                outputs[row.rlnPipeLineEdgeToNode] = row.rlnPipeLineEdgeProcess

            for row in sf.iterTable('pipeline_input_edges'):
                node = row.rlnPipeLineEdgeFromNode
                if output := outputs.get(node, None):
                    procName = row.rlnPipeLineEdgeProcess
                    childProt = protDict[procName]
                    parentProt = protDict[output]
                    if childProt not in parentProt['links']:
                        parentProt['links'].append(procName)

        return protList

    def get_run(self, runId):
        print(">>> runId: ", runId)
        return RelionRun(self, self.join(runId))

    def get_classes2d_runs(self):
        return [r.replace(self._path, '')[1:] for r in self._jobs('Class2D')]

    def get_classes2d_from_run(self, runId=None):
        """ Iterate over 2D classes. """
        runs2d = self.get_classes2d_runs()
        return {
            'runs': [{'id': i, 'label': r} for i, r in enumerate(runs2d)],
            'items': [] if runId is None else self.get_run(runId).get_classes2d(),
            'selection': []
        }

    @classmethod
    def get_classes2d_data(cls, pattern):
        """ Get classes information from a relion *classes.mrcs files pattern. """
        items = []
        if files := glob(pattern):
            files.sort()
            avgMrcs = files[-1]
            dataStar = avgMrcs.replace('_classes.mrcs', '_data.star')
            modelStar = dataStar.replace('_data.', '_model.')
            mrc_stack = None
            avgThumb = Thumbnail(max_size=(128, 128), output_format='base64')

            with StarFile(dataStar) as sf:
                n = sf.getTableSize('particles')

            with StarFile(modelStar) as sf:
                modelTable = sf.getTable('model_classes', guessType=False)

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

    def coords_from_row(self, row):
        """ Iterate coordinates from a row containing the STAR file
         path with the coordinates. """
        coordStar = self.join(row.rlnMicrographCoordinates)
        with StarFile(coordStar) as sf:
            for c in sf.iterTable(''):
                yield c

    def load_micrograph_data(self, micId, micsStar):
        with StarFile(micsStar) as sf:
            otable = sf.getTable('optics')
            row = sf.getTableRow('micrographs', micId - 1)
            micThumb = Thumbnail.Micrograph()
            micFn = self.join(row.rlnMicrographName)
            micThumbBase64 = micThumb.from_mrc(micFn)
            pixelSize = otable[0].rlnMicrographPixelSize

            micData = {
                'micThumbData': micThumbBase64,
                'coordinates': [],  # Check for picking
                'micThumbPixelSize': pixelSize * micThumb.scale,
                'pixelSize': pixelSize,
                'gridSquare': '',
                'foilHole': ''
            }

            if hasattr(row, 'rlnCtfImage'):
                psdThumb = Thumbnail.Psd()
                psdFn = self.join(row.rlnCtfImage).replace(":mrc", "")
                ctfProfile = psdFn.replace('.ctf', '_avrot.txt')

                if os.path.exists(ctfProfile):
                    with open(ctfProfile) as f:
                        ctfPlot = [line.split() for line in f
                                   if not line.startswith('#')]
                else:
                    ctfPlot = []

                micData.update({
                    'psdData': psdThumb.from_mrc(psdFn),
                    'ctfDefocusU': round(row.rlnDefocusU / 10000., 2),
                    'ctfDefocusV': round(row.rlnDefocusV / 10000., 2),
                    'ctfDefocusAngle': round(row.rlnDefocusAngle, 2),
                    'ctfAstigmatism': round(row.rlnCtfAstigmatism / 10000, 2),
                    'ctfResolution': round(row.rlnCtfMaxResolution, 2),
                    'ctfPlot': ctfPlot
                })

            return micData

    def get_micrograph_coordinates(self, pickStar, micId):
        with StarFile(self.join(pickStar)) as sf:
            for i, row in enumerate(sf.iterTable('coordinate_files')):
                if i == micId - 1:
                    return [(round(c.rlnCoordinateX), round(c.rlnCoordinateY))
                            for c in self.coords_from_row(row)]
        return []

    def load_coordinates_values(self, coordStar, index=False):
        data_values = {
            'numberOfParticles': {
                'label': 'Particles',
                'color': '#852999',
                'data': []
            },
            'averageFOM': {
                'data': []
            },
            'default_y': 'numberOfParticles',
            'default_color': 'averageFOM',
            'has_particles': True
        }
        # TODO: Write this info in a star file to avoid recalculating all the time
        pts = data_values['numberOfParticles']['data']
        fom = data_values['averageFOM']['data']
        indexes = []

        with StarFile(coordStar) as sf:
            for i, row in enumerate(sf.iterTable('coordinate_files')):
                indexes.append(i + 1)
                n = 0
                fomSum = 0
                for c in self.coords_from_row(row):
                    n += 1
                    fomSum += c.rlnAutopickFigureOfMerit
                pts.append(n)
                fom.append(fomSum / n)

        if index:
            data_values.update({
                'index': {'label': 'Index', 'data': indexes},
                'default_x': 'index'
            })

        return data_values

    def load_ctf_values(self, ctfStar, index=False):
        data_values = {
            'rlnDefocusU': {
                'label': 'Defocus U',
                'scale': 0.0001,
                'unit': 'µm',
                'color': '#852999',
                'maxX': 4,
                'data': []
            },
            'rlnDefocusV': {
                'label': 'Defocus V',
                'scale': 0.0001,
                'unit': 'µm',
                'color': '#852999',
                'maxX': 4,
                'data': []
            },
            'rlnCtfFigureOfMerit': {
                'data': []
            },
            'rlnCtfMaxResolution': {
                'color': '#EF9A53',
                'label': 'Resolution',
                'unit': 'Å',
                'data': []
            },
            'default_y': 'rlnCtfMaxResolution',
            'default_x': '',
            'has_ctf': True
        }
        indexes = []
        with StarFile(ctfStar) as sf:
            for i, row in enumerate(sf.iterTable('micrographs')):
                indexes.append(i + 1)
                rowDict = row._asdict()
                for k, v in data_values.items():
                    if isinstance(v, dict):
                        scale = v.get('scale', 1)
                        v['data'].append(rowDict[k] * scale)
        if index:
            data_values.update({
                'index': {'label': 'Index', 'data': indexes},
                'default_x': 'index'
            })

        return data_values

    def get_volume_data(self, volName, **kwargs):
        volPath = self.join(volName)

        if not os.path.exists(volPath):
            raise Exception("Volume path %s does not exists." % volPath)

        data = {}
        volume_data = kwargs.get('volume_data', 'info')

        mrc = mrcfile.open(volPath, permissive=True)
        zdim, ydim, xdim = mrc.data.shape
        data['path'] = volPath
        data['dimensions'] = [xdim, ydim, zdim]

        if volume_data == "info":
            return data

        if "slices" in volume_data:
            axis = kwargs.get('axis', 'z')

            slice_dim = kwargs.get('slice_dim', 128)
            volThumb = Thumbnail(max_size=(slice_dim, slice_dim),
                                 output_format='base64',
                                 min_max=(mrc.data.min(), mrc.data.max()))
            if slice_number := kwargs.get('slice_number', None):
                # Do not take slices from star/end since they are usually empty
                n4 = np.round(xdim / 4)
                idx = np.round(np.linspace(n4, xdim - n4, slice_number)).astype(int)
                pass
            else:
                slice_number = min(xdim, slice_dim)
                idx = np.round(np.linspace(0, xdim - 1, slice_number)).astype(int)

            slices = {}

            if 'x' in axis:
                slices['x'] = {int(i): volThumb.from_array(mrc.data[:, :, i])
                               for i in idx}
            if 'y' in axis:
                slices['y'] = {int(i): volThumb.from_array(mrc.data[:, i, :])
                               for i in idx}

            if 'z' in axis:
                slices['z'] = {int(i): volThumb.from_array(mrc.data[i, :, :])
                               for i in idx}

            data.update({
                'slices': slices,
                'axis': axis
            })

        if 'array' in volume_data:
            iMax = mrc.data.max()  # min(imean + 10 * isd, imageArray.max())
            iMin = mrc.data.min()  # max(imean - 10 * isd, imageArray.min())
            im255 = ((mrc.data - iMin) / (iMax - iMin) * 255).astype(np.uint8)
            data['array'] = base64.b64encode(im255).decode("utf-8")

        #
        # else:
        #     raise Exception('Unknown volume_data value: %s' % volume_data)

        return data

    # ----------------------- UTILS ---------------------------
    def _jobs(self, jobType):
        jobs = glob(self.join(jobType, 'job*'))

        def _jobNumber(j):
            return int(j.split('/job')[1])

        jobs.sort(key=_jobNumber)

        return jobs

    def get_last_star(self, jobType, starFn):
        jobDirs = self._jobs(jobType)
        if not jobDirs:
            return None
        fn = self.join(jobDirs[-1], starFn)
        if '*' in starFn:  # it is a glob pattern, let's find the last file
            files = glob(fn)
            files.sort()
            fn = files[-1] if files else None
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
