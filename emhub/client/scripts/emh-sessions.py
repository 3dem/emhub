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

from emtools.utils import Process, Color
from emhub.client import open_client, config
from emtools.metadata import EPU


def _path(d):
    return 'path' in d and os.path.exists(d['path'])


def check_epu(epuPath, epuStar):
    def _color(f):
        return Color.green(f) if os.path.exists(f) else Color.red('Missing: ' + f)
    print("EPU folder: ", _color(epuPath))
    print("EPU movies star: ", _color(epuStar))


def parse_epu(rawPath, epuPath, epuStar, overwrite=False):
    if os.path.exists(epuPath):
        if overwrite:
            print(">>> Overwriting EPU: ", Color.bold(epuPath))
            os.rmdir(epuPath)
        else:
            print(">>> Skipping EPU: ", Color.bold(epuPath))
            return

    os.mkdir(epuPath)
    Process.system(f"emt-epu-parse.py {rawPath} --backup {epuPath} -o {epuStar}")


def check_foilholes(epuStar):
    if not os.path.exists(epuStar):
        print(Color.red('Missing EPU star file: ' + epuStar))
        return

    epuData = EPU.Data(epuStar)

    fh = {row.id: row for row in epuData.fhTable}
    # print(epuData.moviesTable[0])
    missingList = [row.fhId for row in epuData.moviesTable
                   if row.fhId not in fh]
    missingSet = set(missingList)

    print(f"Total missing Holes: {Color.red(len(missingSet))} "
          f"from {Color.red(len(missingList))} images "
          f"out of {len(epuData.moviesTable)}")


def process_sessions(args):
    with open_client() as dc:
        sessions = dc.request('get_sessions', jsonData=None).json()

    for s in sessions:
        raw = s['extra'].get('raw', {})
        otf = s['extra'].get('otf', {})

        if _path(raw) and _path(otf):
            print("\n\nSession: ", Color.green(s['name']))
            print("   - Raw folder: ", Color.bold(raw['path']))
            print("   - OTF folder: ", Color.bold(otf['path']))

            epuPath = os.path.join(otf['path'], 'EPU')
            epuStar = os.path.join(epuPath, 'movies.star')

            if args.parse_epu:
                parse_epu(raw['path'], epuPath, epuStar, overwrite=args.force)
            elif args.check_foilholes:
                check_foilholes(epuStar)
            elif args.check_epu:
                check_epu(epuPath, epuStar)


def main():
    p = argparse.ArgumentParser(prog='emt-epu-parse')
    g = p.add_mutually_exclusive_group()

    g.add_argument('--parse_epu', action='store_true',
                       help="Parse EPU files and make a metadata backup")
    g.add_argument('--check_epu', action='store_true',
                   help="Check if EPU is parsed for each session.")
    g.add_argument('--check_foilholes', action='store_true',
                       help="Check missing foilholes metadata")
    p.add_argument('--force', '-f', action='store_true',
                       help="Force to do some actions (e.g parse_epu)")

    process_sessions(p.parse_args())


if __name__ == '__main__':
    main()
