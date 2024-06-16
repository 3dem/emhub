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

from .processing_relion import RelionSessionData
from .processing_scipion import ScipionSessionData


def get_processing_project(project_path):
    """ Create a Processing Project instance from this path. """
    if not project_path or project_path.endswith('h5'):
        return None
    elif not os.path.exists(project_path):
        raise Exception(f"ERROR: can't load session data path: {project_path}")

    projectSqlite = os.path.join(project_path, 'project.sqlite')

    if os.path.exists(projectSqlite):
        return ScipionSessionData(project_path)

    # TODO: check if it is a Relion project
    return RelionSessionData(project_path)
