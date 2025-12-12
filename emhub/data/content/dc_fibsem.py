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


def register_content(dc):
    # --------------------- FIBSEM related content ---------------------------
    @dc.content
    def fibsem_sessions_list(**kwargs):
        kwargs['entry_type'] = 'fibsem_session'
        fibsem_sessions = dc.get_data('pseudo_projects', **kwargs)
        for entries in fibsem_sessions.values():
            for e in entries:
                data = e['extra']['data']
                e['title'] = e['title'] or os.path.basename(data.get('path', ''))

        return {
            'fibsem_sessions': fibsem_sessions
        }
        return data

    def get_plots():
        plots = []
        plotsConfig = dc.app.dm.get_config('asv_plots')

        def _find_plots(prefix, plotDict):
            if 'PlotType' in plotDict:
                plots.append(prefix)
            else:
                for k, v in plotDict.items():
                    newPrefix = f"{prefix}.{k}" if prefix else k
                    _find_plots(newPrefix, v)

        _find_plots('', plotsConfig['ASVXMLMetadata'])
        return plots

    @dc.content
    def fibsem_session(**kwargs):
        if fsId := kwargs.get('fibsem_session_id', None):
            if tp := dc.app.dm.get_entry_by(id=fsId):
                p = validate_entry_fibsem_session(tp)
                jsonFile = 'EMHub_ASV/EMHub_ASV_AllData.json'
                jsonPath = os.path.join(p, jsonFile)
                if not os.path.exists(jsonPath):
                    Exception(f"Missing expected JSON file: {jsonPath}")
                with open(jsonPath) as f:
                    session_json = json.load(f)

                slices = []
                images = session_json['Sites'][0]['Steps'][0]['Images']
                for img in images:
                    slices.append({
                        'path': img['RelativeFilePath'],
                        'index': img['FilenameSliceIndex'],
                        'metadata': img['Metadata']['ASVXMLMetadata']
                    })
                slices.sort(key=lambda img: img['index'])

                return {
                    'fibsem_session': tp,
                    'fibsem_session_path': p,
                    'fibsem_session_id': fsId,
                    'json_file': jsonFile,
                    'session_json': session_json,
                    'slices': slices,
                    'plots': get_plots()
                }
            else:
                raise Exception(f"Can load FIBSEM session: {tsId}")
        else:
            raise Exception("Expecting fibsem_session_id as argument.")

    @dc.content
    def validate_entry_fibsem_session(entry):
        p = os.path.expanduser(entry.extra['data']['path'])

        if not os.path.exists(p):
            raise Exception(f"Session path '{p}' does not exist!")

        return p




