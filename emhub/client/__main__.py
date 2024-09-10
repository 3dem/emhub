# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *              Grigory Sharov (gsharov@mrc-lmb.cam.ac.uk) [2]
# *
# * [1] SciLifeLab, Stockholm University
# * [2] MRC Laboratory of Molecular Biology (MRC-LMB)
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
"""
This module define a the `DataClient` class to communicate with an existing
EMHub server via its REST API.

By default, the `DataClient` class will use the configuration read from
`os.environ` in the `config` class.

A helper function `open_client` is provided for creating a context
where a `DataClient` instance is created, logged in and out.
"""
import os
import sys
import json
import argparse
from pprint import pprint

from .data_client import open_client, config

from emtools.utils import Pretty, Color


def date_str(datetimeStr):
    """ Helper to retrieve the date. """
    return datetimeStr.split('T')[0]


def process_forms(args):
    with open_client() as dc:
        forms = dc.request('get_forms', jsonData=None).json()
        form_ids = set(f['id'] for f in forms)

    if jsonForms := args.update:
        print(f"Loading Forms from json: {jsonForms}...")
        with open(jsonForms) as f:
            formList = json.load(f)
            with open_client() as dc:
                for f in formList:
                    if 'id' not in f or f['id'] not in form_ids:
                        print(f">>> Creating new form\t {f['name']}")
                        dc.request('create_form', jsonData={'attrs': f})
                    else:
                        print(f">>> Updating form ID={f['id']}\t {f['name']}")
                        dc.request('update_form', jsonData={'attrs': f})

    elif jsonForms := args.save:
        print(f"Writing Forms to json: {jsonForms}...")
        with open(jsonForms, 'w') as f:
            formList = [{'id': f['id'], 'name': f['name'],
                         'definition': f['definition']} for f in forms]
            json.dump(formList, f, indent=4)

    elif args.list:
        if args.list == 'all':
            row_format = u"{:<10}{:<35}"
            print(row_format.format("Form ID", "Name"))
            for f in forms:
                print(row_format.format(f['id'], f['name']))
        else:
            for f in forms:
                if str(f['id']) == args.list or f['name'] == args.list:
                    pprint(f)


def process_sessions(args):
    with open_client() as dc:
        sessions = dc.request('get_sessions', jsonData=None).json()
        sessions_dict = {s['id']: s for s in sessions}

        if args.list:
            if args.list == 'all':
                row_format = u"{:<6}{:<12}{:<35}"
                print(row_format.format("ID", "Date", "Name"))
                for s in sessions:
                    print(row_format.format(s['id'],
                                            date_str(s['start']),
                                            s['name']))
            else:
                for s in sessions:
                    if str(s['id']) == args.list or s['name'] == args.list:
                        pprint(s)
        elif args.update_acq:
            session_id = int(args.update_acq[0])
            new_acq = json.loads(args.update_acq[1])
            for s in sessions:
                if s['id'] == session_id:
                    print("Updating session ", session_id)
                    acq = s['acquisition']
                    acq.update(new_acq)
                    us = dc.update_session({'id': session_id,
                                            'acquisition': acq})
                    pprint(us)
        elif args.create:
            with open(args.create) as f:
                session_json = json.load(f)
                # Drop id field in case it is present
                session_json.pop('id', None)
                dc.create_session(session_json)


def process_pucks(args):
    with open_client() as dc:
        pucks = dc.request('get_pucks', jsonData=None).json()
        #sessions_dict = {s['id']: s for s in sessions}

        if args.list:
            row_format = u"{:>6}  {:<20}{:>6}{:>6}{:>6}  {:<30}"
            print(row_format.format("ID", "Label", "Dewar" , "Cane",
                                    "Pos", "Extra"))
            for p in pucks:
                print(row_format.format(p['id'], p['label'], p['dewar'],
                                        p['cane'], p['position'],
                                        json.dumps(p['extra'])))
        elif jsonFile := args.save:
            print(f"Writing Pucks Storage as JSON to file: {jsonFile}...")
            with open(jsonFile, 'w') as f:
                # Write one puck in each line
                f.write("[\n")
                n = len(pucks)
                for i, p in enumerate(pucks):
                    f.write("   ")
                    json.dump(p, f)
                    char = ',' if i < n - 1 else ''
                    f.write(f'{char}\n')
                f.write("]\n")

        elif jsonFile := args.update:
            if not os.path.exists(jsonFile):
                raise Exception("Input Pucks json file does not exist.")

            def _request(method, attrs, successLabel):
                req = dc.request(method, jsonData={'attrs': attrs})
                result = req.json()
                if 'puck' in result:
                    print(f"Puck {p['id']} {successLabel}.")
                else:
                    print(f"Puck {p['id']} Error: ", Color.red(result['error']))

            with open(jsonFile) as f:
                storage = json.load(f)
                # Delete all existing pucks before updating with new ones
                for p in pucks:
                    _request('delete_puck', {'id': p['id']}, 'DELETED')
                for p in storage:
                    _request('create_puck', p, 'CREATED')
        else:
            pass


def process_entries(args):
    with open_client() as dc:
        #sessions_dict = {s['id']: s for s in sessions}
        if arg := args.list:
            try:
                if arg.startswith('P:'):
                    input_id = int(arg.replace('P:', ''))
                    cond_str = 'project_id=%s' % input_id
                    print(f"Getting entry with ID: {input_id}")
                else:
                    input_id = int(arg)
                    cond_str = 'project_id=%s' % input_id
                    print(f"Getting entries from project: {input_id}")

                req = dc.request('get_entries', jsonData={'condition': cond_str})
                print(json.dumps(req.json(), indent=4))
                return
            except ValueError as e:
                print("Error: ", e)
                entries = dc.request('get_entries', jsonData=None).json()
                row_format = u"{:>6}   {:>6}   {:<25} {:<30}"
                print(row_format.format("ID", "ProjId", "Type", "Date"))
                for e in entries:
                    print(row_format.format(e['id'], "P:%04d" % e['project_id'],
                                            e['type'],
                                            date_str(e['date'])))


def main():
    p = argparse.ArgumentParser(prog='emh-client')
    p.add_argument('--url', default='')

    subparsers = p.add_subparsers(dest='entity')

    # ------------------------- Form subparser -------------------------------
    form_p = subparsers.add_parser("form")

    g = form_p.add_mutually_exclusive_group()
    # g.add_argument('--method', '-m', nargs=2, metavar=('METHOD', 'JSON'),
    #                help='Execute a method from the client')

    g.add_argument('--save', metavar='FORMS_JSON_FILE',
                   help="Store forms definition in a json file. ")
    g.add_argument('--update', metavar='FORMS_JSON_FILE',
                   help="Update forms with data from the json file. ")
    g.add_argument('--list', '-l')

    # ------------------------- Session subparser -------------------------------
    session_p = subparsers.add_parser("session")

    g = session_p.add_mutually_exclusive_group()
    # g.add_argument('--method', '-m', nargs=2, metavar=('METHOD', 'JSON'),
    #                help='Execute a method from the client')
    g.add_argument('--list', '-l')
    g.add_argument('--update_acq', nargs=2,
                   metavar=('SESSION_ID', 'JSON_ACQ'))
    g.add_argument('--create', '-c', metavar='SESSION_JSON',
                   help='Create a session from the json file. ')

    # ------------------------- Puck subparser -------------------------------
    puck_p = subparsers.add_parser("puck")

    g = puck_p.add_mutually_exclusive_group()
    g.add_argument('--save', metavar='PUCKS_JSON_FILE',
                   help="Store pucks storage into a a JSON file. ")
    g.add_argument('--update', metavar='PUCKS_JSON_FILE',
                   help="Update pucks storage info from a JSON file. "
                        "Be careful that this option will delete existing "
                        "pucks. ")
    g.add_argument('--list', '-l', action="store_true")

    # ------------------------- Entry subparser -------------------------------
    entry_p = subparsers.add_parser("entry")

    g = entry_p.add_mutually_exclusive_group()
    g.add_argument('--list', '-l')

    # ------------------------- Method subparser -------------------------------
    method_p = subparsers.add_parser("method")
    method_p.add_argument('method', metavar='METHOD_NAME')
    method_p.add_argument('attrs', metavar='ATTRS', nargs='?')
    method_p.add_argument('--extra', action="store_true")
    # g.add_argument('--transfer', nargs=3, metavar=('FRAMES', 'RAW', 'EPU'),
    #                help='Transfer (move) files from SRC to DST')
    # g.add_argument('--parse', metavar='DIR',
    #                help='Parse and print file stats from DIR')
    # g.add_argument('--epu', nargs=2, metavar=('SRC', 'DST'),
    #                help="Parse EPU input folder and makes a backup")
    args = p.parse_args()

    if args.url:
        config.EMHUB_SERVER_URL = args.url
        os.environ['EMHUB_SERVER_URL'] = args.url

    if args.entity == 'form':
        process_forms(args)

    elif args.entity == 'session':
        process_sessions(args)

    elif args.entity == 'puck':
        process_pucks(args)

    elif args.entity == 'entry':
        process_entries(args)

    elif args.entity == 'method':
        print("method: ", args.method)
        print("jsonData: ", args.attrs)

        with open_client() as dc:
            r = dc.request(args.method, jsonData={'attrs': json.loads(args.attrs)})
            result = r.json()

            if isinstance(result, list):
                for item in result:
                    if 'extra' in item and not args.extra:
                        del item['extra']
                    pprint(item)
            else:
                pprint(result)
    else:
        for k, v in os.environ.items():
            if k.startswith('EMHUB_'):
                print(f"export {k}={v}")


if __name__ == '__main__':
    main()
