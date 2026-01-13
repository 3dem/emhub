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
    def tomo_session(**kwargs):
        if tsId := kwargs.get('tomo_session_id', None):
            if tp := dc.app.dm.get_entry_by(id=tsId):
                tomo_session = {
                    'path': tp.extra['data']['processing_path'],
                    'tomograms_star': 'tomograms.star',
                }
                load_workflow = 'workflow' in kwargs
                data = {
                    'tomo_session': tomo_session,
                    'tomograms': [],  # To be loaded
                    'tomo_session_id': tsId,
                    'workflow': load_workflow
                }
                if load_workflow:
                    data.update(tomo_processing_content(entry_id=tsId, **kwargs))

                tsession = json.loads(kwargs.get('tomo_session', '{}'))
                if 'tomograms_star' in tsession:
                    tomo_session['tomograms_star'] = tsession['tomograms_star']
                data.update(tomo_session_content(tomo_session=json.dumps(tomo_session)))

                return data
            else:
                raise Exception(f"Can load tomography session: {tsId}")
        else:
            raise Exception("Expecting tomo_session_id as argument.")

    @dc.content
    def tomo_picking(**kwargs):
        return projects_list(**kwargs)

    @dc.content
    def tomo_sessions_list(**kwargs):
        return {
            'tomo_sessions': dc.app.dm.get_config('tomo_sessions')['sessions']
        }

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
            "pixel_size",
            "voltage",
            "spherical_aberration",
            "amplitude_contrast",
            "total_dose"
        ]

        for k in keys:
            v = data.get(k, '')
            if not v:
                raise Exception(f"Provide a value for '{k}', it can not be empty.")
            if k == 'processing_path':
                ppath = v
                if not os.path.exists(v):
                    raise Exception(f"Processing path '{v}' does not exist!")

        fm = FolderManager(ppath)
        if not fm.exists('default_pipeline.star'):
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
        for e in entries:
            pid = e['project_id']
            if pid in projects:
                pseudo_projects[pid].append(e)

        # If there are no current tomography entries,
        # let's create a default project
        if not pseudo_projects:
            defaultTomoProject = None
            for p in user_projects:
                if p.status == project_type:
                    defaultTomoProject = p
                    break

            if defaultTomoProject is None:
                defaultTomoProject = dm.create_project(
                    user_id=uid,
                    status=project_type,
                    user_can_edit=True,
                    is_confidential=False,
                    title=f"Default Project for {entry_type} entries",
                    description=""
                )
            pseudo_projects[defaultTomoProject.id] = []

        return pseudo_projects

    @dc.content
    def processing_tomo_list(**kwargs):
        kwargs['entry_type'] = 'tomo_processing'
        kwargs['project_type'] = 'processing_tomo'

        tomo_projects = dc.get_data('pseudo_projects', **kwargs)
        for entries in tomo_projects.values():
            for e in entries:
                data = e['extra']['data']
                e['title'] = e['title'] or os.path.basename(data.get('processing_path', ''))

        return {
            'tomo_projects': tomo_projects
        }

    @dc.content
    def processing_tomo(**kwargs):
        kwargs['content_id'] = 'project_form'
        return dc.get(**kwargs)

    @dc.content
    def tomo_processing_content(**kwargs):
        data = dc.get_data('processing_content', **kwargs)
        data['menu'] = ProcessingConfig.get_menu()
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




