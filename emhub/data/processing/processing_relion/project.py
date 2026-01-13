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
import json
import os
from glob import glob
import numpy as np
import base64
from collections import defaultdict
from datetime import datetime

import mrcfile
from emtools.utils import Path, Timer, Pretty, FolderManager
from emtools.metadata import StarFile, EPU, SqliteFile, RelionStar
from emtools.image import Thumbnail

from emwrap.base import ProcessingConfig, ProjectManager

from ..base import SessionRun, SessionData, hours
from .runs import RelionRun

location = os.path.dirname(__file__)


class RelionSessionData(SessionData):
    """
    Adapter class for reading Session data from Relion OTF
    """
    def __init__(self, *args, **kwargs):
        SessionData.__init__(self, *args, **kwargs)
        self.session = defaultdict(lambda: None)

        if self.exists('session.json'):
            with open(self.join('session.json')) as f:
                self.session.update(json.load(f))
                # for k in ['movies', 'micrographs', 'coordinates', 'classes2d']:
                #     setattr(self, k, self.join(session.get(k, '')))

        self.workflow = RelionStar.pipeline_to_workflow(self.join('default_pipeline.star'))
        self.movDataTable = None
        self.micDataTable = None

        if self.session['movies'] and os.path.exists(self.session['movies']):
            with StarFile(self.session['movies']) as sf:
                self.movDataTable = sf.getTable('movies')
                self.movDataDict = {r.rlnImageId: r for r in self.movDataTable} if self.movDataTable else {}

        if self.session['micrographs'] and os.path.exists(self.session['micrographs']):
            with StarFile(self.session['micrographs']) as sf:
                self.micOpticsTable = sf.getTable('optics')
                self.micDataTable = sf.getTable('micrographs')
                self.micDataDict = {r.rlnImageId: r for r in self.micDataTable} if self.micDataTable else {}

    def get_stats(self):

        def _stats_from_table(table, attribute):
            if table is None:
                return {'count': 0}

            s = {'count': len(table)}

            if attribute != 'count':
                firstRow, lastRow = table[0], table[-1]
                try:
                    first = self.mtime(getattr(firstRow, attribute))
                    last = self.mtime(getattr(lastRow, attribute))
                    h = hours(first, last)
                except:
                    first = last = h = 0
                s.update(hours=h, first=first, last=last)
            return s

        if not self.session['movies']:
            return {'movies': {'count': 0}, 'ctfs': {'count': 0}}

        countEpu = 0

        # if epuData := self.getEpuData():
        #     moviesTable = epuData.moviesTable
        #     first = moviesTable[0].timeStamp
        #     last = moviesTable[-1].timeStamp
        #     countEpu = moviesTable.size()
        #     msEpu = {
        #         'count': countEpu, 'first': first, 'last': last,
        #         'hours': hours(first, last)
        #     }
        # else:
        msEpu = None

        msImport = _stats_from_table(self.movDataTable, 'rlnMicrographMovieName')
        movieStats = msEpu if countEpu > msImport['count'] else msImport

        if self.micDataTable:
            coords = sum(row.rlnCoordinatesNumber for row in self.micDataTable)
        else:
            coords = 0

        return {
            'movies': movieStats,
            'ctfs': _stats_from_table(self.micDataTable, 'rlnMicrographName'),
            'classes2d': len(self.get_classes2d_runs()),
            'coordinates': {'count': coords}
        }

    def importTimestamps(self):
        for row in self.movDataTable:
            yield row.TimeStamp

    def row_to_mic(self, row):
        movRow = self.movDataDict[row.rlnImageId]
        return {
            'micrograph': row.rlnMicrographName,
            'ctfImage': row.rlnCtfImage,
            'ctfDefocus': row.rlnDefocusU,
            'ctfResolution': min(row.rlnCtfMaxResolution, 10),
            'ctfDefocusAngle': row.rlnDefocusAngle,
            'ctfAstigmatism': row.rlnCtfAstigmatism,
            'gs': movRow.GridSquare,
            'ts': movRow.TimeStamp
        }

    def get_micrographs(self):
        """ Return an iterator over the micrographs' CTF information. """
        d = self.micDataDict
        for k in sorted(d.keys()):
            yield self.row_to_mic(d[k])

    def get_ctfs_runid(self):
        """ Return the run_id for the ctfs used for the general session overview. """
        return self.session['micrographs']

    def get_workflow(self, update=False):
        if update:
            self.workflow = RelionStar.pipeline_to_workflow(self.join('default_pipeline.star'))

        protList = []
        status_map = {
            'Succeeded': 'finished',
            'Running': 'running',
            'Aborted': 'aborted',
            'Failed': 'failed'
        }

        def _elapsed(job):
            elapsed = ''
            infoFile = self.join(job.id, 'info.json')
            if os.path.exists(infoFile):
                with open(infoFile) as f:
                    info = json.load(f)
                    if runs := info['runs']:
                        if e := runs[-1].get('elapsed', ''):
                            elapsed = " " + e.split('.')[0]
                        elif s := runs[-1].get('start', ''):
                            started = Pretty.parse_datetime(s)
                            e = str(datetime.now() - started)
                            elapsed = " " + e.split('.')[0]

            return elapsed

        for job in self.workflow.jobs():
            links = []
            for o in job.outputs:
                for c in o.childs:
                    links.append(c.id)

            protList.append({
                'id': job.id,
                'label': RelionRun.jobAlias(job) + _elapsed(job),
                'links': links,
                'status': status_map.get(job['status'], job['status']),
                'type': job['jobtype']
            })
        #
        # with open('workflow.json', 'w') as f:
        #     json.dump(protList, f, indent=4)

        return protList

    def get_run(self, runId):
        if job := self.workflow.getJob(runId, None):
            return RelionRun(self, self.join(runId), job, data=runId)
        else:
            return None

    def get_form_definition(self, jobType, jobValues=None):
        """ Return the form for a given jobType.
        Args:
            jobType: the type of the job.
            jobValues: values of an existing job, to extend the form if
                these keys are missing.
        """
        default = {'valueClass': 'String',
                   'paramClass': 'StringParam',
                   'important': False,
                   'expert': False
                   }

        formDef = {
            'package': '',
            'name': jobType,
            'logo': '',
            'sections': []
        }

        allParams = set()

        def _set_defaults(paramDef):
            for k, v in default.items():
                if k not in paramDef:
                    paramDef[k] = v
            return paramDef

        def _register(paramDef):
            if name := paramDef.get('name', None):
                _set_defaults(paramDef)
                allParams.add(name)

        if jobForm := ProcessingConfig.get_job_form(jobType):
            for paramDef in ProcessingConfig.iter_form_params(jobForm):
                _register(paramDef)
            for sectionDef in jobForm['sections']:
                formDef['sections'].append(sectionDef)

        if jobValues:
            extraParams = []
            for k, v in jobValues.items():
                if k not in allParams:
                    extraParams.append(_set_defaults({'label': k, 'name': k}))

            if extraParams:
                formDef['sections'].append({'label': 'extra params',
                                            'params': extraParams})

        return formDef


    def get_classes2d_runs(self):
        classesPath = os.path.join(self.classes2d, 'Classes2D')
        runs = []
        if os.path.exists(classesPath):
            for d in sorted(os.listdir(classesPath)):
                if d.startswith('batch'):
                    runs.append(d)
        return runs

    def get_classes2d_from_run(self, runId=None):
        """ Iterate over 2D classes. """
        runs2d = self.get_classes2d_runs()
        if runId is None:
            items = []
        else:
            batch = runs2d[runId]
            p = os.path.join(self.classes2d, 'Classes2D', batch, '*_classes.mrcs')
            items = self.get_classes2d_data(pattern=p, root=self.path)
        return {
            'runs': [{'id': i, 'label': r} for i, r in enumerate(runs2d)],
            'items': items,
            'selection': []
        }

    def get_classes2d(self, runId=None):
        return self.get_classes2d_from_run(runId=runId)

    def save_classes2d_selection(self, runId, selection):
        batch = self.get_classes2d_runs()[runId]
        p = os.path.join(self.classes2d, 'Classes2D', batch, '*_classes.mrcs')
        if files := glob(p):
            files.sort()
            avgMrcs = files[-1]
            dataStar = avgMrcs.replace('_classes.mrcs', '_data.star')
            modelStar = dataStar.replace('_data.', '_model.')
            selectionFn = modelStar + '.selection'
            with open(selectionFn, 'w') as f:
                json.dump(selection, f)
            return self.relpath(selectionFn)

        return None

    @classmethod
    def get_classes2d_data(cls, **kwargs):
        """ Get classes information from a relion *classes.mrcs files pattern. """
        items = []
        root = kwargs.get('root', './')
        avgThumb = Thumbnail(max_size=(128, 128), output_format='base64')
        dataStar = modelStar = None

        if pattern := kwargs.get('pattern', None):
            if files := glob(pattern):
                files.sort()
                avgMrcs = files[-1]
                dataStar = avgMrcs.replace('_classes.mrcs', '_data.star')
                modelStar = dataStar.replace('_data.', '_model.')
                modelTable = 'model_classes'
        else:
            dataStar = kwargs.get('dataStar', None)
            modelStar = kwargs.get('modelStar', None)
            modelTable = kwargs.get('modelTable', '')
            avgMrcs = None

        selectionFn = modelStar + '.selection'
        selection = []
        if os.path.exists(selectionFn):
            with open(selectionFn) as f:
                selection = json.load(f)

        if dataStar and modelStar:
            with StarFile(dataStar) as sf:
                n = sf.getTableSize('particles')

            lastFn = None
            mrc_stack = None

            with StarFile(modelStar) as sf:
                for row in sf.getTable(modelTable, guessType=False):
                    i, fn = row.rlnReferenceImage.split('@')
                    if mrc_stack is None:
                        avgMrcs = avgMrcs or os.path.join(root, avgMrcs)
                        mrc_stack = mrcfile.open(avgMrcs, permissive=True)
                    clsId = int(i)
                    items.append({
                        'id': '%03d' % clsId,
                        'size': round(float(row.rlnClassDistribution) * n),
                        'average': avgThumb.from_array(mrc_stack.data[int(i) - 1, :, :]),
                        'selected': not selection or clsId in selection
                    })
            items.sort(key=lambda c: c['size'], reverse=True)
            mrc_stack.close()

        return items

    def coords_from_row(self, row):
        """ Iterate coordinates from a row containing the STAR file
         path with the coordinates. """
        class Coord:
            """ Simple wraper around a row. """
            def __init__(self, row, xLabel, yLabel, scoreLabel):
                self.row = row
                self.xLabel = xLabel
                self.yLabel = yLabel
                self.scoreLabel = scoreLabel

            @property
            def x(self):
                return getattr(self.row, self.xLabel)

            @property
            def y(self):
                return getattr(self.row, self.yLabel)

            @property
            def score(self):
                return getattr(self.row, self.xLabel)

        coordStar = self.join(row.rlnMicrographCoordinates)
        coordCbox = coordStar.replace('.star', '.cbox')
        useCbox = False  # Allow a way to enable this from the UI
        if useCbox and os.path.exists(coordCbox):
            labels = ['CoordinateX', 'CoordinateY', 'Confidence']
            table = 'cryolo'
            coordStar = coordCbox
        else:
            labels = ['rlnCoordinateX', 'rlnCoordinateY', 'rlnAutopickFigureOfMerit']
            table = ''

        print(">>>>> Reading coords from: ", coordStar, flush=True)
        with StarFile(coordStar) as sf:
            if t := sf.getTable(table):
                for c in t:
                    yield Coord(c, *labels)

    def load_micrograph_data(self, micId, micsStar):
        row = self.micDataTable[micId - 1]
        micThumb = Thumbnail.Micrograph()
        micFn = self.join(row.rlnMicrographName)
        micThumbBase64 = micThumb.from_mrc(micFn)
        pixelSize = self.micOpticsTable[0].rlnMicrographPixelSize

        # FIXME The following assumes a 1-1 mov-mic and the same order
        movFn = self.movDataTable[micId - 1].rlnMicrographMovieName

        loc = {'gs': self.movDataDict[row.rlnImageId].GridSquare, 'fh': None}

        micData = {
            'micThumbData': micThumbBase64,
            'coordinates': [],  # Check for picking
            'micThumbPixelSize': pixelSize * micThumb.scale,
            'pixelSize': pixelSize,
            'gridSquare': loc['gs'],
            'foilHole': loc['fh']
        }

        if hasattr(row, 'rlnCtfImage'):
            psdThumb = Thumbnail.Psd()
            psdFn = self.join(row.rlnCtfImage).replace(":mrc", "")
            ctfProfile = psdFn.replace('.ctf', '_avrot.txt')

            if os.path.exists(ctfProfile) and ctfProfile.endswith('_avrot.txt'):
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
        row = self.micDataTable[micId - 1]
        return [(round(c.x), round(c.y)) for c in self.coords_from_row(row)]

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
                    fomSum += c.score
                pts.append(n)
                fom.append(fomSum / n)

        if index:
            data_values.update({
                'index': {'label': 'Index', 'data': indexes},
                'default_x': 'index'
            })

        return data_values

    def load_ctf_values(self, ctfStar, index=False):
        possible_labels = {
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
            'rlnCtfIceRingDensity': {
              'label': 'Ice Ring Density',
              'data': []
            }}
        data_values = {
            'default_y': 'rlnCtfMaxResolution',
            'default_x': '',
            'has_ctf': True
        }
        indexes = []
        with StarFile(ctfStar) as sf:
            ti = sf.getTableInfo('micrographs')
            for k, v in possible_labels.items():
                if ti.hasColumn(k):
                    data_values[k] = v

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

    def get_micrograph_gridsquare(self, **kwargs):
        gsId = kwargs.get('gsId', '')
        locData = {
            'gridSquare': {},
            'foilHole': {}
        }

        thumb = Thumbnail(output_format='base64', max_size=(512, 512))

        def _microns(v):
            return round(v * 0.0001, 3)

        defocus = []
        resolution = []
        particles = 0

        gsRoot = os.path.dirname(self.session['movies'])
        gsDir = FolderManager(os.path.join(gsRoot, 'EPU', 'GridSquares', gsId))

        for fn in gsDir.listdir():
            if fn.endswith('.jpg'):
                gsImagePath = gsDir.join(fn)
                locData['gridSquare'] = {
                    'id': gsId,
                    'image': gsImagePath,
                    'folder': gsDir.path,
                    'thumbnail': thumb.from_path(gsImagePath)
                }

        for k, row in self.micDataDict.items():
            micGs = self.movDataDict[k].GridSquare
            if gsId != micGs:
                continue

            mic = self.row_to_mic(row)
            micName = mic.get('micName', mic['micrograph'])
            if micGs == gsId:
                defocus.append(_microns(mic['ctfDefocus']))
                resolution.append(round(mic['ctfResolution'], 3))
                particles += row.rlnCoordinatesNumber

        locData.update({'defocus': defocus,
                        'resolution': resolution,
                        'particles': particles
                        })

        return locData

    def get_gridsquares(self, **kwargs):
        gs = []
        lastGs = None
        counter = 0
        for row in self.movDataTable:
            movieGs = row.GridSquare
            if movieGs != lastGs:
                if lastGs:
                    gs.append({'gsId': lastGs, 'micrographs': counter})
                lastGs = movieGs
                counter = 0
            counter += 1
        gs.append({'gsId': lastGs, 'count': counter})

        return gs

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
        return self.session['micrographs']

        jobs = self._jobs('CtfFind')
        if jobs:
            micFn = self.join(jobs[-1], 'micrographs_ctf.star')
            if os.path.exists(micFn):
                return micFn
        return None
