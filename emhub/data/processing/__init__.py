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

from .base import SessionData
from .processing_relion import RelionSessionData, RelionRun
from .processing_scipion import ScipionSessionData


def resolve_processing_path(project_path):
    """Expand a leading ~ for filesystem access."""
    if project_path and project_path.startswith('~'):
        return os.path.expanduser(project_path)
    return project_path


def resolve_project_root(project_path):
    """Expand ~ and return absolute path for filesystem access."""
    if not project_path:
        return project_path
    return os.path.abspath(os.path.expanduser(project_path))


def get_processing_type(project_path):
    project_path = resolve_processing_path(project_path)
    if not os.path.exists(project_path):
        raise Exception(f"ERROR: can't load processing path: {project_path}")

    projectSqlite = os.path.join(project_path, 'project.sqlite')

    if os.path.exists(projectSqlite):
        return 'scipion'

    defaultPipeline = os.path.join(project_path, 'default_pipeline.star')

    if os.path.exists(defaultPipeline):
        return 'relion'

    return 'unknown'


def get_processing_project(project_path):
    """ Create a Processing Project instance from this path. """
    project_path = resolve_processing_path(project_path)
    typeMap = {
        'scipion': ScipionSessionData,
        'relion': RelionSessionData
    }
    processingType = get_processing_type(project_path)

    if ProcClass := typeMap.get(processingType, None):
        return ProcClass(project_path)

    return None

