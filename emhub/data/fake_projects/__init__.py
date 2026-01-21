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

"""
Module to load example/tests JSON projects to be displayed with the ProjectWidget.
"""

import os
import json

here = os.path.abspath(os.path.dirname(__file__))


projects = {
    43: {
        "id": 43,
        "name": "TestCryosparc3DClassification",
        "description": "TestCryosparc3DClassification1",
        "status": "active",
        "createdAt": "2025-09-13T15:29:00.670242+02:00",
        "updatedAt": None,
        "protocolsCount": 9,
        "diskUsage": "0.28 GB",
    },
}

project_files = ['workflow', 'protocols', 'forms', 'menu']


def load_json(projectId):
    if projectId not in projects:
        raise Exception(f"Unknown fake project: {projectId}")

    project_json = {}
    for key in project_files:
        jsonFile = os.path.join(here, f'{projectId}/{key}.json')

        if not os.path.exists(jsonFile):
            raise Exception(f"Missing JSON file: {jsonFile}")

        with open(jsonFile) as f:
            project_json[key] = json.load(f)

    return project_json

