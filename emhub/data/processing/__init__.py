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


def _path_inside(path, base):
    base = base.rstrip(os.sep) or os.sep
    return path == base or path.startswith(base + os.sep)


def project_file_path(root, rel_path):
    """ Full path of a file referenced from a processing project: rel_path
    is relative to root (or absolute, e.g. in STAR files).

    The path comes from the browser, so it is checked to stay inside the
    project. The check is lexical, symlinks are not resolved, so the links
    of the project (e.g. 'data' to the session raw data folder) can be
    followed. A relative path can not go above root, and an absolute path
    must be inside root (or its real path) or inside the target of one of
    the top-level links of root (e.g. data -> /raw/session). Paths with
    '..' are rejected. Raise ValueError otherwise.
    """
    root = resolve_project_root(root)
    if not root:
        raise ValueError("Missing project root")
    rel_path = str(rel_path or '')
    # '..' is not allowed at all: after a link (e.g. data/..), the OS
    # resolves it from the link target, not lexically
    if '..' in rel_path.replace('\\', '/').split('/'):
        raise ValueError(f"Invalid path, '..' is not allowed: {rel_path}")
    full_path = os.path.normpath(os.path.join(root, rel_path))
    if _path_inside(full_path, root):
        return full_path

    if os.path.isabs(rel_path):
        bases = [os.path.realpath(root)]
        try:
            with os.scandir(root) as it:
                bases.extend(os.path.realpath(e.path) for e in it if e.is_symlink())
        except OSError:
            pass
        if any(_path_inside(full_path, b) for b in bases):
            return full_path

    raise ValueError(f"Invalid path, outside of the project: {rel_path}")


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

