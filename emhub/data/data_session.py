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
from collections import defaultdict
import json

import mrcfile
from emtools.utils import Path, Timer, Pretty
from emtools.metadata import StarFile, EPU, SqliteFile
from emtools.image import Thumbnail


def hours(tsFirst, tsLast):
    dtFirst = dt.datetime.fromtimestamp(tsFirst)
    dtLast = dt.datetime.fromtimestamp(tsLast)
    d = dtLast - dtFirst
    return d.days * 24 + d.seconds / 3600


class SessionRun:
    """ Group functions related to a run in a Session. """
    def __init__(self, path):
        self._path = path
        self._epuData = None

    def join(self, *paths):
        return os.path.join(self._path, *paths)

    def getFormDefinition(self):
        """ Return the class definition for this run type. """
        return {}

    def getValues(self):
        return {}

    def getStdOut(self):
        """ Return run's stdout file. """
        return None

    def getStdError(self):
        """ Return run's stdout file. """
        return None


class SessionData:
    """ Base class with common functionality. """
    def __init__(self, path, mode='r'):
        self._path = path
        self._epuData = None

    def join(self, *paths):
        return os.path.join(self._path, *paths)

    def getEpuData(self):
        if not self._epuData:
            epuFolder = self.join('EPU')
            moviesStarFile = self.join('EPU', 'movies.star')
            if Path.exists(moviesStarFile):
                self._epuData = EPU.Data(epuFolder, moviesStarFile)
        return self._epuData

    def mtime(self, fn):
        mt = os.path.getmtime(self.join(fn))
        return mt

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
        particles = 0
        for mic in self.get_micrographs():
            micName = mic.get('micName', mic['micrograph'])
            loc = EPU.get_movie_location(micName)
            if loc['gs'] == gsId:
                defocus.append(_microns(mic['ctfDefocus']))
                resolution.append(round(mic['ctfResolution'], 3))
                particles += len(self.get_micrograph_coordinates(micName))

        locData.update({'defocus': defocus,
                        'resolution': resolution,
                        'particles': particles
                        })

        return locData

    def get_gridsquares(self, **kwargs):
        epuData = self.getEpuData()
        gs = []
        lastGs = None
        counter = 0
        if epuData is not None:
            for row in epuData.moviesTable:
                movieGs = row.gsId
                if movieGs != lastGs:
                    if lastGs:
                        gs.append({'gsId': lastGs, 'micrographs': counter})
                    lastGs = movieGs
                    counter = 0
                counter += 1
            gs.append({'gsId': lastGs, 'count': counter})

        return gs

    def get_classes2d(self):
        pass

    def get_workflow(self):
        """ Return protocols and their relations. """
        return []

    def get_run(self, runId):
        """ Retrieve Run class. """
        return None


class RelionRun(SessionRun):
    """ Helper class to manipulate Relion run data. """
    def __init__(self, path):
        SessionRun.__init__(self, path)

    def getFormDefinition(self):
        return {}

    def getValues(self):
        values = {}
        return values

    def getStdOut(self):
        """ Return run's stdout file. """
        return self.join('run.out')

    def getStdError(self):
        """ Return run's stdout file. """
        return self.join('run.err')


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

                coords = self.get_micrograph_coordinates(row.rlnMicrographName)

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
        return RelionRun(self.join(runId))

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

    def get_micrograph_coordinates(self, micFn):
        if pickStar := self.get_last_star('*Pick', '*pick.star'):
            with StarFile(self.join(pickStar)) as sf:
                for row in sf.iterTable('coordinate_files'):
                    if micFn in row.rlnMicrographName:
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


class ScipionRun(SessionRun):
    """ Helper class to manipulate Scipion run data. """
    def __init__(self, projectDir, runDict):
        self.dict = runDict

        runRow = runDict['']  # first protocol row, empty name
        self.id = runRow['id']
        self.className = runRow['classname']

        wdRow = runDict[f'{self.id}.workingDir']
        SessionRun.__init__(self, os.path.join(projectDir, wdRow['value']))

    def getFormDefinition(self):
        return ScipionSessionData.getFormDefinition(self.className)

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

    def get_micrograph_data(self, micId):
        if ctfSqlite := self.outputs.get('ctfs', None):
            with SqliteFile(ctfSqlite) as sf:
                row = sf.getTableRow('Objects', micId - 1, classes='Classes')
                micThumb = Thumbnail.Micrograph()
                psdThumb = Thumbnail.Psd()
                micName = row['_micObj._micName']
                micFn = self.join(row['_micObj._filename'])
                micThumbBase64 = micThumb.from_mrc(micFn)
                psdFn = self.join(row['_psdFile']).replace(':mrc', '')
                pixelSize = row['_micObj._samplingRate']

                loc = EPU.get_movie_location(micName)
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
                    # TODO: Retrieving coordinates from multiple micrographs is very slow now
                    'coordinates': self.get_micrograph_coordinates(row['_micObj._micName']),
                    'micThumbPixelSize': pixelSize * micThumb.scale,
                    'pixelSize': pixelSize,
                    'gridSquare': loc['gs'],
                    'foilHole': loc['fh']
                }
        return {}

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
            runFolder = os.path.join(os.path.dirname(classesSqlite), 'extra')
            classes2d['items'] = RelionSessionData.get_classes2d_from_run(runFolder)

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
                if row['id'] == rid or name.startswith(prefix):
                    runDict[name] = row

        return ScipionRun(self._path, runDict)

    @staticmethod
    def getFormDefinition(className):
        """ Return the json definition of a form defined by className. """
        from pyworkflow.protocol import ElementGroup
        import pwem

        ProtClass = pwem.Domain.findClass(className)
        prot = ProtClass()
        logoPath = prot.getPluginLogoPath()
        if logoPath and os.path.exists(logoPath):
            thumb = Thumbnail(output_format='base64', max_size=(64, 64))
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
