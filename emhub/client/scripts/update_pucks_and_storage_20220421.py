#!/usr/bin/env python
# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *
# * [1] SciLifeLab, Stockholm University
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
# *  e-mail address 'delarosatrevin@scilifelab.se'
# *
# **************************************************************************

""" 
This script will insert New Pucks
and then also update the existing Grid Storage Entries
"""

import os
import sys
import time
import argparse
import subprocess
import datetime as dt
import tempfile
from pprint import pprint


from emhub.client import open_client, config

LOCATION_LABELS = ['dewar_number', 'cane_number', 'puck_number']


def location(row, labels=None):
    labels = labels or LOCATION_LABELS
    return tuple([int(row.get(k, 0)) for k in labels])


def update_old_puck(dc, puck):
    loc = location(puck, labels=['dewar', 'cane', 'position'])
    puck['code'] = None
    label = 'OLD_PUCK-D%dC%02dP%02d' % loc
    puck['label'] = label

    dc.request('update_puck', jsonData={'attrs': puck})

    return loc


def print_puck(puck):
    puck_str = str(puck).replace('position', 'p')
    print(puck_str)


def list_pucks():
    with open_client() as dc:
        r = dc.request('get_pucks', jsonData={})
        for puck in r.json():
            print_puck(puck)


def update_pucks_label():
    with open_client() as dc:
        locDict = {}

        r = dc.request('get_pucks', jsonData={})

        for puck in r.json():
            loc = update_old_puck(dc, puck)
            print_puck(puck)
            locDict[loc] = puck

    return locDict


def list_entries():
    with open_client() as dc:
        r = dc.request('get_entries', jsonData={})
        for entry in r.json():
            t = entry['type']
            if t == 'grids_storage':
                extra = entry['extra']
                table = extra.get('data', {}).get('grids_storage_table', [])

                if table:
                    print('Entry ', entry['id'])
                    for row in table:
                        print("   ", row)


def rename_col(row, old_col, new_col):
    if old_col in row:
        row[new_col] = row[old_col]
        del row[old_col]

def remove_key(obj, key):
    if key in obj:
        del obj[key]

def update_storage_entries(locDict):
    with open_client() as dc:
        r = dc.request('get_entries', jsonData={})
        for entry in r.json():
            t = entry['type']
            extra = entry['extra']
            data = extra.get('data', {})

            if t == 'grids_storage':
                remove_key(data, 'gridbox_slot')
                table = data.get('grids_storage_table', [])

                if table:
                    newTable = []
                    for row in table:
                        loc = location(row)
                        try:
                            puck = locDict[loc]
                            row['puck_id'] = puck['id']

                            rename_col(row, 'puck_position', 'box_position')
                            rename_col(row, 'gridbox_slot', 'grid_position')

                            newTable.append(row)
                        except Exception as e:
                            print('Error: ', e)
                            pprint(row)
                    data['grids_storage_table'] = newTable

                dc.request('update_entry', jsonData={'attrs': entry})
                    # loc = location(row)
                    # if loc:
                    #     print("   D%d-C%02d-P%02d" % tuple(loc),
                    #           'label=%s' % row.get('puck_label', ''),
                    #           'color=%s' % row.get('puck_color', ''))
            elif t == 'screening':
                if data:
                    rename_col(data, 'grids_storage_table', 'grids_table')
                    dc.request('update_entry', jsonData={'attrs': entry})


def main():

    instance = os.environ['EMHUB_INSTANCE']
    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)
    print("EMHUB_INSTANCE: ", instance)

    update = '--update' in sys.argv

    if update:
        locDict = update_pucks_label()
        update_storage_entries(locDict)
    else:
        #list_pucks()
        list_entries()



if __name__ == '__main__':
    main()





