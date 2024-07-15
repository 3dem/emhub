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

import os
import sys
import argparse
import json


def dump(keys, json_file):
    from emhub.client import open_client, config

    with open_client() as dc:
        json_data = {}

        if 'forms' in keys:
            forms = dc.request('get_forms').json()
            json_data['forms'] = [{
                'id': f['id'],
                'name': f['name'],
                'definition': f['definition']
            } for f in forms]

        if 'resources' in keys:
            json_data['resources'] = dc.request('get_resources').json()

        if 'users' in keys:
            json_data['users'] = dc.request('get_users').json()

        if json_data:
            with open(json_file, 'w') as f:
                json.dump(json_data, f, indent=4)


def main():
    p = argparse.ArgumentParser(prog='emh-data')
    g = p.add_mutually_exclusive_group()

    g.add_argument('--create_instance', nargs='*',
                   metavar=('FOLDER', 'JSON_FILE'),
                   help="Create a new instance in a FOLDER from a JSON_FILE. "
                        "If not FOLDER is provided, it will use by default:"
                        "~/.emhub/instances/test. "
                        "If not JSON is provided, a default one will be "
                        "created with some test data. ")
    g.add_argument('--dump', nargs=2,
                   metavar=('KEYS', 'JSON_FILE'),
                   help="Dump data related to an Entity in the data model."
                        "For example: forms, resources, etc. "
                        "Write the output to a json file.")

    p.add_argument('--force', '-f', action='store_true',
                   help="Force to do some actions "
                        "(e.g. remove instance folder if existing)")

    args = p.parse_args()
    create = args.create_instance

    if create is not None:
        n = len(create)
        instance_path = create[0] if n > 0 else None
        json_file = create[1] if n > 1 else None

        from emhub.data.imports.test import create_instance
        create_instance(instance_path, json_file, args.force)

    if args.dump:
        dump(args.dump[0].split(','), args.dump[1])


if __name__ == '__main__':
    main()
