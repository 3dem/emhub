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
# **************************************************************************

"""
Add the 'sample' project entry (Sample Description: sample intake and
biosafety declaration). Once its status is 'Ready', the entry is locked
(see the 'lock' option in the form config): only managers can modify or
delete it.

It creates (or updates) the form 'entry_form:sample' (FORM_SAMPLE below)
and registers the 'sample' entry type in the
'config:projects' form (entries and entries_menu).

The server is taken from the usual EMHUB_SERVER_URL / EMHUB_USER /
EMHUB_PASSWORD environment variables (see emhub.client.open_client).
Use --dry-run to only print what would be changed.
"""

import json
import argparse

from emtools.utils import Pretty, Color
from emhub.client import open_client


ENTRY_TYPE = 'sample'
FORM_NAME = f'entry_form:{ENTRY_TYPE}'
ENTRY_CONFIG = {
    "label": "Sample Description",
    "group": 1,
    "iconClass": "fas fa-vial fa-inverse",
    "imageClass": "img--picture"
}
MENU_ITEM = [ENTRY_TYPE, "Sample Description"]

# Definition of the entry form (sample intake and biosafety declaration)
FORM_SAMPLE = """
{
    "title": "Sample Description",
    "config": {
        "show_title": false,
        "show_desc": false,
        "show_date": false,
        "lock": {"param": "status", "value": "Ready"}
    },
    "sections": [
        {
            "label": "General",
            "params": [
                {"id": "status", "label": "Status", "default": "In preparation",
                 "enum": {"display": "radio", "choices": ["In preparation", "Ready"]}},
                {"id": "status_note", "label": "", "type": "label", "layout": "wide",
                 "default": "In preparation: the sample information can still be edited and saved. Ready: the sample information is final and becomes permanent; it can no longer be modified or deleted (only the facility managers can do it)."},
                {
                    "id": "instruments", "label": "Requested Instruments and Workflows",
                    "type": "custom", "template": "param_checkboxes_columns.html",
                    "layout": "full", "columns": 3, "help": "Select all that apply",
                    "options": [
                        {"id": "inst_plunge_freezing", "label": "Plunge freezing / grid preparation"},
                        {"id": "inst_hpf", "label": "High-pressure freezing"},
                        {"id": "inst_negative_stain", "label": "Negative stain (Talos)"},
                        {"id": "inst_cryo_ultramicrotomy", "label": "Cryo-ultramicrotomy / sectioning"},
                        {"id": "inst_screening", "label": "Sample screening (Talos)"},
                        {"id": "inst_cryoem_spa", "label": "Cryo-EM single-particle (Krios)"},
                        {"id": "inst_cryoet", "label": "Cryo-ET (Krios)"},
                        {"id": "inst_clem", "label": "Cryo-fluorescence / CLEM (Cryo-FLM)"},
                        {"id": "inst_rt_tem", "label": "Room-temperature TEM"},
                        {"id": "inst_fib_milling", "label": "Cryo-FIB milling (Aquilos 2)"},
                        {"id": "inst_cryo_pfib", "label": "Cryo-PFIB (Hydra / Arctis)"},
                        {"id": "inst_volume_em", "label": "Volume EM / FIB-SEM (Hydra)"},
                        {"id": "inst_rt_sem", "label": "Room-temperature SEM / FIB-SEM"},
                        {"id": "inst_other", "label": "Other (specify below)"}
                    ]
                },
                {"id": "instruments_other", "label": "Instrument(s), if known / other"},
                {"id": "samples_number", "label": "No. of samples / grids", "type": "int"},
                {"id": "planned_session_date", "label": "Planned session date", "type": "date"}
            ]
        },
        {
            "label": "Sample",
            "params": [
                {
                    "id": "sample_type", "label": "Sample type",
                    "type": "custom", "template": "param_checkboxes_columns.html",
                    "layout": "full", "columns": 3, "help": "Select all that apply",
                    "options": [
                        {"id": "type_cell_line", "label": "Mammalian cell line"},
                        {"id": "type_primary_cells", "label": "Primary cells"},
                        {"id": "type_tissue", "label": "Tissue / biopsy"},
                        {"id": "type_organoid", "label": "Organoid"},
                        {"id": "type_clinical", "label": "Clinical specimen (patient-derived)"},
                        {"id": "type_biofluid", "label": "Biofluid (blood, serum, CSF, etc.)"},
                        {"id": "type_bacteria", "label": "Bacteria / archaea"},
                        {"id": "type_yeast", "label": "Yeast / fungi"},
                        {"id": "type_virus", "label": "Virus / viral particles"},
                        {"id": "type_protein", "label": "Purified protein / complex"},
                        {"id": "type_nanoparticle", "label": "Nanoparticle / lipid / synthetic"},
                        {"id": "type_other", "label": "Other (specify below)"}
                    ]
                },
                {"id": "sample_type_other", "label": "Other sample type"},
                {"id": "sample_source", "label": "Cell line / organism / tissue source"},
                {"id": "sample_description", "label": "Brief description of sample", "type": "text"},
                {
                    "id": "sample_state", "label": "Sample state at drop-off",
                    "type": "custom", "template": "param_checkboxes.html", "layout": "wide",
                    "options": [
                        {"id": "state_live", "label": "Live"},
                        {"id": "state_chemically_fixed", "label": "Chemically fixed"},
                        {"id": "state_inactivated", "label": "Inactivated"},
                        {"id": "state_plunge_frozen", "label": "Plunge-frozen on grids"},
                        {"id": "state_hpf", "label": "High-pressure frozen"},
                        {"id": "state_resin_embedded", "label": "Resin-embedded"},
                        {"id": "state_solution", "label": "In solution / pellet"},
                        {"id": "state_other", "label": "Other"}
                    ]
                },
                {"id": "fixatives", "label": "Fixatives / chemicals present",
                 "help": "e.g., glutaraldehyde, PFA, osmium tetroxide, uranyl acetate"},
                {
                    "id": "storage", "label": "Storage / transport condition",
                    "type": "custom", "template": "param_checkboxes.html", "layout": "wide",
                    "options": [
                        {"id": "storage_ln2", "label": "LN2 / dry shipper"},
                        {"id": "storage_minus80", "label": "−80 °C"},
                        {"id": "storage_4c", "label": "4 °C"},
                        {"id": "storage_rt", "label": "Room temperature"},
                        {"id": "storage_other", "label": "Other"}
                    ]
                }
            ]
        },
        {
            "label": "Biosafety",
            "params": [
                {"id": "biosafety_level", "label": "Biosafety level of the sample as handled in your lab", "layout": "wide",
                 "enum": {"display": "radio", "choices": [
                     "BSL-1", "BSL-2 (contact Center first)", "BSL-2 enhanced (contact Center first)",
                     "BSL-3 or higher (currently cannot be supported)"]}},
                {
                    "id": "hazards", "label": "Does the sample contain or potentially contain any of the following?",
                    "type": "custom", "template": "param_checkboxes_columns.html",
                    "layout": "full", "columns": 3, "help": "Select all that apply",
                    "options": [
                        {"id": "hz_human_derived", "label": "Human-derived material"},
                        {"id": "hz_primary_human", "label": "Primary human cells or tissue"},
                        {"id": "hz_clinical", "label": "Clinical / patient-derived specimen"},
                        {"id": "hz_infectious", "label": "Infectious or potentially infectious material"},
                        {"id": "hz_bloodborne", "label": "Bloodborne pathogens (HIV, HBV, HCV) or unscreened human material"},
                        {"id": "hz_viral_vectors", "label": "Viral vectors (lentivirus, AAV, adenovirus, etc.)"},
                        {"id": "hz_recombinant", "label": "Recombinant / genetically modified organisms or cells"},
                        {"id": "hz_pathogens", "label": "Pathogenic microorganisms"},
                        {"id": "hz_prions", "label": "Prions or prion-susceptible tissue"},
                        {"id": "hz_select_agents", "label": "Select agents or toxins"},
                        {"id": "hz_toxins", "label": "Other toxins or hazardous biological agents"},
                        {"id": "hz_chemicals", "label": "Hazardous chemicals or radioactive material"},
                        {"id": "hz_none", "label": "None of the above"}
                    ]
                },
                {"id": "hazards_description", "label": "If yes, describe agent(s) and risk group"},
                {"id": "replication_competent", "label": "Replication competent?",
                 "enum": {"display": "radio", "choices": ["Yes", "No", "Not applicable"]}},
                {"id": "fixed_before_arrival", "label": "Fixed / inactivated before arrival?",
                 "enum": {"display": "radio", "choices": ["Yes", "No", "Not applicable"]}},
                {"id": "inactivation_method", "label": "Fixation / inactivation method",
                 "help": "Agent, concentration, time, temperature, date"},
                {"id": "inactivation_verified", "label": "How was inactivation verified?", "layout": "wide",
                 "enum": {"display": "radio", "choices": [
                     "Validated protocol / SOP", "Viability or infectivity assay", "Not verified", "Not applicable"]}},
                {"id": "containment", "label": "Containment needed while in the facility",
                 "enum": {"display": "radio", "choices": ["BSL-1", "BSL-2", "Other"]}}
            ]
        },
        {
            "label": "Clinical",
            "params": [
                {"id": "clinical_note", "label": "", "type": "label", "layout": "full",
                 "default": "Complete this section if any human-derived material or clinical specimen is selected in Biosafety. Human material is handled with universal precautions regardless of screening results."},
                {
                    "id": "human_source", "label": "Source of material",
                    "type": "custom", "template": "param_checkboxes.html", "layout": "wide",
                    "options": [
                        {"id": "source_patient", "label": "Patient / clinical collection"},
                        {"id": "source_biobank", "label": "Biobank / repository"},
                        {"id": "source_vendor", "label": "Commercial vendor"},
                        {"id": "source_collaborator", "label": "Collaborator"},
                        {"id": "source_other", "label": "Other"}
                    ]
                },
                {"id": "irb_protocol", "label": "IRB protocol number / determination (if applicable)"},
                {"id": "consent", "label": "Consent covers research use and transfer to the Center?", "layout": "wide",
                 "enum": {"display": "radio", "choices": ["Yes", "No", "Waiver of consent", "Not applicable"]}},
                {"id": "mta_needed", "label": "Material transfer / data use agreement needed?", "layout": "wide",
                 "enum": {"display": "radio", "choices": ["Yes, in place", "Yes, pending", "No", "Not applicable"]}},
                {"id": "deidentified", "label": "Coded / de-identified (no direct identifiers)?",
                 "enum": {"display": "radio", "choices": ["Yes", "No"]}},
                {"id": "patient_identifiers", "label": "Do any labels or file names contain patient identifiers?", "layout": "wide",
                 "enum": {"display": "radio", "choices": ["No", "Yes (must be corrected before submission)"]}},
                {"id": "bloodborne_screening", "label": "Bloodborne pathogen screening", "layout": "wide",
                 "enum": {"display": "radio", "choices": [
                     "Screened negative", "Not screened", "Known positive (describe in Biosafety)", "Not applicable"]}}
            ]
        },
        {
            "label": "Handling",
            "params": [
                {"id": "ibc_approval", "label": "Covered by institutional biosafety (IBC) approval?",
                 "enum": {"display": "radio", "choices": ["Yes", "No", "Not required"]}},
                {"id": "special_handling", "label": "Special handling, PPE, transport, storage, or decontamination?",
                 "enum": {"display": "radio", "choices": ["No", "Yes"]}},
                {"id": "special_handling_description", "label": "If yes, describe requirements", "type": "text"},
                {"id": "unused_sample", "label": "Unused sample after the session", "layout": "wide",
                 "enum": {"display": "radio", "choices": [
                     "User retrieves", "Users should take any residual sample back", "Other"]}},
                {"id": "unused_sample_other", "label": "If Other, please describe"}
            ]
        },
        {
            "label": "Training",
            "params": [
                {"id": "training_note", "label": "", "type": "label", "layout": "full",
                 "default": "The primary researcher must complete the annual mandatory training below, and any other training recommended by EHS, before starting experiments at the Center. Training must be current. Center staff training is verified by the Center."},
                {
                    "id": "training_table", "label": "Required training", "type": "table", "min_rows": 4,
                    "columns": [
                        {"id": "training", "label": "Required training"},
                        {"id": "provided_via", "label": "Provided via"},
                        {"id": "current", "label": "Current", "type": "bool"},
                        {"id": "completion_date", "label": "Completion date", "type": "date"}
                    ],
                    "default": [
                        {"training": "Bloodborne Pathogens (annual)", "provided_via": "Workday"},
                        {"training": "NAC PIM Awareness (annual)", "provided_via": "Workday"},
                        {"training": "Biosafety Level 2 (BSL-2)", "provided_via": "Workday"},
                        {"training": "Other EHS-recommended training (specify)", "provided_via": "EHS / Workday"}
                    ]
                },
                {
                    "id": "ppe", "label": "Personal protective equipment (PPE)",
                    "type": "custom", "template": "param_checkboxes.html", "layout": "wide",
                    "options": [
                        {"id": "ppe_own", "label": "I will bring my own PPE (lab coat, gloves, eye protection, and any other PPE required for this sample)"}
                    ]
                },
                {"id": "declaration_text", "label": "User Declaration", "type": "label", "layout": "full",
                 "default": "I confirm that the information provided above is accurate and complete. I have disclosed all known and potential biological, chemical, and radiological hazards associated with this sample, and the work is covered by the appropriate institutional approvals (IBC, IRB, IACUC, and others where required). The sample is labeled appropriately and will be transported in appropriate containment. I understand that samples may not be accepted, or may be stopped, until biosafety requirements and handling procedures have been confirmed by the Cryo-EM and Tomography Center and, where required, Biosafety/EHS."},
                {
                    "id": "declaration", "label": "Declaration",
                    "type": "custom", "template": "param_checkboxes.html", "layout": "wide",
                    "options": [
                        {"id": "declaration_researcher", "label": "Confirmed by User / Researcher"},
                        {"id": "declaration_pi", "label": "Confirmed by Principal Investigator"}
                    ]
                }
            ]
        },
        {
            "label": "Center Use",
            "params": [
                {"id": "center_note", "label": "", "type": "label", "layout": "full",
                 "default": "Facility records only. This form does not replace St. Jude institutional biosafety, IBC, IRB, EHS, or other required approvals."},
                {"id": "received_by", "label": "Date received / received by"},
                {"id": "sample_id", "label": "Sample ID assigned"},
                {"id": "decision", "label": "Decision", "layout": "wide",
                 "enum": {"display": "radio", "choices": [
                     "Approved", "Approved with restrictions", "Not approved", "Additional biosafety review required"]}},
                {"id": "ehs_consulted", "label": "Biosafety / EHS consulted?",
                 "enum": {"display": "radio", "choices": ["Yes", "No", "Not required"]}},
                {"id": "training_verified", "label": "Researcher training and PPE verified",
                 "enum": {"display": "radio", "choices": ["Yes", "No", "Not applicable"]}},
                {"id": "staff_training_current", "label": "Center staff training current (BBP, NAC PIM, BSL-2, EHS-recommended)",
                 "enum": {"display": "radio", "choices": ["Yes", "No"]}},
                {
                    "id": "approved_instruments", "label": "Approved instruments / workflows",
                    "type": "custom", "template": "param_checkboxes.html", "layout": "wide",
                    "options": [
                        {"id": "approved_grid_prep", "label": "Grid prep"},
                        {"id": "approved_hpf", "label": "HPF"},
                        {"id": "approved_cryoem_spa", "label": "Cryo-EM (SPA)"},
                        {"id": "approved_cryoet", "label": "Cryo-ET"},
                        {"id": "approved_fib", "label": "Cryo-FIB / PFIB"},
                        {"id": "approved_volume_em", "label": "Volume EM"},
                        {"id": "approved_cryo_flm", "label": "Cryo-FLM"},
                        {"id": "approved_rt_em", "label": "Room-temp EM / SEM"},
                        {"id": "approved_other", "label": "Other"}
                    ]
                },
                {
                    "id": "required_handling", "label": "Required handling",
                    "type": "custom", "template": "param_checkboxes.html", "layout": "wide",
                    "options": [
                        {"id": "handling_dedicated_consumables", "label": "Dedicated or disposable consumables"},
                        {"id": "handling_decontaminate", "label": "Decontaminate after use"},
                        {"id": "handling_restricted_instruments", "label": "Restricted to specific instrument(s)"},
                        {"id": "handling_other", "label": "Other"}
                    ]
                },
                {"id": "reviewed_by", "label": "Reviewed by / date"},
                {"id": "center_comments", "label": "Comments / restrictions", "type": "text"}
            ]
        }
    ]
}
"""


def log(message):
    print(f"{Pretty.now()}: {message}", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dry-run', action='store_true',
                   help="Do not modify anything, only print the changes.")
    args = p.parse_args()

    definition = json.loads(FORM_SAMPLE)

    with open_client() as dc:
        forms = {f['name']: f
                 for f in dc.request('get_forms', jsonData=None).json()}

        # 1. Create or update the entry form
        if form := forms.get(FORM_NAME):
            log(Color.bold(f"Updating form '{FORM_NAME}' (id={form['id']})"))
            form['definition'] = definition
            if not args.dry_run:
                dc.request('update_form', jsonData={'attrs': form})
        else:
            log(Color.bold(f"Creating form '{FORM_NAME}'"))
            if not args.dry_run:
                dc.request('create_form', jsonData={
                    'attrs': {'name': FORM_NAME, 'definition': definition}})

        # 2. Register the entry type in config:projects
        form = forms['config:projects']
        config = form['definition']
        config.setdefault('entries', {})[ENTRY_TYPE] = ENTRY_CONFIG
        menu = config.setdefault('entries_menu', [])
        index = next((i for i, item in enumerate(menu)
                      if item and item[0] == ENTRY_TYPE), None)
        if index is None:
            menu.insert(0, MENU_ITEM)
        else:
            menu[index] = MENU_ITEM  # Update the label if changed
        log(Color.bold("Updating 'config:projects'"))
        print(json.dumps({'entries.sample': ENTRY_CONFIG,
                          'entries_menu': menu}, indent=4))
        if not args.dry_run:
            dc.request('update_form', jsonData={'attrs': form})

    log(Color.green("Done." if not args.dry_run else "Dry run, nothing changed."))


if __name__ == '__main__':
    main()
