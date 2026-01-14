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
"""
Register content functions related to Sessions
"""
import os
import json

import datetime as dt
from emtools.utils import Pretty


def register_content(dc):

    @dc.content
    def raw_forms_list(**kwargs):
        dc.check_user_access('forms')

        def _is_config(f):
            """ Return true if this form seems like a config form.
            This is when there are not 'params' or 'sections'.
            """
            d = f.definition
            return not any(k in d for k in ['title', 'params', 'sections'])

        return {'forms': [
            {'id': f.id,
             'name': f.name,
             'definition': json.dumps(f.definition),
             'is_config': _is_config(f)
             } for f in dc.app.dm.get_forms()]}

    @dc.content
    def raw_entries_list(**kwargs):
        cond = ['%s="%s"' % (k, kwargs[k]) for k in ['id', 'type'] if k in kwargs]
        return {
            'entries': dc.app.dm.get_entries(condition=' and '.join(cond))
        }

    @dc.content
    def raw_booking_list(**kwargs):
        if 'user' in kwargs:
            return {'bookings': dc.app.dm.get_user_bookings(kwargs['user'])}

        return {'bookings': dc.app.dm.get_bookings()}

    @dc.content
    def raw_applications_list(**kwargs):
        return {'applications': dc.app.dm.get_visible_applications()}

    @dc.content
    def raw_templates_list(**kwargs):
        return {'templates': dc.app.dm.get_templates()}

    @dc.content
    def forms_list(**kwargs):
        return {'forms': dc.app.dm.get_forms()}

    @dc.content
    def raw_invoice_periods_list(**kwargs):
        return {'invoice_periods': dc.app.dm.get_invoice_periods()}

    @dc.content
    def raw_transactions_list(**kwargs):
        return {'transactions': dc.app.dm.get_transactions()}

    @dc.content
    def raw_user_issues(**kwargs):
        filterKey = kwargs.get('filter', 'noroles')
        args = {}
        if filterKey == 'noactive':
            args['status'] = 'all'
        users = dc.get_users_list(**args)['users']
        filterName = '_filter_%s' % filterKey

        def _filter_noapp(u):
            """ Users with No Active Application """
            return not u.is_manager and not u.project_codes

        def _filter_noroles(u):
            """ Users with No Roles """
            return not u.is_manager and not u.roles

        def _filter_noactive(u):
            """ Users No Active. """
            return u.status != 'active'

        _filter = locals()[filterName]

        new_users = [u for u in users if _filter(u)]

        return {'users': new_users,
                'filterDesc': _filter.__doc__
                }

    @dc.content
    def raw_pucks_list(**kwargs):
        kwargs['content_id'] = 'grids_cane'
        return dc.get(**kwargs)

    @dc.content
    def dynamic_form_modal(**kwargs):
        form_id = int(kwargs.get('form_id', 1))
        form = dc.app.dm.get_form_by(id=form_id)

        if form is None:
            raise Exception("Invalid form id: %s" % form_id)

        return dc.dynamic_form(form, **kwargs)

    @dc.content
    def logs(**kwargs):
        dm = dc.app.dm
        n = int(kwargs.get('n', 100))
        name = kwargs.get('name', '')
        all_logs = [log for log in dm.get_logs()]
        logs = all_logs[-n:]

        for log in logs:
            log.user = dm.get_user_by(id=log.user_id)

        return {'logs': logs}

    @dc.content
    def pages(**kwargs):
        page_id = kwargs['page_id']
        page_path = os.path.join(dc.app.config['PAGES'], '%s.md' % page_id)

        return {
            'page_id': page_id,
            'page': 'pages/%s.md' % page_id
        }

    @dc.content
    def workers(**kwargs):
        dm = dc.app.dm
        workers = {}
        now = dt.datetime.now()
        for k, v in dm.get_hosts().items():
            workers[k] = w = dict(v)
            active = False
            if updated := w.get('updated', ''):
                u = Pretty.parse_datetime(updated)
                td = now - u
                active = td < dt.timedelta(minutes=2)
                w['updated_elapsed'] = f"({Pretty.elapsed(u, now=now)})"
            if connected := w.get('connected', ''):
                c = Pretty.parse_datetime(connected)
                w['connected_elapsed'] = f"({Pretty.elapsed(c, now=now)})"
            w.update({
                'has_specs': bool(w.get('specs', '')),
                'active': active
            })

        all_tasks = dm.get_all_tasks()

        return {'workers': workers,
                'has_redis': dm.r is not None,
                'taskGroups': {h: t for h, t in all_tasks} if all_tasks else {},
                'now': Pretty.now()
                }

    @dc.content
    def workers_content(**kwargs):
        return workers()

    @dc.content
    def task_history(**kwargs):
        return {'task_events': dc.app.dm.get_task_history(kwargs['task_id'])}

    @dc.content
    def session_log(**kwargs):
        session_id = int(kwargs['session_id'])
        log_id = f"log:session:{session_id}"
        data = log_events(log_id=log_id, **kwargs)
        data['session'] = dc.app.dm.get_session_by(id=session_id)
        return data

    @dc.content
    def log_events(**kwargs):
        log_id = kwargs['log_id']
        return {
            'log_id': log_id,
            'log_events': dc.app.dm.get_log_events(log_id),
            'title': f'Log {log_id}'
        }

    @dc.content
    def raw_test_page(**kwargs):
        return {}

    @dc.content
    def raw_projects_list(**kwargs):
        if 'status' not in kwargs:
            kwargs['status'] = None  # projects with any status
        if 'stats' not in kwargs:
            kwargs['stats'] = True
        data = dc.get_user_projects(dc.app.user, **kwargs)
        return data

    @dc.content
    def test_widget(**kwargs):
        return {}

    @dc.content
    def project_widget(**kwargs):
        return project_widget2(**kwargs)

    def get_fake_project(project_id):
        from emhub.tests.scipion_data import projectDetails, protocolDetail
        project_43 = projectDetails[43]
        project_43['protocolDetails'] = protocolDetail
        fake_projects = {
            43: project_43,
            871: {
                "id": 871,
                "name": "/Users/jdela80/work/data/TOMO/A100_subset64",
                "shortName": "A100_subset64",
                "createdAt": "2025-09-13 15:29:00.670242+02:00",
                "status": "active",
                "path": "/Users/jdela80/work/data/TOMO/A100_subset64",
                "protocols": {
                    "PROJECT": {
                        "id": "PROJECT",
                        "children": [
                            "External/job001"
                        ],
                        "parents": [],
                        "label": "PROJECT",
                        "status": "",
                        "parameter": [],
                        "inputs": [],
                        "outputs": [],
                        "cpuTime": "",
                        "elapsedTime": "",
                        "isInteractive": False,
                        "numberOfSteps": 0,
                        "stepsDone": 0
                    },
                    "External/job001": {
                        "id": "External/job001",
                        "label": "emw-warp-mctf",
                        "parents": [
                            "PROJECT"
                        ],
                        "children": [
                            "External/job002"
                        ],
                        "inputs": [],
                        "outputs": [],
                        "status": "finished",
                        "type": "emw-warp-mctf",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job002": {
                        "id": "External/job002",
                        "label": "warp aretomo2",
                        "parents": [
                            "External/job001"
                        ],
                        "children": [
                            "External/job003"
                        ],
                        "inputs": [],
                        "outputs": [],
                        "status": "finished",
                        "type": "emw-warp-aretomo",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job003": {
                        "id": "External/job003",
                        "label": "emw-warp-ctfrec",
                        "parents": [
                            "External/job002"
                        ],
                        "children": [
                            "External/job004",
                            "External/job005"
                        ],
                        "inputs": [],
                        "outputs": [],
                        "status": "finished",
                        "type": "emw-warp-ctfrec",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job004": {
                        "id": "External/job004",
                        "label": "emw-pytom",
                        "parents": [
                            "External/job003"
                        ],
                        "children": [],
                        "inputs": [],
                        "outputs": [],
                        "status": "aborted",
                        "type": "emw-pytom",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job005": {
                        "id": "External/job005",
                        "label": "emw-slabify",
                        "parents": [
                            "External/job003"
                        ],
                        "children": [],
                        "inputs": [],
                        "outputs": [],
                        "status": "failed",
                        "type": "emw-slabify",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    }
                }
},
            878: {
                "id": 878,
                "name": "/Volumes/CoESCB/home/common/Tomo_Workshop_Nov_2025/tests/EmwrapProject",
                "shortName": "EmwrapProject",
                "createdAt": "2025-09-13 15:29:00.670242+02:00",
                "status": "active",
                "path": "/Volumes/CoESCB/home/common/Tomo_Workshop_Nov_2025/tests/EmwrapProject",
                "protocols": {
                    "PROJECT": {
                        "id": "PROJECT",
                        "children": [
                            "External/job019",
                            "External/job024",
                            "External/job037"
                        ],
                        "parents": [],
                        "label": "PROJECT",
                        "status": "",
                        "parameter": [],
                        "inputs": [],
                        "outputs": [],
                        "cpuTime": "",
                        "elapsedTime": "",
                        "isInteractive": False,
                        "numberOfSteps": 0,
                        "stepsDone": 0
                    },
                    "External/job019": {
                        "id": "External/job019",
                        "label": "emw-import-ts",
                        "parents": [
                            "PROJECT"
                        ],
                        "children": [
                            "External/job020"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series.star",
                                    "_objValue": "External/job019/tilt_series.star",
                                    "_parentId": "External/job019"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-import-ts",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job020": {
                        "id": "External/job020",
                        "label": "emw-warp-mctf",
                        "parents": [
                            "External/job019"
                        ],
                        "children": [
                            "External/job022"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series_ctf.star",
                                    "_objValue": "External/job020/tilt_series_ctf.star",
                                    "_parentId": "External/job020"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-warp-mctf",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job022": {
                        "id": "External/job022",
                        "label": "emw-warp-aretomo",
                        "parents": [
                            "External/job020"
                        ],
                        "children": [
                            "External/job023"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series_aln.star",
                                    "_objValue": "External/job022/tilt_series_aln.star",
                                    "_parentId": "External/job022"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-warp-aretomo",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job023": {
                        "id": "External/job023",
                        "label": "emw-warp-ctfrec",
                        "parents": [
                            "External/job022"
                        ],
                        "children": [],
                        "inputs": [],
                        "outputs": [],
                        "status": "finished",
                        "type": "emw-warp-ctfrec",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job024": {
                        "id": "External/job024",
                        "label": "emw-import-ts",
                        "parents": [
                            "PROJECT"
                        ],
                        "children": [
                            "External/job025"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series.star",
                                    "_objValue": "External/job024/tilt_series.star",
                                    "_parentId": "External/job024"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-import-ts",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job025": {
                        "id": "External/job025",
                        "label": "emw-warp-mctf",
                        "parents": [
                            "External/job024"
                        ],
                        "children": [
                            "External/job027"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series_ctf.star",
                                    "_objValue": "External/job025/tilt_series_ctf.star",
                                    "_parentId": "External/job025"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-warp-mctf",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job027": {
                        "id": "External/job027",
                        "label": "emw-warp-aretomo",
                        "parents": [
                            "External/job025"
                        ],
                        "children": [
                            "External/job028",
                            "External/job029"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series_aln.star",
                                    "_objValue": "External/job027/tilt_series_aln.star",
                                    "_parentId": "External/job027"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-warp-aretomo",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job028": {
                        "id": "External/job028",
                        "label": "emw-warp-ctfrec",
                        "parents": [
                            "External/job027"
                        ],
                        "children": [],
                        "inputs": [],
                        "outputs": [],
                        "status": "finished",
                        "type": "emw-warp-ctfrec",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job029": {
                        "id": "External/job029",
                        "label": "emw-warp-ctfrec",
                        "parents": [
                            "External/job027"
                        ],
                        "children": [
                            "External/job034",
                            "External/job035"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series_aln.star",
                                    "_objValue": "External/job029/tilt_series_aln.star",
                                    "_parentId": "External/job029"
                                }
                            },
                            {
                                "output2": {
                                    "_class": "File",
                                    "info": "tomograms.star",
                                    "_objValue": "External/job029/tomograms.star",
                                    "_parentId": "External/job029"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-warp-ctfrec",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job034": {
                        "id": "External/job034",
                        "label": "emw-pytom",
                        "parents": [
                            "External/job029"
                        ],
                        "children": [],
                        "inputs": [],
                        "outputs": [],
                        "status": "finished",
                        "type": "emw-pytom",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job035": {
                        "id": "External/job035",
                        "label": "emw-pytom",
                        "parents": [
                            "External/job029"
                        ],
                        "children": [
                            "External/job036"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tomograms_coords.star",
                                    "_objValue": "External/job035/tomograms_coords.star",
                                    "_parentId": "External/job035"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-pytom",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job036": {
                        "id": "External/job036",
                        "label": "emw-warp-mctf",
                        "parents": [
                            "External/job035"
                        ],
                        "children": [],
                        "inputs": [],
                        "outputs": [],
                        "status": "Saved",
                        "type": "emw-warp-mctf",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job037": {
                        "id": "External/job037",
                        "label": "emw-import-ts",
                        "parents": [
                            "PROJECT"
                        ],
                        "children": [
                            "External/job038",
                            "External/job049"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series.star",
                                    "_objValue": "External/job037/tilt_series.star",
                                    "_parentId": "External/job037"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-import-ts",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job038": {
                        "id": "External/job038",
                        "label": "emw-warp-mctf",
                        "parents": [
                            "External/job037"
                        ],
                        "children": [
                            "External/job039"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series_ctf.star",
                                    "_objValue": "External/job038/tilt_series_ctf.star",
                                    "_parentId": "External/job038"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-warp-mctf",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job039": {
                        "id": "External/job039",
                        "label": "emw-warp-aretomo",
                        "parents": [
                            "External/job038"
                        ],
                        "children": [
                            "External/job040"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series_aln.star",
                                    "_objValue": "External/job039/tilt_series_aln.star",
                                    "_parentId": "External/job039"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-warp-aretomo",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job040": {
                        "id": "External/job040",
                        "label": "emw-warp-ctfrec",
                        "parents": [
                            "External/job039"
                        ],
                        "children": [
                            "External/job041"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tomograms.star",
                                    "_objValue": "External/job040/tomograms.star",
                                    "_parentId": "External/job040"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-warp-ctfrec",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job041": {
                        "id": "External/job041",
                        "label": "emw-pytom",
                        "parents": [
                            "External/job040"
                        ],
                        "children": [
                            "External/job042",
                            "External/job047",
                            "External/job048"
                        ],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tomograms_coords.star",
                                    "_objValue": "External/job041/tomograms_coords.star",
                                    "_parentId": "External/job041"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-pytom",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job042": {
                        "id": "External/job042",
                        "label": "emw-warp-mctf",
                        "parents": [
                            "External/job041"
                        ],
                        "children": [],
                        "inputs": [],
                        "outputs": [],
                        "status": "Saved",
                        "type": "emw-warp-mctf",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job047": {
                        "id": "External/job047",
                        "label": "emw-warp-export_particles",
                        "parents": [
                            "External/job041"
                        ],
                        "children": [],
                        "inputs": [],
                        "outputs": [],
                        "status": "finished",
                        "type": "emw-warp-export_particles",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job048": {
                        "id": "External/job048",
                        "label": "emw-warp-export_particles",
                        "parents": [
                            "External/job041"
                        ],
                        "children": [],
                        "inputs": [],
                        "outputs": [],
                        "status": "finished",
                        "type": "emw-warp-export_particles",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    },
                    "External/job049": {
                        "id": "External/job049",
                        "label": "emw-warp-mctf",
                        "parents": [
                            "External/job037"
                        ],
                        "children": [],
                        "inputs": [],
                        "outputs": [
                            {
                                "output1": {
                                    "_class": "File",
                                    "info": "tilt_series_ctf.star",
                                    "_objValue": "External/job049/tilt_series_ctf.star",
                                    "_parentId": "External/job049"
                                }
                            }
                        ],
                        "status": "finished",
                        "type": "emw-warp-mctf",
                        "cpuTime": "0",
                        "elapsedTime": "0",
                        "isInteractive": False,
                        "numberOfSteps": 1,
                        "stepsDone": 1
                    }
                }
            }
}

        return fake_projects.get(project_id, None)

    def get_protocols(workflow):
        from emhub.data.processing import RelionRun

        root = {
            "id": "PROJECT",
            "children": [],
            "parents": [],
            "label": "",
            "status": "",
            "type": "PROJECT",
            "parameter": [],
            "inputs": [],
            "outputs": [],
            "cpuTime": "",
            "elapsedTime": "",
            "isInteractive": False,
            "numberOfSteps": 0,
            "stepsDone": 0,
        }
        protocols = {
            "PROJECT": root
        }
        status_map = {
            'Succeeded': 'finished',
            'Running': 'running',
            'Aborted': 'aborted',
            'Failed': 'failed'
        }

        for job in workflow.jobs():
            parents = [i.parent.id for i in job.inputs]
            children = []
            outputs = []
            for i, o in enumerate(job.outputs):
                outputs.append({
                    f"output{i+1}": {
                        "_class": "File",
                        "info": os.path.basename(o.id),
                        "_objValue": o.id,
                        "_parentId": job.id,
                    }
                })
                for c in o.childs:
                    children.append(c.id)

            prot = {
                'id': job.id,
                'label': RelionRun.jobAlias(job) or '',
                'parents': parents,
                'children': children,
                'inputs': [],
                'outputs': outputs,
                'status': status_map.get(job['status'], job['status']),
                'type': job['jobtype'],
                "cpuTime": "0",
                "elapsedTime": "0",
                "isInteractive": False,
                "numberOfSteps": 1,
                "stepsDone": 1,
            }

            if not parents:
                prot['parents'].append(root['id'])
                root['children'].append(job.id)

            protocols[job.id] = prot

        return protocols

    @dc.content
    def project_widget2(**kwargs):
        data = {}
        if fake_id := kwargs.get('fake_id', None):
            project_id = int(fake_id)
            project_details = get_fake_project(project_id)
            if project_details is None:
                raise Exception(f"Fake project id: {project_id} not found.")
        else:
            project_id = int(kwargs['entry_id'])
            entry = dc.app.dm.get_entry_by(id=project_id)
            if entry is None:
                raise Exception(f"Unexisting tomo project with id: {project_id}")
            project_path = entry.extra['data'].get('processing_path', '')
            data = dc.get_data('processing_content', **kwargs)
            pp = data['processing_project']
            protocols = get_protocols(pp.workflow)

            project_details = {
                'id': project_id,
                "name": project_path,
                "shortName": os.path.basename(project_path),
                "createdAt": "2025-09-13 15:29:00.670242+02:00",
                "status": "active",
                "path": project_path,
                'protocols': protocols
            }
        data.update({
            'project_id': project_id,
            'project_details': project_details,
            'project_ids': [43, 871, 878]
        })
        with open(f'project_{project_id}.json', 'w') as f:
            json.dump(project_details, f, indent=4)

        return data

    @dc.content
    def project_flowchart(**kwargs):
        data = project_widget2(**kwargs)
        # Convert project_details into a flowchart workflow
        workflow = []
        for jobId, job in data['project_details']['protocols'].items():
            workflow.append({
                'id': jobId,
                'label': job['label'],
                'links': job['children'],
                'status': job['status'],
                'type': job.get('type', '')
            })
        data['workflow'] = workflow
        return data

