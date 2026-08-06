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
St.Jude form updates (Aug 2026).

Applies dev/prod diffs from forms export (excluding ``config:hosts``, which
holds runtime worker timestamps and is intentionally skipped):

- ``config:resources`` — add multi-dashboard layout (CryoEM + COESCB)
- ``config:users`` — register ``staff-coescb`` extra role
- ``config:permissions`` — COESCB create/delete booking access
- ``config:queues`` — remove legacy per-layout ``queue`` keys in cryoem_LSF
- ``config:dewars`` — rename CryoEM dewar labels
- ``form:puck_gridbox`` — add storage_date, remove ``In Use`` status choice
"""

from emtools.utils import Pretty, Color
from emhub.client import open_client


DASHBOARDS = [
    {
        "id": "cryoem",
        "name": "CryoEM",
        "roles": [],
        "instruments": [
            "Krios01",
            "Krios02",
            "Arctica01",
            "Aquilos2",
            "TalosL120C",
            "CryoCapCell HPF",
        ],
        "status": [
            "Krios01",
            "Krios02",
            "Arctica01",
            "TalosL120C",
            "Aquilos2",
        ],
    },
    {
        "id": "coescb",
        "name": "COESCB",
        "roles": ["staff-coescb"],
        "instruments": ["Arctis", "Hydra"],
        "status": ["Arctis", "Hydra"],
    },
]

COESCB_ROLE = "staff-coescb"
COESCB_BOOKING_TYPES = ("create_booking", "delete_booking")

DEWAR_LABELS = {
    1: "CRYOEM 1",
    2: "CRYOEM 2",
}

PUCK_GRIDBOX_DEFINITION = {
    "title": "Gridbox Info",
    "sections": [
        {
            "label": "General",
            "params": [
                {"id": "sample", "label": "Sample"},
                {
                    "id": "status",
                    "label": "Status",
                    "enum": {
                        "choices": ["reserved", "shipping"],
                        "display": "radio",
                    },
                },
                {
                    "id": "storage_date",
                    "label": "Storage Date",
                    "type": "date",
                },
                {
                    "id": "grid_manufacturer",
                    "label": "Grid Manufacturer",
                    "enum": {
                        "choices": ["Quantifoil", "C-Flat", "Other"],
                        "display": "radio",
                    },
                },
                {
                    "id": "grid_material",
                    "label": "Grid Material",
                    "enum": {
                        "choices": ["Copper", "Gold", "Other"],
                        "display": "radio",
                    },
                },
                {"id": "film_material", "label": "Support Film"},
                {"id": "buffer", "label": "Buffer Conditions"},
                {"id": "vitrification", "label": "Vitrification Parameters"},
            ],
        },
        {
            "label": "Grid 1",
            "params": [
                {
                    "id": "grid1_comments",
                    "label": "Grid 1 Comments",
                    "type": "text",
                },
            ],
        },
        {
            "label": "Grid 2",
            "params": [
                {
                    "id": "grid2_comments",
                    "label": "Grid 2 Comments",
                    "type": "text",
                },
            ],
        },
        {
            "label": "Grid 3",
            "params": [
                {
                    "id": "grid3_comments",
                    "label": "Grid 3 Comments",
                    "type": "text",
                },
            ],
        },
        {
            "label": "Grid 4",
            "params": [
                {
                    "id": "grid4_comments",
                    "label": "Grid 4 Comments",
                    "type": "text",
                },
            ],
        },
    ],
}


def log(message):
    print(f"{Pretty.now()}: {message}", flush=True)


def _get_form(forms, name):
    form = next((f for f in forms if f['name'] == name), None)
    if form is None:
        raise Exception(f"Form {name} not found.")
    return form


def _save_form(dc, form):
    dc.request('update_form', jsonData={'attrs': form})


def update_resources_dashboards(dc, forms):
    log(Color.green(">>> Updating config:resources with dashboards..."))
    form = _get_form(forms, 'config:resources')
    form['definition']['dashboards'] = DASHBOARDS
    _save_form(dc, form)
    log(Color.bold("     - config:resources updated."))


def update_users_config(dc, forms):
    """Register staff-coescb as an assignable extra role in config:users."""
    log(Color.green(">>> Updating config:users with staff-coescb role..."))
    form = _get_form(forms, 'config:users')
    extra_roles = form['definition'].setdefault('extra_roles', [])
    if COESCB_ROLE not in extra_roles:
        extra_roles.append(COESCB_ROLE)
    _save_form(dc, form)
    log(Color.bold("     - config:users updated."))


def update_permissions_config(dc, forms):
    """Grant staff-coescb role access to COESCB booking types."""
    log(Color.green(">>> Updating config:permissions booking access..."))
    form = _get_form(forms, 'config:permissions')
    definition = form['definition']
    for booking_type in COESCB_BOOKING_TYPES:
        roles_by_resource = definition.setdefault(booking_type, {})
        roles_by_resource['coescb'] = [COESCB_ROLE]
    _save_form(dc, form)
    log(Color.bold("     - config:permissions updated."))


def update_queues_config(dc, forms):
    """Remove legacy per-layout queue keys from config:queues cryoem_LSF."""
    log(Color.green(">>> Updating config:queues cryoem_LSF layout..."))
    form = _get_form(forms, 'config:queues')
    cryoem_lsf = form['definition'].setdefault('cryoem_LSF', {})
    for entry in cryoem_lsf.get('layout', []):
        entry.pop('queue', None)
    _save_form(dc, form)
    log(Color.bold("     - config:queues updated."))


def update_dewars_config(dc, forms):
    """Rename CryoEM dewar labels in config:dewars."""
    log(Color.green(">>> Updating config:dewars labels..."))
    form = _get_form(forms, 'config:dewars')
    for dewar in form['definition'].get('dewars', []):
        if dewar['id'] in DEWAR_LABELS:
            dewar['label'] = DEWAR_LABELS[dewar['id']]
    _save_form(dc, form)
    log(Color.bold("     - config:dewars updated."))


def update_puck_gridbox_form(dc, forms):
    """Update form:puck_gridbox status choices and add storage_date field."""
    log(Color.green(">>> Updating form:puck_gridbox..."))
    form = _get_form(forms, 'form:puck_gridbox')
    form['definition'] = PUCK_GRIDBOX_DEFINITION
    _save_form(dc, form)
    log(Color.bold("     - form:puck_gridbox updated."))


def main():
    with open_client() as dc:
        forms = dc.request('get_forms', jsonData=None).json()
        update_resources_dashboards(dc, forms)
        update_users_config(dc, forms)
        update_permissions_config(dc, forms)
        update_queues_config(dc, forms)
        update_dewars_config(dc, forms)
        update_puck_gridbox_form(dc, forms)


if __name__ == '__main__':
    main()
