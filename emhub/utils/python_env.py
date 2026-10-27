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
# *  e-mail address 'delarosatrevin@scilifelab.se'
# *
# **************************************************************************

""" Description of the Python environment (version and core libraries),
shown in the EMhub configuration page and reported by the workers when they
connect (see Worker._connect). It does not depend on Flask. """

import os
import sys
import platform
import importlib
import subprocess

CORE_LIBRARIES = ['emtools', 'emwrap', 'emhub']


def _get_git_info(path):
    """ Return 'branch @ commit' (plus tag and modified flag) for PATH if it
    is inside a git checkout (i.e. installed from sources), or None. """
    def _git(*args):
        try:
            r = subprocess.run(['git', '-C', path, *args], capture_output=True,
                               text=True, timeout=5)
            return r.stdout.strip() if r.returncode == 0 else None
        except (OSError, subprocess.SubprocessError):
            return None

    commit = _git('rev-parse', '--short', 'HEAD')
    if not commit:
        return None
    info = f"{_git('rev-parse', '--abbrev-ref', 'HEAD')} @ {commit}"
    if tag := _git('describe', '--tags', '--exact-match'):
        info += f" (tag {tag})"
    if _git('status', '--porcelain', '--untracked-files=no'):
        info += ", modified"
    return info


def _get_library_row(name):
    """ Row with the path, version and git info (when installed from
    sources) of one of the core libraries. """
    try:
        module = importlib.import_module(name)
    except Exception as e:
        return {'label': name, 'value': '', 'status': 'error',
                'details': f"Could not import: {e}"}
    path = os.path.dirname(module.__file__)
    details = [f"Version: {getattr(module, '__version__', 'unknown')}"]
    if git_info := _get_git_info(path):
        details.append(f"Git: {git_info}")
    return {'label': module.__name__, 'value': path, 'status': 'ok',
            'details': ' | '.join(details)}


def python_env_rows(instance_path=None):
    """ Return rows describing the Python environment running the server
    (or a worker), to quickly spot when it is not the expected one (e.g. an
    old conda env picked up from PATH). The EMHUB_INSTANCE row is only
    added for the server (instance_path given).
    """
    prefix = sys.prefix
    conda_prefix = os.environ.get('CONDA_PREFIX')
    if os.path.exists(os.path.join(prefix, 'conda-meta')):
        env_type = 'conda'
    elif prefix != sys.base_prefix:
        env_type = 'venv'
    else:
        env_type = 'system'

    def _row(label, value, status='ok', details=''):
        return {'label': label, 'value': value, 'status': status,
                'details': details}

    prefix_row = _row('Environment Prefix', prefix)
    if (conda_prefix and
            os.path.realpath(conda_prefix) != os.path.realpath(prefix)):
        prefix_row['status'] = 'warning'
        prefix_row['details'] = (f"Differs from the active CONDA_PREFIX "
                                 f"({conda_prefix}), Python likely comes "
                                 f"from another environment in PATH.")

    rows = [
        _row('Environment Type', env_type),
        _row('Environment Name', os.path.basename(prefix)),
        prefix_row,
        _row('Python Executable', sys.executable),
        _row('Python Version', platform.python_version()),
    ] + [_get_library_row(name) for name in CORE_LIBRARIES]

    if instance_path:
        env_instance = os.environ.get('EMHUB_INSTANCE', '')
        instance_row = _row('EMHUB_INSTANCE', env_instance or instance_path)
        if not env_instance:
            instance_row['status'] = 'warning'
            instance_row['details'] = 'Not set, showing the Flask instance path.'
        rows.append(instance_row)

    return rows
