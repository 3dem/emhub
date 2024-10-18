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
This script update a given entry
"""
import argparse
import os
import sys
import secrets
from pprint import pprint
from datetime import timezone, timedelta, datetime

from emtools.utils import Pretty, Color
from emhub.client import open_client, config, DataClient
from emhub.utils import datetime_from_isoformat

update = '--update' in sys.argv


def update_entry(args):
    entry_id = args.entry_id

    with open_client() as dc:
        entries = dc.request('get_entries', jsonData=None).json()

        print("Entry id: ", entry_id)
        for e in entries:
            if e['id'] == int(entry_id):
                extra = e['extra']
                extra['data']['days'] = '1'
                print(f"Updating entry {entry_id}")
                r = dc.request('update_entry',
                               {'attrs': {'id': entry_id,
                                          'type': e['type'],
                                          'extra': extra}})
                pprint(r.json())

def main():
    p = argparse.ArgumentParser(prog='update-session')

    p.add_argument('entry_id')
   
    update_entry(p.parse_args())


if __name__ == '__main__':
    main()





