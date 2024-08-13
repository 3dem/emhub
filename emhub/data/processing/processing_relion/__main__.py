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

from emtools.utils import Process, Color
from emhub.data import DataManager
from emhub.data.imports import MINIMAL_JSON, create_instance

cwd = os.getcwd()


def main():
    p = argparse.ArgumentParser(prog='emh-relion')
    p.add_argument('--port', '-p', type=int, default=5000,
                   help="Port where to run Flask debug server. "
                        "By default it will be 5000")
    args = p.parse_args()

    instance_path = os.path.join(cwd, '.emhub_instance')

    if not os.path.exists(instance_path):
        print(Color.bold("Creating EMhub instance at: "))
        print(Color.warn("    " + instance_path))

        dm = create_instance(instance_path, MINIMAL_JSON, False)

        with open(os.path.join(instance_path, 'config.py'), 'w') as config:
            config.write(f'PROCESSING_PROJECT = "{cwd}"\n')

        project = dm.get_projects()[0]  # get first project
        dm.create_entry(project_id=project.id,
                        type='data_processing',
                        extra={"data": {"project_path": cwd}})

    else:
        print(Color.bold("Loading EMhub instance from: "))
        print(Color.green("    " + instance_path))

    Process.system(f"source {instance_path}/bashrc && "
                   f"flask run --debug --port {args.port}")


if __name__ == '__main__':
    main()
