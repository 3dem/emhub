# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *
# * [1] SciLifeLab, Stockholm University
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
# *  e-mail address 'delarosatrevin@gmail.com'
# *
# **************************************************************************
"""
Content function to visualize tomography results
"""
import os
import json
from uuid import uuid4
import shutil
import random
from collections import defaultdict

from emtools.utils import Path, FolderManager, Process, Pretty
from emtools.image import Thumbnail
from emtools.metadata import StarFile, WarpXml

from emwrap.base import ProcessingConfig


DEFAULT_SESSION = {
    'path': '/Volumes/CoESCB/home/common/purified_ApoF_tomo_data2_processing',  #'/Volumes/CoESCB/home/common/Thermo_20250620-Sample7',
    'tomograms': 'tomostar',
    'reconstruction': 'warp_tiltseries/reconstruction',
    'picking': 'pytomOutput',
}


def register_content(dc):

    @dc.content
    def emwrap_config(**kwargs):
        if not dc.app.user.is_manager:
            raise Exception("Invalid access")

        report = ProcessingConfig.get_config_report()

        return {
            'config_summary': report['summary'],
            'workflow_rows': report['workflow_rows'],
            'job_rows': report['job_rows'],
            'program_rows': report['program_rows'],
        }

    @dc.content
    def emwrap_workflow_overview(**kwargs):
        if not dc.app.user.is_manager:
            raise Exception("Invalid access")

        workflow_id = kwargs['workflow_id']
        workflow_file = ProcessingConfig.get_workflow_file(workflow_id)
        workflow_def = ProcessingConfig.get_workflow(workflow_id)

        return {
            'workflow_id': workflow_id,
            'workflow_file': os.path.basename(workflow_file),
            'workflow_name': workflow_def.get('name', workflow_id),
            'workflow_description': workflow_def.get('description', ''),
            'workflow_jobs': workflow_def.get('jobs', [])
        }

    @dc.content
    def tomo_session(**kwargs):
        if tsId := kwargs.get('tomo_session_id', None):
            mode = kwargs.get('mode', 'widget')

            if tp := dc.app.dm.get_entry_by(id=tsId):
                data = tp.extra['data']
                path = data['processing_path']
                tomo_session = {
                    'path': path,
                    'title': data.get('title', os.path.basename(path)),
                    'tomograms_star': 'tomograms.star',
                }
                data = {
                    'tomo_session': tomo_session,
                    'tomograms': [],  # To be loaded
                    'tomo_session_id': tsId
                }
                if mode == 'widget':
                    data.update(dc.get_data('project_widget', entry_id=tsId, **kwargs))
                elif mode == 'workflow':
                    data.update(tomo_processing_content(entry_id=tsId, **kwargs))

                tsession = json.loads(kwargs.get('tomo_session', '{}'))
                if 'tomograms_star' in tsession:
                    tomo_session['tomograms_star'] = tsession['tomograms_star']
                data.update(tomo_session_content(tomo_session=json.dumps(tomo_session)))
                data['mode'] = mode
                return data
            else:
                raise Exception(f"Can load tomography session: {tsId}")
        else:
            raise Exception("Expecting tomo_session_id as argument.")

    @dc.content
    def tomo_picking(**kwargs):
        return projects_list(**kwargs)

    @dc.content
    def tomo_export(**kwargs):
        tomo_session = json.loads(kwargs['tomo_session'])
        tomograms = json.loads(kwargs.get('tomograms'))
        session_path = tomo_session['path']
        s = FolderManager(session_path)
        newTomoFolder = s.join(tomo_session['tomograms'] + '_selection')

        if os.path.exists(newTomoFolder):
            raise Exception(f"Selection folder '{newTomoFolder}' already exists.")

        os.mkdir(newTomoFolder)
        for t in tomograms:
            shutil.copy(t, newTomoFolder)

        return {
            'message': f'Exported {len(tomograms)} tomograms to folder {newTomoFolder}'
        }

    def _load_table_from_star(session_path, star_file):
        star_path = os.path.join(session_path, star_file)

        if not os.path.exists(star_path):
            raise Exception(f"Star file '{star_path}' does not exist")

        return StarFile.getTableFromFile('global', star_path)

    def _load_table_from_folders(session_path, tomo_session):
        s = FolderManager(session_path)

        # Read first if there is a session.json in the session path
        if s.exists('session.json'):
            with open(s.join('session.json')) as f:
                tomo_session = json.load(f)
                # Restore session_path
                tomo_session['path'] = session_path

        from emwrap.warp.utils import load_tomograms_table
        return load_tomograms_table(tomo_session)

    @dc.content
    def tomo_session_content(**kwargs):
        tomo_session = json.loads(kwargs['tomo_session'])
        session_path = tomo_session['path']
        s = FolderManager(session_path)
        table = None
        data = {
            'tomograms': [],
            'session_path': session_path,
            'columns_map': {}
        }

        tomograms_star = tomo_session.get('tomograms_star', 'tomograms.star')

        if s.exists(tomograms_star):
            table = _load_table_from_star(session_path, tomograms_star)

        if table:
            # It is possible to load the table from folder, but better to explicitly
            # generate the tomograms.star
            # table = _load_table_from_folders(session_path, tomo_session)
            tomograms = data['tomograms']
            colsMap = data['columns_map']
            cols = table.getColumnNames()

            def _join(p):
                return s.join(p) if p else p

            def _addCol(key, label, join=False):
                if label in cols:
                    colsMap[key] = lambda row: _join(getattr(row, label)) if join else getattr(row, label)

            _addCol('tomoName', 'rlnTomoName')
            _addCol('coords_md', 'rlnCoordinatesMetadata', join=True)
            _addCol('coords_n', 'rlnCoordinatesCount')
            _addCol('tomo_fn', 'rlnTomogram', join=True)
            _addCol('md', 'rlnTomoTiltSeriesStarFile', join=True)
            _addCol('ts_md', 'rlnTomoTiltSeriesStarFile', join=True)
            _addCol('aligned_ts', 'rlnTiltSeriesAligned', join=True)
            _addCol('tomo_xml', 'wrpTomoMetadataXml', join=True)
            _addCol('defocus', 'rlnDefocus')
            _addCol('thickness', 'rlnThickness')

            for row in table:
                values = {k: func(row) for k, func in colsMap.items()}
                tomograms.append(values)

        return data

    @dc.content
    def entry_tomo_processing_validate(entry):
        e = entry.json()
        data = e['extra']['data']
        ppath = None

        keys = [
            "processing_path",
            "data_path",
            "pixel_size",
            "voltage",
            "spherical_aberration",
            "amplitude_contrast",
            "total_dose"
        ]

        dpath = data.get('data_path', '')
        ppath = data.get('processing_path', '')

        for k in keys:
            v = data.get(k, '')
            if not v:
                raise Exception(f"Provide a value for '{k}', it can not be empty.")

        if not os.path.exists(dpath):
            raise Exception(f"Data path '{dpath}' does not exist!")

        if os.path.exists(ppath):
            pipeline_star = os.path.join(ppath, 'default_pipeline.star')
            if not os.path.exists(pipeline_star):
                raise Exception(f"Pipeline star file '{pipeline_star}' does not exist!. "
                                f"Please choose an existing project or create a new one.")
            
        else:
            parent_path = os.path.dirname(ppath)
            if not os.path.exists(parent_path):
                raise Exception(f"Parent path '{parent_path}' does not exist!")
            # Create a new project in the parent path
            os.makedirs(ppath)
            from emwrap.base import ProjectManager
            pm = ProjectManager(ppath, create=True)
            # Also create an import job template with the provided values
            args = {
                "tilt_images": "data/",
                "mdoc_files": "data/Position*[1-9].mdoc",
                "gain_file": "",
                "tilt_axis_angle": "85",
                "acq.pixel_size": data['pixel_size'],
                "acq.voltage": data['voltage'],
                "acq.cs": data['spherical_aberration'],
                "acq.amplitude_constrast": data['amplitude_contrast'],
                "acq.total_dose": data['total_dose'],
                "wait.timeout": "1",
                "wait.file_change": "1",
                "wait.sleep": "1"
            }
            pm.saveJob('emw-import-ts', args)
            os.symlink(data['data_path'], os.path.join(ppath, 'data'))


    @dc.content
    def entry_tomo_processing_content(**kwargs):
        return {}

    @dc.content
    def pseudo_projects(**kwargs):
        entry_type = kwargs['entry_type']
        project_type = f"special:{kwargs.get('project_type', entry_type)}"

        dm = dc.app.dm  # shortcut
        uid = dc.app.user.id
        user_projects = dm.get_projects(condition=f"user_id={uid}")
        projects = set(p.id for p in user_projects)
        entries = dm.get_entries(condition=f"type='{entry_type}'", asJson=True)
        # Group entries by project
        pseudo_projects = defaultdict(lambda: [])
        shared_projects = []
        default_project_id = None

        def _title(e):
            data = e['extra']['data']
            e['title'] = e['title'] or os.path.basename(data.get('processing_path', ''))
            return e


        for e in entries:
            pid = e['project_id']
            if pid in projects:
                pseudo_projects[pid].append(_title(e))
                default_project_id = pid
            else:
                data = e['extra'].get('data', {})
                shared = data.get('share_table', [])
                if any(r['user_email'] == dc.app.user.email for r in shared):
                    shared_projects.append(_title(e))

        # If there are no current tomography entries,
        # let's create a default project
        if default_project_id is None:
            for p in user_projects:
                if p.status == project_type:
                    default_project_id = p.id
                    break

            if default_project_id is None:
                defaultTomoProject = dm.create_project(
                    user_id=uid,
                    status=project_type,
                    user_can_edit=True,
                    is_confidential=False,
                    title=f"Default Project for {entry_type} entries",
                    description=""
                )
                default_project_id = defaultTomoProject.id

            pseudo_projects[default_project_id] = []

        return {
            'pseudo_projects': pseudo_projects, 
            'shared_projects': shared_projects,
            'default_project_id': default_project_id
        }

    @dc.content
    def processing_tomo_list(**kwargs):
        kwargs['entry_type'] = 'tomo_processing'
        kwargs['project_type'] = 'processing_tomo'
        data = dc.get_data('pseudo_projects', **kwargs)
        data['tomo_projects'] = data['pseudo_projects']
        return data

    @dc.content
    def processing_tomo(**kwargs):
        kwargs['content_id'] = 'project_form'
        return dc.get(**kwargs)

    @dc.content
    def fsc_plot(**kwargs):
        fscStar = kwargs['path']
        table = StarFile.getTableFromFile('', fscStar, guessType=False)
        resolution = []
        fscSeries = []
        fscSeriesDict = {}
        fscLabels = ['wrpFSCUnmasked', 'wrpFSCRandomized', 'wrpFSCCorrected', 'wrpFSCMasked']
        for label in fscLabels:
            s = {"name": label, "data": []}
            fscSeriesDict[label] = s
            fscSeries.append(s)
        
        for row in table[1:]:
            r = float(row.wrpResolution)
            if r < 20:
                resolution.append(r)
                for label in fscLabels:
                    # [x, y] pairs so Highcharts can use resolution on x-axis
                    fscSeriesDict[label]['data'].append([r, float(getattr(row, label))])

        return {
            'fsc_series': fscSeries,
            'resolution': resolution
        }

    @dc.content
    def tomo_processing_content(**kwargs):
        data = dc.get_data('processing_content', **kwargs)
        data['menu'] = dc.app.dm.get_config('processing_menus')['menu_flowchart']['protocols']
        return data

    # FIXME: More benchmark_ functions to a separate place
    def get_benchmarks():
        return dc.app.dm.get_config('benchmarks')['benchmarks']

    def get_benchmark_by_id(benchmark_id):
        for bname, benchmark in get_benchmarks().items():
            if benchmark_id == benchmark['id']:
                return bname, benchmark

    @dc.content
    def benchmark_sessions_list(**kwargs):
        return {
            'benchmarks': get_benchmarks()
        }

    @dc.content
    def benchmark_session(**kwargs):
        data = {}
        if bid := kwargs.get('benchmark_session_id', ''):
            bname, benchmark = get_benchmark_by_id(bid)
            data = benchmark_session_content(benchmark_session=json.dumps(benchmark))
            data['title'] = bname

        return data

    @dc.content
    def benchmark_usage_plot(**kwargs):
        series = None
        tseries = {'name': 'total', 'id': 'total', 'data': []}

        gpu_monitor_file = kwargs['file_path']
        with open(gpu_monitor_file) as f:
            gpu_usage = json.load(f)
            for row in gpu_usage['rows']:
                tsStr, rowData = row
                ts = Pretty.parse_datetime(tsStr.split('.')[0]).timestamp() * 1000
                if not series:
                    series = [{
                        'name': f"gpu-{g}",
                        'id': f"gpu-{g}",
                        'data': []
                    } for g in rowData]
                t = 0
                for g, values in rowData.items():
                    try:
                        u = float(values[0])
                    except:
                        u = 0
                    t += u
                    series[int(g)]['data'].append([ts, u])
                tseries['data'].append([ts, t])

        series.insert(0, tseries)

        return {'plot': {'series': series}}

    @dc.content
    def benchmark_session_content(**kwargs):
        benchmark = json.loads(kwargs['benchmark_session'])
        series = []
        categories = None

        def _elapsed(s):
            if s['START'] and s['END']:
                start = Pretty.parse_datetime(s['START'])
                end = Pretty.parse_datetime(s['END'])
                return (end - start).seconds / 60
            else:
                return 0

        for r in benchmark['runs']:
            series.append({
                'name': r['label'],
                'data': [_elapsed(s) for s in r['steps']]})
            categories = [s['JOBNAME'] for s in r['steps']]
            for s in r['steps']:
                gpu_monitor = s['JOBID'].replace('job', 'gpu_monitor_') + '.json'
                if os.path.exists(os.path.join(r.get('path', ''), gpu_monitor)):
                    s['gpu_monitor'] = gpu_monitor

        return {
            'benchmark': benchmark,
            'plot': {
                'series': series,
                'categories': categories
            }
        }




