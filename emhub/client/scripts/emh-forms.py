#!/usr/bin/env python
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

import os.path
import argparse
import json

from emtools.utils import Process, Color
from emhub.client import open_client, config
from emtools.metadata import EPU


def _path(d):
    return 'path' in d and os.path.exists(d['path'])


def process_forms(args):
    with open_client() as dc:
        forms = dc.request('get_forms', jsonData=None).json()

    if args.load:
        with open(args.load) as f:
            formList = json.load(f)
            with open_client() as dc:
                for f in formList:
                    print(f">>> Updating form ID={f['id']}\t {f['name']}")
                    dc.request('update_form', jsonData={'attrs': f})

    elif args.dump:
        print(f"Writting Forms to json: {args.dump}...")
        with open(args.dump, 'w') as f:
            formList = [{'id': f['id'], 'name': f['name'],
                         'definition': f['definition']} for f in forms]
            json.dump(formList, f, indent=4)
    else:
        for f in forms:
            print(f"Form ID={f['id']}\t {f['name']}")


def main():
    p = argparse.ArgumentParser(prog='emh-forms.py')
    g = p.add_mutually_exclusive_group()

    g.add_argument('--load',
                       help="Load forms from JSON_FILE and update server.")
    p.add_argument('--dump', metavar='JSON_FILE',
                       help="Store forms definition in a JSON file")

    process_forms(p.parse_args())


if __name__ == '__main__':
    print(Color.green(f"Connected to server: {config.EMHUB_SERVER_URL}"))
    main()
