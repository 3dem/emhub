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

import mrcfile
from emtools.utils import Path, Timer, Pretty
from emtools.metadata import StarFile, EPU, SqliteFile
from emtools.image import Thumbnail

from .base import SessionRun, SessionData, hours
from ..processing.processing_relion import RelionSessionData


class ScipionRun(SessionRun):
    """ Helper class to manipulate Scipion run data. """
    def __init__(self, project, runDict):
        self.dict = runDict
        if '' not in runDict:
            raise Exception("Expecting empty string keyword in runDict.")

        runRow = runDict['']  # first protocol row, empty name
        self.id = runRow['id']
        self.className = runRow['classname']
        wdRow = runDict[f'{self.id}.workingDir']
        self.label = runRow['label']

        SessionRun.__init__(self, project, project.join(wdRow['value']))

    def getInfo(self):
        return {'id': self.id, 'className': self.className, 'label': self.label}

    def getFormDefinition(self):
        return ScipionSessionData.getFormDefinition(self.className)

    def getInputsOutputs(self):
        return {
            'inputs': [],
            'outputs': []
        }

    def getValues(self):
        values = {}
        parents = {}
        for k, v in self.dict.items():
            parts = v['name'].split('.')
            pid = v['parent_id']
            if pid == self.id:
                name = parts[-1]
                values[name] = v['value']
                parents[v['id']] = name
            elif pid in parents:
                parent_name = parents[pid]
                if values[parent_name] is not None:
                    values[parent_name] += f".{v['value']}"

        return values

    def getStdOut(self):
        """ Return run's stdout file. """
        return self.join('logs', 'run.stdout')

    def getStdError(self):
        """ Return run's stdout file. """
        return self.join('logs', 'run.stderr')

    def getSummary(self, **kwargs):
        data = {}
        summary = {'template': '', 'data': data}
        data_values = {}

        ctfsSqlite = self.join('ctfs.sqlite')
        if os.path.exists(ctfsSqlite):
            summary['template'] = 'processing_ctf_summary.html'
            data_values = self._load_ctfvalues(ctfsSqlite)
        elif self.className == 'ProtRelionClassify2D':
            summary['template'] = 'processing_2d_summary.html'
            data_values = {'iterations': [1, 2, 3]}

        if data_values:
            data['data_values'] = data_values

        return summary

    def getOverview(self, **kwargs):
        overview = {'template': '', 'data': {}}
        data_values = {}

        ctfsSqlite = self.join('ctfs.sqlite')
        coordsSqlite = self.join('coordinates.sqlite')

        if os.path.exists(ctfsSqlite):
            overview['template'] = 'processing_ctf_overview.html'
            data_values = self._load_ctfvalues(ctfsSqlite, index=True)
        elif os.path.exists(coordsSqlite):
            overview['template'] = 'processing_ctf_overview.html'

        if data_values:
            overview['data'] = {'data_values': data_values}

        return overview

    def get_micrograph_data(self, micId):
        return self.project.load_mic_data(micId, self.join('ctfs.sqlite'))

    def _load_ctfvalues(self, ctfsSqlite, index=False):
        data_values = {
            'ctfDefocusU': {
                'label': 'Defocus U',
                'scale': 0.0001,
                'unit': 'µm',
                'color': '#852999',
                'maxX': 4,
                'data': []
            },
            'ctfDefocusV': {
                'label': 'Defocus V',
                'scale': 0.0001,
                'unit': 'µm',
                'color': '#852999',
                'maxX': 4,
                'data': []
            },
            'ctfResolution': {
                'color': '#EF9A53',
                'label': 'Resolution',
                'unit': 'Å',
                'data': []
            },
            'default_y': 'ctfResolution',
            'default_x': '',
            'default_color': 'ctfDefocusV',
            'has_ctf': True
        }
        indexes = []
        with SqliteFile(ctfsSqlite) as sf:
            for row in sf.iterTable('Objects', classes='Classes'):
                indexes.append(row['id'])
                ctf = ScipionSessionData.ctf_from_row(row)
                for k in ['ctfDefocusU', 'ctfDefocusV', 'ctfResolution']:
                    data_values[k]['data'].append(ctf[k])

        if index:
            data_values['id'] = {
                'label': 'Id',
                'data': indexes
            }
            data_values['default_x'] = 'id'

        return data_values

    def get_classes2d(self, iteration=None):
        """ Get classes information from a class 2d run. """
        it = "%03d" % iteration if iteration else "*"
        pattern = self.join('extra', f"*_it{it}_classes.mrcs")
        return RelionSessionData.get_classes2d_data(pattern)


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
        outputs = {'classes2d': []}

        for r in results:
            if r.endswith('ProtImportMovies/movies.sqlite'):
                outputs['movies'] = r
            elif r.endswith('ctfs.sqlite'):
                outputs['ctfs'] = r
            elif r.endswith('coordinates.sqlite'):
                outputs['coordinates'] = r
            elif r.endswith('classes2D.sqlite'):
                outputs['classes2d'].append(r)

        outputs['classes2d'].sort()

        outputs['select2d'] = glob(self.join('Runs', '??????_ProtRelionSelectClasses2D'))
        outputs['select2d'].sort()
        self.outputs = outputs

    def _stats_from_sqlite(self, sqliteFn, fileKey=None):
        stats = {
            'hours': 0,
            'count': 0,
            'first': '',
            'last': '',
        }
        if sqliteFn:
            with SqliteFile(sqliteFn) as sf:
                size = sf.getTableSize('Objects')
                stats['count'] = size
                if fileKey is not None:
                    first = sf.getTableRow('Objects', 0, classes='Classes')
                    last = sf.getTableRow('Objects', size - 1, classes='Classes')
                    stats['first'] = self.mtime(first[fileKey])
                    stats['last'] = self.mtime(last[fileKey])
                    stats['hours'] = hours(stats['first'], stats['last'])
        return stats

    def _stats_from_output(self, outputKey, fileKey=None):
        return self._stats_from_sqlite(self.outputs.get(outputKey, None), fileKey)

    def get_stats(self):
        if 'movies' not in self.outputs:
            return {'movies': {'count': 0}, 'ctfs': {'count': 0}}

        msEpu = None

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
            'movies': msEpu or self._stats_from_output('movies'),
            'ctfs': self._stats_from_output('ctfs', fileKey='_psdFile'),
            'coordinates': self._stats_from_output('coordinates'),
            'classes2d': len(self.outputs['classes2d'])
        }

    def runid_from_sqlite(self, sqliteFn):
        parts = sqliteFn.split('/')
        runFolder = parts[-2]
        return int(runFolder.split('_')[0])

    def get_ctfs_runid(self):
        """ Return the run_id for the ctfs used for the general session overview. """
        if ctfs := self.outputs.get('ctfs', None):
            return self.runid_from_sqlite(ctfs)
        return None

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
                r = row['_resolution']
                micData = {
                    'micrograph': row['_micObj._filename'],
                    'micName': row['_micObj._micName'],
                    'ctfImage': row['_psdFile'],
                    'ctfDefocus': row['_defocusU'],
                    'ctfResolution': max(min(r, 10), 0),
                    'ctfDefocusAngle': row['_defocusAngle'],
                    'ctfAstigmatism': abs(dU - dV)
                }
                yield micData

    @staticmethod
    def ctf_from_row(row):
        dU, dV = row['_defocusU'], row['_defocusV']
        return {
            'ctfDefocusU': round(dU / 10000., 2),
            'ctfDefocusV': round(dV / 10000., 2),
            'ctfDefocusAngle': round(row['_defocusAngle'], 2),
            'ctfAstigmatism': round(abs(dU - dV) / 10000, 2),
            'ctfResolution': round(row['_resolution'], 2)
        }

    def load_mic_data(self, micId, ctfSqlite):
        """ Load micrograph information from a given sqlite file (e.g. CTFs)."""
        data = {}
        if ctfSqlite and os.path.exists(ctfSqlite):
            with SqliteFile(ctfSqlite) as sf:
                row = sf.getTableRow('Objects', micId - 1, classes='Classes')
                micThumb = Thumbnail.Micrograph()
                psdThumb = Thumbnail.Psd()
                micName = row['_micObj._micName']
                micFn = self.join(row['_micObj._filename'])
                micThumbBase64 = micThumb.from_mrc(micFn)
                psdFn = self.join(row['_psdFile']).replace(':mrc', '')
                pixelSize = row['_micObj._samplingRate']

                ctfProfile = psdFn.replace('.mrc', '_avrot.txt')
                if os.path.exists(ctfProfile):
                    with open(ctfProfile) as f:
                        ctfPlot = [line.split() for line in f
                                   if not line.startswith('#')]
                else:
                    ctfPlot = []

                loc = EPU.get_movie_location(micName)
                data = ScipionSessionData.ctf_from_row(row)
                data.update({
                    'micThumbData': micThumbBase64,
                    'psdData': psdThumb.from_mrc(psdFn),
                    # TODO: Retrieving coordinates from multiple micrographs is very slow now
                    'coordinates': self.get_micrograph_coordinates(row['_micObj._micName']),
                    'micThumbPixelSize': pixelSize * micThumb.scale,
                    'pixelSize': pixelSize,
                    'gridSquare': loc['gs'],
                    'foilHole': loc['fh'],
                    'ctfPlot': ctfPlot
                })
        return data

    def get_micrograph_data(self, micId):
        return self.load_mic_data(micId, self.outputs.get('ctfs', None))

    def get_classes2d(self, runId=None):
        """ Iterate over 2D classes. """
        classes2d = {
            'runs': [],
            'items': [],
            'selection': []
        }

        if outputs2d := self.outputs['classes2d']:
            otf_file = self.join('scipion-otf.json')
            if os.path.exists(otf_file):
                with open(otf_file) as f:
                    otf = json.load(f)
            else:
                otf = {'2d': {}}
            def _label(fn):
                parts = Path.splitall(fn)
                label = parts[-2]  # Run name
                for run in otf['2d'].values():
                    if label in run['runDir']:
                        label = run['runName']
                        break
                return label

            classes2d['runs'] = [{'id': i, 'label': _label(fn)}
                                 for i, fn in enumerate(outputs2d)]

            runIndex = -1 if runId is None else runId
            classesSqlite = outputs2d[runIndex]

            for sel in self.outputs['select2d']:
                starFn = os.path.join(sel, 'extra', 'class_averages.star')
                if os.path.exists(starFn) and os.path.getsize(starFn) > 0:
                    with StarFile(starFn) as sf:
                        table = sf.getTable('')
                        path = table[0].rlnReferenceImage
                        runName = Path.splitall(path)[1]
                        # We found a selection job for this classification run
                        if runName in classesSqlite:
                            classes2d['selection'] = [int(row.rlnReferenceImage.split('@')[0])
                                                      for row in table if row.rlnEstimatedResolution < 30]
                            break
            runFolder = os.path.join(os.path.dirname(classesSqlite), 'extra',
                                     '*_classes.mrcs')
            classes2d['items'] = RelionSessionData.get_classes2d_data(runFolder)

        return classes2d

    def get_micrograph_coordinates(self, micFn):
        self.all_coords = getattr(self, 'all_coords', None)
        if self.all_coords is None:
            coords = defaultdict(lambda: [])
            with Timer():
                if coordSqlite := self.outputs.get('coordinates', None):
                    with SqliteFile(coordSqlite) as sf:
                        for row in sf.iterTable('Objects', classes='Classes'):
                            coords[row['_micName']].append((row['_x'], row['_y']))
            self.all_coords = coords

        return self.all_coords[micFn]

    def get_workflow(self):
        protList = []
        protDict = {}

        with SqliteFile(self.join('project.sqlite')) as sf:
            for row in sf.iterTable('Objects'):
                name = row['name']
                pid = row['parent_id']

                if row['parent_id'] is None and name != 'CreationTime':
                    prot = {
                        'id': row['id'],
                        'label': row['label'],
                        'links': [],
                        'status': 'finished',
                        'type': row['classname']
                    }
                    protList.append(prot)
                    protDict[prot['id']] = prot
                elif 'outputs' in name:
                    pass
                elif row['classname'] == 'Pointer':
                    if row['value']:
                        rid = int(row['value'])
                        if rid in protDict:
                            protDict[rid]['links'].append(pid)

                    if pid in protDict:
                        pass
                elif 'status' in name:
                    # Update protocol status
                    protDict[pid]['status'] = row['value']
        return protList

    def get_run(self, runId):
        prefix = f'{runId}.'
        runDict = {}
        rid = int(runId)

        with SqliteFile(self.join('project.sqlite')) as sf:
            for row in sf.iterTable('Objects'):
                name = row['name']
                # Get all rows related to that run as a dict
                if row['id'] == rid or row['parent_id'] == rid:
                    runDict[name] = row

        return ScipionRun(self, runDict)

    @staticmethod
    def getFormDefinition(className):
        """ Return the json definition of a form defined by className. """
        from pyworkflow.protocol import ElementGroup
        import pwem
        ProtClass = pwem.Domain.findClass(className)
        prot = ProtClass()
        logoPath = prot.getPluginLogoPath()
        if logoPath and os.path.exists(logoPath):
            thumb = Thumbnail(output_format='base64', max_size=(128, 64))
            logo = thumb.from_path(logoPath)
        else:
            logo = ''

        formDef = {
            'name': className,
            'logo': logo,
            'package': prot.getClassPackageName(),
            'sections': []
        }

        def getParamDef(name, param):
            paramDef = {
                'label': param.getLabel(),
                'name': name,
                'paramClass': param.getClassName(),
                'important': param.isImportant(),
                'expert': param.expertLevel.get()
            }
            if param.hasCondition():
                paramDef['condition'] = param.condition.get()

            if hasattr(param, 'choices'):
                paramDef['choices'] = param.choices
                paramDef['display'] = param.display.get()

            if isinstance(param, ElementGroup):
                paramDef['params'] = []
                for subname, subparam in param.iterParams():
                    paramDef['params'].append(getParamDef(subname, subparam))
            else:
                paramDef['valueClass'] = param.paramClass.__name__
                paramDef['default'] = param.getDefault()
                paramDef['help'] = param.getHelp()

            return paramDef

        for section in prot.iterDefinitionSections():
            sectionDef = {
                'label': section.getLabel(),
                'params': []
            }

            for name, param in section.iterParams():
                sectionDef['params'].append(getParamDef(name, param))

            formDef['sections'].append(sectionDef)

        return formDef

