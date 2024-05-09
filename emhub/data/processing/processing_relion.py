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
import datetime as dt
from glob import glob
from collections import defaultdict
import json
import flask
from flask import current_app as app

import mrcfile
from emtools.utils import Path, Timer, Pretty
from emtools.metadata import StarFile, EPU, SqliteFile
from emtools.image import Thumbnail

from .base import SessionRun, SessionData, hours


class RelionRun(SessionRun):
    """ Helper class to manipulate Relion run data. """
    def __init__(self, project, path):
        SessionRun.__init__(self, project, path)
        d, self.id = os.path.split(Path.rmslash(path))
        with StarFile(self.join('job.star')) as sf:
            self.job = sf.getTable('job')
            self.values = {row.rlnJobOptionVariable: row.rlnJobOptionValue
                           for row in sf.iterTable('joboptions_values', guessType=False)}
        parts = self.job[0].rlnJobTypeLabel.split('.')
        self.package = parts[0]
        self.className = parts[1]
        self.classSuffix = '' if len(parts) < 3 else '.'.join(parts[2:])

        with StarFile(self.join('job_pipeline.star')) as sf:
            t = sf.getTable('pipeline_processes')
            row = t[0]
            self.name = row.rlnPipeLineProcessName
            self.alias = row.rlnPipeLineProcessAlias

    def getInfo(self):
        return {'id': self.id, 'className': self.className, 'label': self.id,
                'name': self.name, 'alias': self.alias}

    def getFormDefinition(self):
        default = {'valueClass': 'String',
                   'paramClass': 'StringParam',
                   'important': False,
                   'expert': False
                   }

        formDef = {
            'package': 'relion',
            'name': self.className,
            'logo': '',
            'sections': []
        }

        allParams = set()

        def _set_defaults(paramDef):
            for k, v in default.items():
                if k not in paramDef:
                    paramDef[k] = v
            return paramDef

        if formConf := app.dm.get_config(f"{self.package}.{self.className}"):
            for sectionDef in formConf['sections']:
                for paramDef in sectionDef['params']:
                    if 'name' in paramDef:
                        _set_defaults(paramDef)
                        allParams.add(paramDef['name'])
                formDef['sections'].append(sectionDef)

        extraParams = []
        for k, v in self.values.items():
            if k not in allParams:
                extraParams.append(_set_defaults({'label': k, 'name': k}))

        if extraParams:
            formDef['sections'].append({'label': 'extra params',
                                        'params': extraParams})

        return formDef

    def getValues(self):
        return self.values

    def getStdOut(self):
        """ Return run's stdout file. """
        return self.join('run.out')

    def getStdError(self):
        """ Return run's stdout file. """
        return self.join('run.err')

    def getInputsOutputs(self):
        with StarFile(self.join('job_pipeline.star')) as sf:
            inputsTable = sf.getTable('pipeline_input_edges')
            outputsTable = sf.getTable('pipeline_output_edges')
            return {
                'inputs': [row.rlnPipeLineEdgeFromNode for row in inputsTable],
                'outputs': [row.rlnPipeLineEdgeToNode for row in outputsTable]
            }

    def getSummary(self):
        summary = {'template': '', 'data': {}}
        data_values = None

        if self.className == 'ctffind':
            summary['template'] = 'processing_ctf_summary.html'
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
                }
            }
            with StarFile(self.join('micrographs_ctf.star')) as sf:
                for row in sf.iterTable('micrographs'):
                    rowDict = row._asdict()
                    for k, v in data_values.items():
                        scale = v.get('scale', 1)
                        v['data'].append(rowDict[k] * scale)

        elif self.className == 'autopick':
            summary['template'] = 'processing_picking_summary.html'
            data_values = {
                'numberOfParticles': {
                    'label': 'Particles',
                    'color': '#852999',
                    'data': []
                },
                'averageFOM': {
                    'data': []
                }
            }
            # TODO: Write this info in a star file to avoid recalculating all the time
            pts = data_values['numberOfParticles']['data']
            fom = data_values['averageFOM']['data']
            with StarFile(self.join('autopick.star')) as sfCoords:
                for row1 in sfCoords.iterTable('coordinate_files'):
                    n = 0
                    fomSum = 0
                    with StarFile(self.project.join(row1.rlnMicrographCoordinates)) as sf:
                        for row in sf.iterTable(''):
                            n += 1
                            fomSum += row.rlnAutopickFigureOfMerit
                    pts.append(n)
                    fom.append(fomSum / n)

        if data_values:
            summary['data'] = {'data_values': data_values}

        return summary

    def _load_micrograph_data(self, micId, micsStar):
        with StarFile(micsStar) as sf:
            otable = sf.getTable('optics')
            row = sf.getTableRow('micrographs', micId - 1)
            micThumb = Thumbnail.Micrograph()
            psdThumb = Thumbnail.Psd()
            micFn = self.project.join(row.rlnMicrographName)
            micThumbBase64 = micThumb.from_mrc(micFn)
            psdFn = self.project.join(row.rlnCtfImage).replace(':mrc', '')
            pixelSize = otable[0].rlnMicrographPixelSize

            return {
                'micThumbData': micThumbBase64,
                'psdData': psdThumb.from_mrc(psdFn),
                'ctfDefocusU': round(row.rlnDefocusU / 10000., 2),
                'ctfDefocusV': round(row.rlnDefocusV / 10000., 2),
                'ctfDefocusAngle': round(row.rlnDefocusAngle, 2),
                'ctfAstigmatism': round(row.rlnCtfAstigmatism / 10000, 2),
                'ctfResolution': round(row.rlnCtfMaxResolution, 2),
                'coordinates': [],  # Check for picking
                'micThumbPixelSize': pixelSize * micThumb.scale,
                'pixelSize': pixelSize,
                'gridSquare': '',
                'foilHole': ''
            }

    def get_micrograph_data(self, micId):
        data = {}
        micsStar = None

        if self.className == 'ctffind':
            data = self._load_micrograph_data(micId, self.join('micrographs_ctf.star'))
        elif self.className == 'autopick':
            for i in self.getInputsOutputs()['inputs']:
                if i.endswith('micrographs_ctf.star'):
                    data = self._load_micrograph_data(micId, self.project.join(i))
                    data['coordinates'] = self.project.get_micrograph_coordinates(
                        self.join('autopick.star'), micId)
                    break

        return data


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

    @staticmethod
    def get_classes2d_from_run(runFolder):
        """ Get classes information from a class 2d run. """
        items = []
        if runFolder:
            avgMrcs = os.path.join(runFolder, '*_it*_classes.mrcs')
            files = glob(avgMrcs)
            files.sort()
            avgMrcs = files[-1]
            dataStar = avgMrcs.replace('_classes.mrcs', '_data.star')
            modelStar = dataStar.replace('_data.', '_model.')

            mrc_stack = None
            avgThumb = Thumbnail(max_size=(100, 100),
                                 output_format='base64')

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
        return RelionRun(self, self.join(runId))

    def get_classes2d_runs(self):
        return [r.replace(self._path, '')[1:] for r in self._jobs('Class2D')]

    def get_classes2d(self, runId=None):
        """ Iterate over 2D classes. """
        runs2d = self.get_classes2d_runs()
        return {
            'runs': [{'id': i, 'label': r} for i, r in enumerate(runs2d)],
            'items': [] if runId is None else self.get_classes2d_from_run(self.join(runs2d[runId])),
            'selection': []
        }

    def get_coords_from_star(self, starFn):
        """ Return x,y coordinates from a given star file,
        from the root of the project. """
        coords = []
        starPath = self.join(starFn)

        with StarFile(self.join(starPath)) as sf:
            for row in sf.iterTable(''):
                coords.append((round(row.rlnCoordinateX),
                               round(row.rlnCoordinateY)))
        return coords

    def get_micrograph_coordinates(self, pickStar, micId):
        with StarFile(self.join(pickStar)) as sf:
            for i, row in enumerate(sf.iterTable('coordinate_files')):
                if i == micId:
                    return self.get_coords_from_star(row.rlnMicrographCoordinates)
        return []

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
