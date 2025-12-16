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
import numpy as np
from flask import current_app as app

import mrcfile
from emtools.utils import Path, Timer, Pretty, FolderManager
from emtools.metadata import StarFile, EPU, SqliteFile, Table, RelionStar
from emtools.image import Thumbnail
from emwrap.base import ProcessingConfig, ProjectManager

from ..base import SessionRun, SessionData, hours

location = os.path.dirname(__file__)


class RelionRun(SessionRun):
    """ Helper class to manipulate Relion run data. """
    def __init__(self, project, path, job, **kwargs):
        SessionRun.__init__(self, project, path)
        self.id = job.id
        self.job = job
        self.jobtype = job['jobtype']
        self.values = {} # FIXME
        self.extra = kwargs

        if self.exists('job.star'):
            self.values = RelionStar.read_jobstar(self.join('job.star'))

            # with open(self.join('job.json')) as f:
            #     self.values = json.load(f)
            #
            # d = {
            #     'job': {'jobtype': self.jobtype},
            #     'values': self.values
            # }
            # ProjectManager.write_jobstar(d, self.join('job.star'))

        sep = '-' if '-' in self.jobtype else '.'
        parts = self.jobtype.split(sep)
        self.package = parts[0]
        self.className = parts[1] if len(parts) > 1 else self.jobtype

        self.name = job.id
        self.alias = RelionRun.jobAlias(job)

    @staticmethod
    def jobAlias(job):
        a = job['alias']
        return a if (a and a != 'None') else job['jobtype']

    def getInfo(self):
        return {
            'id': self.id,
            'className': self.className,
            'label': self.id,
            'name': self.name,
            'alias': self.alias,
            'jobtype': self.jobtype
        }

    def getValues(self):
        return self.values

    def getStdOut(self):
        """ Return run's stdout file. """
        return self.join('run.out')

    def getStdError(self):
        """ Return run's stdout file. """
        return self.join('run.err')

    def getInputsOutputs(self):
        if self._ios is None:
            ios = {'inputs': [], 'outputs': []}

            infoJson = self.join('info.json')
            jobPipeline = self.join('job_pipeline.star')

            ios['inputs'] = [i.id for i in self.job.inputs]
            ios['outputs'] = [o.id for o in self.job.outputs]

            if os.path.exists(infoJson):
                with open(infoJson) as f:
                    info = json.load(f)
                    for k in ['inputs', 'outputs']:
                        if k in info:
                            ios[k] = [e for e in info[k].values()]
            # elif os.path.exists(jobPipeline):
            #     with StarFile(jobPipeline) as sf:
            #         tables = sf.getTableNames()
            #         if 'pipeline_input_edges' in tables:
            #             inputsTable = sf.getTable('pipeline_input_edges')
            #             ios['inputs'] = [row.rlnPipeLineEdgeFromNode for row in inputsTable]
            #         if 'pipeline_output_edges' in tables:
            #             outputsTable = sf.getTable('pipeline_output_edges')
            #             ios['outputs'] = [row.rlnPipeLineEdgeToNode for row in outputsTable]
            self._ios = ios

        return self._ios

    def _getOutputMics(self):
        """ Find if there are micrographs (with/without CTF) in outputs. """
        mics = micsCtf = None
        for o in self.getInputsOutputs()['outputs']:
            if files := o.get('files', []):
                f = files[0][0]
                if f.endswith('micrographs_ctf.star'):
                    micsCtf = self.project.join(o)
                elif f.endswith('micrographs.star'):
                    mics = self.project.join(o)
        return mics, micsCtf

    def getSummary(self, **kwargs):
        """ Function to return the template and data used for this run summary.
        """
        summary = {'template': '', 'data': {}}
        data_values = None
        mics, micsCtf = self._getOutputMics()

        if mics is not None:
            summary['template'] = 'processing_ctf_summary.html'
            data_values = {}
            columns = ['rlnAccumMotionTotal', 'rlnAccumMotionEarly', 'rlnAccumMotionLate']
            for col in columns:
                data_values[col] = {
                    'label': col,
                    'color': '#852999',
                    'data': []
                }

            with StarFile(mics) as sf:
                for row in sf.iterTable('micrographs'):
                    print(row, type(row))

                    for col in columns:
                        d = row._asdict()
                        data_values[col]['data'].append(d[col])

        elif micsCtf is not None:
            summary['template'] = 'processing_ctf_summary.html'
            #ctfStar = self.join('micrographs_ctf.star')
            #data_values = self.project.load_ctf_values(ctfStar)
            data_values = self.project.load_ctf_values(micsCtf)

        elif self.className in ['autopick', 'manualpick']:
            summary['template'] = 'processing_picking_summary.html'
            coordStar = self.join(f'{self.className}.star')
            data_values = self.project.load_coordinates_values(coordStar)

        elif self.className in ['class2d', 'select']:
            summary['template'] = 'processing_2d_summary.html'
            data_values = {'iterations': [1, 2, 3]}

        elif self.className == 'class3d':
            volumes = []
            # Load completed iterations base on _it*_model.star
            iterations = glob(self.join('*_it*_model.star'))
            iterations.sort(reverse=True)

            data = {'volumes': volumes, 'iterations': iterations}
            summary = {
                'template': 'processing_3d_summary.html',
                'data': data
            }

            iterFile = kwargs.get('iter_file', iterations[0] if iterations else None)
            if iterFile:
                data['iter_file'] = iterFile
                ios = self.getInputsOutputs()
                inputParticles = [self.project.join(i) for i in ios['inputs']
                                  if i.endswith('.star')][0]
                with StarFile(inputParticles) as sf:
                    nParticles = sf.getTableSize('particles')

                with StarFile(iterFile) as sf:
                    for row in sf.iterTable('model_classes'):
                        volPath = row.rlnReferenceImage
                        if self.project.exists(volPath):
                            # TODO: Load other volumes when more than one class
                            # or when the job is still running
                            data = self.project.get_volume_data(self.project.join(volPath),
                                                                volume_data='slices',
                                                                axis='zyx',
                                                                slice_dim=64,
                                                                slice_number=32)
                            volumes.append({
                                'file_path': volPath,
                                'slices': data['slices'],
                                'slice_dim': 64,
                                'data': {'%': '%0.2f' % (row.rlnClassDistribution * 100),
                                         'Particles': round(nParticles * row.rlnClassDistribution)
                                         }
                            })

        elif self.className == 'initialmodel':
            volumes = []
            summary = {
                'template': 'processing_volume_summary.html',
                'data': {'volumes': volumes}
            }
            volPath = self.join('initial_model.mrc')
            iterDict = defaultdict(lambda: [])
            lastIter = -1
            import re
            r = re.compile('.+_it(\d{3,5}?)_.+\.(\w+)')

            for v in glob(self.join('*_it*.*')):
                if s := r.search(v):
                    it = int(s.group(1))
                    if it > lastIter:
                        lastIter = it
                    iterDict[it].append(v)

            def _iterVol(fn):
                return fn.endswith('.mrc') and '_class' in fn

            def _iterStar(fn):
                return fn.endswith('.star')

            vols = [f for f in iterDict[lastIter] if _iterVol(f)]
            vols.sort()
            stars = [f for f in iterDict[lastIter] if _iterStar(f)]
            stars.sort()
            summary['data']['files'] = stars

            for v in vols:
                if os.path.exists(v):
                    data = self.project.get_volume_data(v,
                                                        volume_data='slices',
                                                        axis='zyx',
                                                        slice_dim=64,
                                                        slice_number=32)
                    volumes.append({
                        'file_path': self.project.relpath(v),
                        'slices': data['slices'],
                        'slice_dim': 64
                    })

        if data_values:
            summary['data'] = {'data_values': data_values}

        return summary

    def getOverview(self, **kwargs):
        if 'file_path' in kwargs:
            return self.getFileInfo(**kwargs)

        overview = {'template': '', 'data': {}}
        data_values = None
        mics, micsCtf = self._getOutputMics()

        #if self.className == 'ctffind':
        if micsCtf is not None:
            overview['template'] = 'processing_ctf_overview.html'
            data_values = self.project.load_ctf_values(micsCtf, index=True)
        elif self.className in ['autopick', 'manualpick']:
            overview['template'] = 'processing_ctf_overview.html'
            coordStar = self.join(f'{self.className}.star')
            data_values = self.project.load_coordinates_values(coordStar, index=True)

        if data_values:
            overview['data'] = {'data_values': data_values}

        return overview

    def getFileInfo(self, **kwargs):
        path = kwargs['file_path']
        if path.endswith('.star'):
            result = self._load_star_file(self.project.join(path), **kwargs)
        elif path.endswith('.mrc'):
            result = self._load_volume_file(self.project.join(path), **kwargs)
        else:
            raise Exception("File type not supported")

        result['data']['file_path'] = path
        return result

    def _load_star_file(self, starFile, **kwargs):
        kwargs['file_path'] = starFile
        func_name = 'processing_star_card' if 'table_name' in kwargs else 'processing_star_overview'
        kwargs.update({'file_path': starFile, 'content_id': func_name})
        return {
            'template': f'{func_name}.html',
            'data': app.dc.get(**kwargs)
        }

    def _load_volume_file(self, volumeFile, **kwargs):
        result = {
            'template': 'processing_volume_card.html',
            'data': self.project.get_volume_data(volumeFile,
                                                 volume_data='slices array',
                                                 axis='zyx',
                                                 slice_number=32)
        }
        return result

    def get_micrograph_data(self, micId):
        p = self.project  # shortcut
        data = {}
        mics, micsCtf = self._getOutputMics()

        def _load_micrograph_data(micStar):
            return p.load_micrograph_data(micId, micStar)

        if self.jobtype == 'emw-preprocessing':  # FIXME: Make this more general based on outputs
            micStar = self.join('micrographs.star')
            coordStar = self.join('coordinates.star')
            data = _load_micrograph_data(micStar)
            data['coordinates'] = p.get_micrograph_coordinates(coordStar, micId)
        elif micsCtf is not None:
            data = _load_micrograph_data(micsCtf)
        elif mics is not None:
            data = _load_micrograph_data(mics)
        elif self.className in ['autopick', 'manualpick']:
            coordStar = self.join(f'{self.className}.star')
            for i in self.getInputsOutputs()['inputs']:
                iBase = os.path.basename(i)
                if iBase.startswith('micrographs'):
                    data = _load_micrograph_data(p.join(i))
                    data['coordinates'] = p.get_micrograph_coordinates(
                        coordStar, micId)
                    break
        return data

    def get_classes2d(self, iteration=None):
        """ Get classes information from a class 2d run. """
        p = os.path.join(self.extra['data'], '*_classes.mrcs')
        return self.project.get_classes2d_data(pattern=p)

        clsAverages = self.join('class_averages.star')
        if os.path.exists(clsAverages):  # selection jobs
            return self.project.get_classes2d_data(modelStar=clsAverages,
                                                   dataStar=self.join('particles.star'),
                                                   root=self.project.path)

        # 2D classification jobs
        it = "%03d" % iteration if iteration else "*"
        return self.project.get_classes2d_data(pattern=self.join(f"*_it{it}_classes.mrcs"),
                                               root=self.project.path)


