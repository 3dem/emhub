# **************************************************************************
# *
# * Authors:     J.M. de la Rosa Trevin (delarosatrevin@gmail.com)
# *
# * Helpers for editing EMwrap workflow template JSON files with the project widget.
# *
# **************************************************************************

import copy
import os
import re

from emwrap.base import ProcessingConfig

from emhub.data.processing.processing_relion.project import RelionSessionData

_JOB_ID_RE = re.compile(r'^(?P<folder>[^/]+)/job(?P<index>\d+)$', re.IGNORECASE)


def get_job_form_definition(job_type, job_values=None):
    """Build a dynamic form definition without a processing project on disk."""
    return RelionSessionData.get_form_definition(
        RelionSessionData.__new__(RelionSessionData),
        job_type,
        jobValues=job_values,
    )


def _param_references_job(param_value, job_id):
    """Return True when a param value points at a job folder or its outputs."""
    if not isinstance(param_value, str):
        return False
    return param_value == job_id or param_value.startswith(f'{job_id}/')


def _build_job_graph(jobs):
    """Infer parent/child links from parameter references between job ids."""
    job_dict = {}
    for entry in jobs:
        job_id = entry['jobid']
        job_dict[job_id] = {
            'entry': entry,
            'parents': set(),
            'children': set(),
        }

    for job_id, job_info in job_dict.items():
        params = job_info['entry'].get('params') or {}
        for value in params.values():
            if not isinstance(value, str):
                continue
            for other_id in job_dict:
                if other_id != job_id and _param_references_job(value, other_id):
                    job_info['parents'].add(other_id)
                    job_dict[other_id]['children'].add(job_id)

    return job_dict


def _next_job_id(jobs, folder='External'):
    max_index = 0
    for entry in jobs:
        match = _JOB_ID_RE.match(entry.get('jobid', ''))
        if match:
            max_index = max(max_index, int(match.group('index')))
    return f'{folder}/job{max_index + 1:03d}'


def _protocol_template(job_id, job_type, parents, children, label=None):
    return {
        'id': job_id,
        'label': label or job_type,
        'parents': list(parents),
        'children': list(children),
        'inputs': [],
        'outputs': [],
        'status': 'saved',
        'type': job_type,
        'parameter': [],
        'cpuTime': '0',
        'elapsedTime': '0',
        'isInteractive': False,
        'numberOfSteps': 1,
        'stepsDone': 0,
        'tags': [],
    }


def jobs_to_protocols(jobs):
    """Convert workflow file jobs to the structure expected by the project widget."""
    graph = _build_job_graph(jobs)
    root = _protocol_template('PROJECT', 'PROJECT', [], [], label='')
    protocols = {'PROJECT': root}

    for job_id, job_info in graph.items():
        entry = job_info['entry']
        parents = list(job_info['parents'])
        children = list(job_info['children'])
        if not parents:
            parents = ['PROJECT']
            root['children'].append(job_id)

        protocols[job_id] = _protocol_template(
            job_id,
            entry['jobtype'],
            parents,
            children,
            label=entry['jobtype'],
        )

    return protocols


class WorkflowEditor:
    """Read and update a single EMwrap workflow template JSON file."""

    def __init__(self, workflow_id, jobs=None):
        self.workflow_id = workflow_id
        self.workflow_path = ProcessingConfig.get_workflow_file(workflow_id)
        self._workflow_def = None
        self.jobs = copy.deepcopy(jobs) if jobs is not None else None

    def load(self):
        self._workflow_def = ProcessingConfig.get_workflow(self.workflow_id)
        if self.jobs is None:
            self.jobs = copy.deepcopy(self._workflow_def.get('jobs', []))
        return self._workflow_def

    @property
    def workflow_def(self):
        if self._workflow_def is None:
            self.load()
        return self._workflow_def

    def _ensure_jobs(self):
        if self.jobs is None:
            self.load()

    def _find_job(self, job_id):
        self._ensure_jobs()
        job_id = str(job_id)
        for job in self.jobs:
            if str(job['jobid']) == job_id:
                return job
        return None

    def _next_job_id(self, folder='External'):
        self._ensure_jobs()
        return _next_job_id(self.jobs, folder=folder)

    @staticmethod
    def _remap_param_value(value, parents, id_map):
        if not isinstance(value, str):
            return value
        for parent_id in sorted(parents, key=len, reverse=True):
            if _param_references_job(value, parent_id):
                if parent_id in id_map:
                    return value.replace(parent_id, id_map[parent_id], 1)
                return ''
        return value

    def _instanciate_job_entries(self, job_dict):
        """
        Create new job entries with incrementing ids and remapped dependencies.
        Mirrors ProjectManager._instanciateJobs.
        """
        self._ensure_jobs()

        for job_id, job_info in job_dict.items():
            for key, value in (job_info.get('params') or {}).items():
                for other_id in job_dict:
                    if other_id != job_id and _param_references_job(value, other_id):
                        job_info['parents'].add(other_id)
                        job_dict[other_id]['children'].add(job_id)

        remaining = set(job_dict.keys())
        id_map = {}

        while remaining:
            ready = [
                job_id for job_id in remaining
                if job_dict[job_id]['parents'].issubset(id_map)
            ]
            if not ready:
                raise Exception(
                    "Workflow job dependency cycle or missing parent references."
                )

            for job_id in ready:
                job_info = job_dict[job_id]
                folder = 'External'
                match = _JOB_ID_RE.match(job_id)
                if match:
                    folder = match.group('folder')

                new_id = self._next_job_id(folder)
                new_params = {
                    key: self._remap_param_value(value, job_info['parents'], id_map)
                    for key, value in job_info['params'].items()
                }
                entry = {
                    'jobid': new_id,
                    'jobtype': job_info['jobtype'],
                    'params': new_params,
                }
                self.jobs.append(entry)
                id_map[job_id] = new_id
                remaining.remove(job_id)

        return id_map

    def duplicate_jobs(self, job_ids):
        """Duplicate jobs preserving intra-selection dependencies."""
        self._ensure_jobs()
        job_dict = {}
        for raw_id in job_ids:
            entry = self._find_job(raw_id)
            if not entry:
                continue
            job_id = str(entry['jobid'])
            job_dict[job_id] = {
                'jobtype': entry['jobtype'],
                'params': copy.deepcopy(entry.get('params', {})),
                'parents': set(),
                'children': set(),
            }

        id_map = {}
        if job_dict:
            id_map = self._instanciate_job_entries(job_dict)

        duplicated = [
            {'sourceId': old_id, 'newId': new_id}
            for old_id, new_id in id_map.items()
        ]
        return jobs_to_protocols(self.jobs), duplicated

    def load_template(self, template_workflow_id):
        """Append jobs from another workflow template with new ids."""
        self._ensure_jobs()
        template = ProcessingConfig.get_workflow(template_workflow_id)
        job_dict = {
            str(entry['jobid']): {
                'jobtype': entry['jobtype'],
                'params': copy.deepcopy(entry.get('params', {})),
                'parents': set(),
                'children': set(),
            }
            for entry in template.get('jobs', [])
        }
        if job_dict:
            self._instanciate_job_entries(job_dict)
        return jobs_to_protocols(self.jobs)

    def get_widget_data(self):
        workflow_def = self.load()
        workflow_id = self.workflow_id
        title = workflow_def.get('title') or workflow_def.get('name', workflow_id)
        protocols = jobs_to_protocols(self.jobs)

        forms = {}
        for jobtype in ProcessingConfig.get_jobs():
            if ProcessingConfig.get_job_form(jobtype) is None:
                continue
            forms[jobtype] = get_job_form_definition(jobtype)

        templates = {}
        for wf in ProcessingConfig.get_workflows():
            template_id = wf['id']
            if template_id == workflow_id:
                continue
            template_def = ProcessingConfig.get_workflow(template_id)
            templates[template_id] = {
                'name': template_def.get('title') or template_def.get('name', template_id),
                'description': template_def.get('description', ''),
                'jobs': copy.deepcopy(template_def.get('jobs', [])),
            }

        project_details = {
            'id': workflow_id,
            'name': title,
            'shortName': os.path.basename(self.workflow_path),
            'createdAt': '',
            'status': 'template',
            'path': os.path.dirname(self.workflow_path),
            'protocols': protocols,
        }

        return {
            'workflow_id': workflow_id,
            'workflow_file': os.path.basename(self.workflow_path),
            'workflow_name': title,
            'workflow_description': workflow_def.get('description', ''),
            'workflow_jobs': copy.deepcopy(self.jobs),
            'forms': forms,
            'workflow_templates': templates,
            'project_id': workflow_id,
            'project_details': project_details,
            'project_entry_extra': {'tags': {'project': [], 'protocols': {}}},
            'get_project_args': {'workflow_id': workflow_id},
        }
