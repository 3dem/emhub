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
from emtools.utils import Path, Timer, Pretty
from emtools.metadata import StarFile, EPU, SqliteFile
from emtools.image import Thumbnail

from ..base import SessionRun, SessionData, hours

location = os.path.dirname(__file__)


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

        config = f"{self.package}.{self.className}.json"
        configFn = os.path.join(location, 'forms', config)
        print("Config file", configFn)

        if os.path.exists(configFn):
            with open(configFn) as f:
                formConf = json.load(f)
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
        ios = {'inputs': [], 'outputs': []}

        with StarFile(self.join('job_pipeline.star')) as sf:
            tables = sf.getTableNames()
            if 'pipeline_input_edges' in tables:
                inputsTable = sf.getTable('pipeline_input_edges')
                ios['inputs'] = [row.rlnPipeLineEdgeFromNode for row in inputsTable]
            if 'pipeline_output_edges' in tables:
                outputsTable = sf.getTable('pipeline_output_edges')
                ios['outputs'] = [row.rlnPipeLineEdgeToNode for row in outputsTable]

        return ios

    def getSummary(self, **kwargs):
        """ Function to return the template and data used for this run summary.
        """
        summary = {'template': '', 'data': {}}
        data_values = None

        if self.className == 'motioncorr':
            summary['template'] = 'processing_ctf_summary.html'
            data_values = {}
            columns = ['rlnAccumMotionTotal', 'rlnAccumMotionEarly', 'rlnAccumMotionLate']
            for col in columns:
                data_values[col] = {
                    'label': col,
                    'color': '#852999',
                    'data': []
                }

            with StarFile(self.join('corrected_micrographs.star')) as sf:
                for row in sf.iterTable('micrographs'):
                    print(row, type(row))

                    for col in columns:
                        d = row._asdict()
                        data_values[col]['data'].append(d[col])

        elif self.className == 'ctffind':
            summary['template'] = 'processing_ctf_summary.html'
            ctfStar = self.join('micrographs_ctf.star')
            data_values = self.project.load_ctf_values(ctfStar)

        elif self.className in ['autopick', 'manualpick']:
            summary['template'] = 'processing_picking_summary.html'
            coordStar = self.join(f'{self.className}.star')
            data_values = self.project.load_coordinates_values(coordStar)

        elif self.className == 'class2d':
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
                inputParticles = [i for i in ios['inputs'] if i.endswith('.star')][0]
                with StarFile(inputParticles) as sf:
                    nParticles = sf.getTableSize('particles')

                with StarFile(iterFile) as sf:
                    for row in sf.iterTable('model_classes'):
                        volPath = row.rlnReferenceImage
                        if self.project.exists(volPath):
                            # TODO: Load other volumes when more than one class
                            # or when the job is still running
                            data = self.project.get_volume_data(volPath,
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
            if os.path.exists(volPath):
                #TODO: Load other volumes when more than one class
                # or when the job is still running
                data = self.project.get_volume_data(volPath,
                                                    volume_data='slices',
                                                    axis='zyx',
                                                    slice_dim=128,
                                                    slice_number=32)
                volumes.append({
                    'file_path': self.project.relpath(volPath),
                    'slices': data['slices'],
                    'slice_dim': 128
                })

        if data_values:
            summary['data'] = {'data_values': data_values}

        return summary

    def getOverview(self, **kwargs):
        if 'file_path' in kwargs:
            return self.getFileInfo(**kwargs)

        overview = {'template': '', 'data': {}}
        data_values = None

        if self.className == 'ctffind':
            overview['template'] = 'processing_ctf_overview.html'
            ctfStar = self.join('micrographs_ctf.star')
            data_values = self.project.load_ctf_values(ctfStar, index=True)
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
        result = {
            'template': 'processing_star_overview.html',
            'data': {}
        }
        data = result['data']  # shortcut

        with StarFile(starFile) as sf:
            if tn := kwargs.get('table_name', None):
                # only load rows for this table, not the all tables info
                ti = sf.getTableInfo(tn)
                data.update({
                    'default_table': tn,
                    'columns': ti.getColumnNames(),
                    'rows': [r._asdict() for r in sf.iterTable(tn, limit=10)]
                })
                result['template'] = 'processing_star_card.html'
            else:
                # load all tables info and default table rows
                tables = {}
                tableNames = sf.getTableNames()
                defaultTable = kwargs.get('default_table', tableNames[0])
                for tn in tableNames:
                    ti = sf.getTableInfo(tn)
                    tables[tn] = {
                        'columns': ti.getColumnNames(),
                        'rows': sf.getTableSize(tn)
                    }
                    if tn == defaultTable:
                        data['default_table'] = defaultTable
                        data['rows'] = [r._asdict() for r in sf.iterTable(tn, limit=10)]

                    data['tables'] = tables

        return result

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
        data = {}

        def _load_micrograph_data(micStar):
            return self.project.load_micrograph_data(micId, micStar)

        if self.className == 'motioncorr':
            data = _load_micrograph_data(self.join('corrected_micrographs.star'))
        if self.className == 'ctffind':
            data = _load_micrograph_data(self.join('micrographs_ctf.star'))
        elif self.className in ['autopick', 'manualpick']:
            coordStar = self.join(f'{self.className}.star')
            for i in self.getInputsOutputs()['inputs']:
                iBase = os.path.basename(i)
                if iBase.startswith('micrographs'):
                    data = _load_micrograph_data(self.project.join(i))
                    data['coordinates'] = self.project.get_micrograph_coordinates(
                        coordStar, micId)
                    break
        return data

    def get_classes2d(self, iteration=None):
        """ Get classes information from a class 2d run. """
        it = "%03d" % iteration if iteration else "*"
        pattern = self.join(f"*_it{it}_classes.mrcs")
        return self.project.get_classes2d_data(pattern)


