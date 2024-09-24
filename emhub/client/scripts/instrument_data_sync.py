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

"""
Synchronize
Monitor a folder with Negative-Stain images and copy them to each group's folder.
Raw image path and groups folder is read from EMhub configuration.
"""

import os
import sys
import argparse
from pprint import pprint

from emtools.utils import Color, Process
from emhub.client import open_client


def main():
    p = argparse.ArgumentParser(prog='instrument_data_sync.py')
    p.add_argument('data_root',
                   help="Root directory where data is mounted. "
                        "It is expected that each group has a folder "
                        "there. ")
    p.add_argument('instrument_folder',
                   help="Instrument folder name that will be used "
                        "to copy the data to. ")
    p.add_argument('--copy', '-c', action="store_true",
                   help="By default it will do a dry execution. When "
                        "this option is used, the real copy is done. ")

    args = p.parse_args()
    data_root = args.data_root
    instrument_folder = args.instrument_folder
    dry = not args.copy

    logger = Process.Logger(only_log=dry)

    def _color(path):
        color = Color.bold if os.path.exists(path) else Color.red
        return color(path)

    def _rsync(src, dst):
        """ Synchronize content from 'src' to 'dst'. """
        if not os.path.exists(dst):
            logger.mkdir(dst)
        cmd = f"rsync -av '{src}/' '{dst}/'"
        logger.system(cmd)

    with open_client() as dc:
        sconfig = dc.get_config('sessions')
        raw = sconfig['raw']
        jude_folder = raw['jude_group_folder']
        for group in sconfig['groups'].values():
            print('\n', Color.warn(group))
            negstain_path = os.path.join(data_root, group)
            print("  Data root: ", _color(negstain_path))
            gscem_path = os.path.join(raw['root'], group)
            print("     GSCEM: ", _color(gscem_path))
            jude_path = jude_folder.format(group=group)
            print("      Jude: ", _color(jude_path))

            if not os.path.exists(negstain_path):
                continue

            if os.path.exists(gscem_path):
                _rsync(negstain_path, os.path.join(gscem_path, instrument_folder))

            if os.path.exists(jude_path):
                _rsync(negstain_path, os.path.join(jude_path, instrument_folder))


if __name__ == '__main__':
    main()





