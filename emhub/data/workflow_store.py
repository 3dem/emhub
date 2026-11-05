# **************************************************************************
# *
# * Authors:     J.M. de la Rosa Trevin (delarosatrevin@gmail.com)
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# **************************************************************************
"""
Workflow templates (JSON files with a list of jobs) grouped in categories:

- builtin: shipped with emwrap (emwrap/config/workflows), read-only; its
           'internal' sub-folder (OTF and test workflows) is not offered.
- site:    the EMhub instance folder, <instance>/workflows.
- project: the processing project folder, <project>/.emhub/workflows.

A workflow is identified by its file name without the .json extension
inside the folder of its category.
"""

import os
import re
import json

BUILTIN = 'builtin'
SITE = 'site'
PROJECT = 'project'

CATEGORIES = (BUILTIN, SITE, PROJECT)
WRITABLE_CATEGORIES = (SITE, PROJECT)

_ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]*$')


def check_category(category, writable=False):
    category = category or BUILTIN
    valid = WRITABLE_CATEGORIES if writable else CATEGORIES
    if category not in valid:
        raise Exception(f"Invalid workflow category '{category}', "
                        f"expecting one of: {', '.join(valid)}")
    return category


def check_workflow_id(workflow_id):
    """ Return the workflow id (a file name without .json, no folders). """
    workflow_id = str(workflow_id or '').strip()
    if workflow_id.endswith('.json'):
        workflow_id = workflow_id[:-5]
    if not _ID_RE.match(workflow_id):
        raise Exception(f"Invalid workflow name '{workflow_id}': use letters, "
                        f"digits, '.', '_' or '-' (no folders)")
    return workflow_id


def workflow_path(folder, workflow_id):
    return os.path.join(folder, f'{check_workflow_id(workflow_id)}.json')


def read_workflow(folder, workflow_id):
    path = workflow_path(folder, workflow_id)
    if not os.path.exists(path):
        raise Exception(f"Workflow file not found: {path}")
    with open(path) as f:
        return json.load(f)


def list_workflows(folder, category):
    """ Return the descriptors of the workflows in the folder:
    id, file, title, description, category and the number of jobs. """
    if not folder or not os.path.isdir(folder):
        return []

    workflows = []
    for fn in sorted(f for f in os.listdir(folder) if f.endswith('.json')):
        workflow_id = fn[:-5]
        wf = {'id': workflow_id, 'file': fn, 'category': category,
              'title': workflow_id, 'description': ''}
        try:
            with open(os.path.join(folder, fn)) as f:
                data = json.load(f)
            wf['title'] = data.get('title') or data.get('name') or workflow_id
            wf['description'] = data.get('description', '')
            wf['jobs'] = len(data.get('jobs', []))
        except Exception as e:
            wf['parseError'] = str(e)
        workflows.append(wf)

    return workflows


def write_workflow(folder, workflow_id, workflow, overwrite=False):
    """ Write the workflow JSON in the folder (created if needed).
    Raise if the file exists and overwrite is False. """
    path = workflow_path(folder, workflow_id)
    if os.path.exists(path) and not overwrite:
        raise Exception(f"Workflow '{os.path.basename(path)}' already exists")
    os.makedirs(folder, exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(workflow, f, indent=4)
    os.replace(tmp, path)
    return path
