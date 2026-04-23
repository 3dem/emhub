#!/usr/bin/env python
# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 2 of the License, or
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
Script to update forms for the new booking rules and Tomo processing on April 2026.
"""

import argparse
import os
import sys
import json

from emtools.utils import Pretty, Color
from emhub.client import open_client


RESOURCES_CONFIG = """
{
    "currency": "$", 
    "slots": {
        "Krios01": [[["09:00", "23:59"]], [["09:00", "23:59"]], [["09:00", "23:59"]], [["09:00", "23:59"]], [["09:00", "23:59"]], [["09:00", "23:59"]], [["09:00", "23:59"]]], 
        "Krios02": [], 
        "Arctica01": [[["10:00", "17:00"], ["17:30", "23:59"]], [["10:00", "17:00"], ["17:30", "23:59"]], [["10:00", "17:00"], ["17:30", "23:59"]], [["10:00", "17:00"], ["17:30", "23:59"]], [["10:00", "17:00"], ["17:30", "23:59"]], [["10:00", "23:59"]], [["10:00", "23:59"]]]
    }, 
    "status": ["Krios01", "Krios02", "Arctica01", "Aquilos2"], 
    "independent": {"Krios01": "weekends", "Arctica01": "weekends", "TalosL120C": "anyday", "Aquilos2": "anyday"}
}
"""

CONFIG_PERMISSIONS = """{
"create_booking": {
    "microscope": ["manager", "user"], "prep": ["user"], "talos": ["user"], "byslot": ["user"], "aquilos": ["user"]}, "delete_booking": {"microscope": ["manager", "admin"], "prep": ["user"], "talos": ["user"], "arctica": ["manager", "admin", "user"], "aquilos": ["user"]}, "create_session": ["manager", "admin"], "content": {"usage_report": ["manager", "head"], "raw": ["admin"]}, "projects": {"can_create": "all", "view_options": [{"key": "mine", "label": "My Projects"}, {"key": "lab", "label": "Lab's Projects"}, {"key": "all", "label": "All Projects"}]}
}
"""

CONFIG_BOOKIGNS = """
{"display": {"show_operator": true, "show_application": false, "show_experiment": "embedded"}, "local_tag": "stjude", "experiment_forms": {"Krios01": "experiment_simple", "Krios02": "experiment_simple"}}
"""

MICROSCOPE_ACCESS = """
{
    "title": "Microscope Request",
    "sections": [
        {
            "label": "General",
            "params": [
                {
                    "id": "session_type",
                    "label": "Session Type",
                    "default": "SPA",
                    "enum": {
                        "choices": [
                            "SPA",
                            "Tomography"
                        ]
                    }
                },
                {
                    "id": "bsl2",
                    "label": "Is Bio-Safety Level 2?",
                    "default": false,
                    "type": "bool"
                },
                {
                    "id": "microscope_id",
                    "label": "Select Microscope",
                    "type": "custom",
                    "template": "param_select_microscopes.html"
                },
                {
                    "id": "suggested_date",
                    "label": "Suggested Date",
                    "type": "date"
                },
                {
                    "id": "days",
                    "label": "Requested days",
                    "default": "default",
                    "enum": {
                        "choices": [
                            "default",
                            "1",
                            "2"
                        ]
                    }
                },
                {
                    "id": "days_label",
                    "label": "",
                    "default": "By default, request is two days for Krios, and one day for Arctica ",
                    "type": "label"
                },
                {
                    "id": "general_comments",
                    "label": "Comments",
                    "type": "text"
                }
            ]
        },
        {
            "label": "Sample",
            "params": [
                {
                    "id": "sample_name",
                    "label": "Sample Name/Identifier"
                },
                {
                    "id": "components",
                    "label": "Components"
                },
                {
                    "id": "weight",
                    "label": "Molecular Weight (kDa)"
                },
                {
                    "id": "preparation_date",
                    "label": "Sample preparation date",
                    "type": "date"
                },
                {
                    "id": "storage_conditions",
                    "label": "Storage conditions"
                },
                {
                    "id": "concentration",
                    "label": "Concentration (µM)"
                },
                {
                    "id": "concentration_measurement",
                    "label": "Method of measuring concentration"
                },
                {
                    "id": "volume",
                    "label": "Sample volume (µL)"
                },
                {
                    "id": "buffer",
                    "label": "Buffer composition"
                }
            ]
        },
        {
            "label": "Biophysics (for Talos)",
            "params": [
                {
                    "id": "biophysics_conditions",
                    "label": "Conditions",
                    "type": "text",
                    "default": "Did you use fresh/stored/frozen-thawed samples for biophysical experiments?\\nHave you performed Mass-spectrometry to confirm the identity of the sample?\\nHas the sample been cross-linked? Which cross-linking agent was used?"
                },
                {
                    "id": "biophysics_images",
                    "label": "Images Table",
                    "type": "table",
                    "columns": [
                        {
                            "id": "image_desc",
                            "label": "Image Description"
                        },
                        {
                            "id": "image_file",
                            "label": "Image File",
                            "type": "file_image"
                        }
                    ],
                    "min_rows": 4,
                    "default": [
                        {
                            "image_desc": "SDS-PAGE with coomassie stain"
                        },
                        {
                            "image_desc": "Gel Filtration profile"
                        },
                        {
                            "image_desc": "Mass Photometry profile"
                        }
                    ]
                }
            ]
        },
        {
            "label": "Support for Screening",
            "params": [
                {
                    "id": "negstain_conditions",
                    "label": "Conditions",
                    "type": "text",
                    "default": "Has the sample been tested for (i) concentration (ii) freeze/thaw, and/or (iii) ?"
                },
                {
                    "id": "negstain_images",
                    "label": "Images Table",
                    "type": "table",
                    "columns": [
                        {
                            "id": "image_desc",
                            "label": "Image Description"
                        },
                        {
                            "id": "image_file",
                            "label": "Image File",
                            "type": "file_image"
                        }
                    ],
                    "min_rows": 4,
                    "default": [
                        {
                            "image_desc": "Micrograph 1 (High concentration)"
                        },
                        {
                            "image_desc": "Micrograph 2 (Low concentration)"
                        },
                        {
                            "image_desc": "Negative stain 2D classes"
                        },
                        {
                            "image_desc": "3D Volume"
                        }
                    ]
                }
            ]
        },
        {
            "label": "Support for Krios Access",
            "params": [
                {
                    "id": "cryoem_conditions",
                    "label": "Conditions",
                    "type": "text",
                    "default": "Grid type and freezing parameters used for generating cryoEM grids:\\nNumber of images to generate C2D averages and average number of particles per image:\\n"
                },
                {
                    "id": "cryoem_images",
                    "label": "Images Table",
                    "type": "table",
                    "columns": [
                        {
                            "id": "image_desc",
                            "label": "Image Description"
                        },
                        {
                            "id": "image_file",
                            "label": "Image File",
                            "type": "file_image"
                        }
                    ],
                    "min_rows": 4,
                    "default": [
                        {
                            "image_desc": "Cryo Micrograph 1 (High defocus)"
                        },
                        {
                            "image_desc": "Cryo Micrograph 2 (Low defocus)"
                        },
                        {
                            "image_desc": "2D Classes"
                        },
                        {
                            "image_desc": "3D Volume"
                        }
                    ]
                }
            ]
        }
    ],
    "config": {
        "show_title": false,
        "show_desc": false,
        "request_resources": {
            "Krios02": {
                "days": 2
            }
        },
        "validate_func": "validate_access_microscopes"
    },
    "content": [
        {
            "func": "access_microscopes"
        }
    ]
}
"""

FORM_EXPERIMENT_SIMPLE = """
{"title": "Experiment", "params": [{"id": "session_type", "label": "Session Type", "default": "SPA", "enum": {"choices": ["SPA", "Tomography"]}}, {"id": "bsl2", "label": "Bio-Safety Level 2", "default": false, "type": "bool"}]}
"""

FORM_LOGBOOK_ENTRY = """
{"title": "Logbook Microscope", "sections": [{"label": "CryoEM Characterization", "params": [{"id": "type", "label": "Entry Type", "enum": {"choices": ["low", "medium", "high"], "display": "combo"}}, {"id": "labels", "label": "Labels"}, {"id": "images", "label": "Entry Images", "type": "table", "columns": [{"id": "image_desc", "label": "Image Description"}, {"id": "image_file", "label": "Image File", "type": "file_image"}], "min_rows": 2}]}]}
"""

def log(message):
    print(f"{Pretty.now()}: {message}", flush=True)


def update_forms():
    log(Color.green(">>> Updating forms..."))
    with open_client() as dc:

        def _update_form(form, fname, jsonStr):
            log(Color.bold(f"     - Updating {fname}..."))               
            #form['definition'] = json.loads('{"currency": "$", "slots": {"Krios01": [[["09:00", "23:59"]], [["09:00", "23:59"]], [["09:00", "23:59"]], [["09:00", "23:59"]], [["09:00", "23:59"]], [["09:00", "23:59"]], [["09:00", "23:59"]]], "Krios02": [], "Arctica01": [[["10:00", "17:00"], ["17:30", "23:59"]], [["10:00", "17:00"], ["17:30", "23:59"]], [["10:00", "17:00"], ["17:30", "23:59"]], [["10:00", "17:00"], ["17:30", "23:59"]], [["10:00", "17:00"], ["17:30", "23:59"]], [["10:00", "23:59"]], [["10:00", "23:59"]]]}}')
            form['definition'] = json.loads(jsonStr)
            dc.request('update_form', jsonData={'attrs': form})

        forms = dc.request('get_forms', jsonData=None).json()
        
        for form in forms:
            fname = form['name']
            if fname == 'config:resources': 
                _update_form(form, fname, RESOURCES_CONFIG)
            elif fname == 'config:permissions':
                _update_form(form, fname, CONFIG_PERMISSIONS)
            elif fname == 'entry_form:access_microscopes':
                _update_form(form, fname, MICROSCOPE_ACCESS)
            elif fname == 'config:bookings':
                _update_form(form, fname, CONFIG_BOOKIGNS)

        for name, defStr in [('experiment_simple', FORM_EXPERIMENT_SIMPLE), ('entry_form:logbook_microscope', FORM_LOGBOOK_ENTRY)]:
            formData = {
                'name': name,
                'definition': json.loads(defStr)
            }
            form = dc.request('create_form', jsonData={'attrs': formData}).json()
            print(f">>> Created new {name}")

def update_users():
    """Set pi_id from 76 to 280 for every user currently under PI 76."""
    old_pi, new_pi = 76, 280
    log(Color.green(f">>> Updating users (pi_id {old_pi} -> {new_pi})..."))
    with open_client() as dc:
        users = {u['id']: u for u in dc.request('get_users', jsonData={}).json()}
        to_update = [u for u in users.values() if u.get('pi_id') == old_pi]
        to_update.append(users[76])
        for u in to_update:
            log(Color.warn(f"     - user id={u['id']} {u.get('name', '')!r}: pi_id {old_pi} -> {new_pi}"))
            u['pi_id'] = new_pi
            dc.request('update_user', jsonData={'attrs': u})
        log(f"     Done. Updated {len(to_update)} user(s).")


def main():
    update_forms()
    update_users()



if __name__ == '__main__':
    main()





