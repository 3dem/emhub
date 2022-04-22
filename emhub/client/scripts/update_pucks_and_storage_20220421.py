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


def main():

    instance = os.environ['EMHUB_INSTANCE']
    entry_files = os.path.join(instance, 'entry_files')

    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)
    print("EMHUB_INSTANCE: ", instance)


    with open_client() as dc:
        r = dc.request('get_entries', jsonData={})
        for entry in r.json():
            entry_id = entry['id']
            t = entry['type']

            if t == 'grids_storage':
                print("entry_id: ", entry_id)



if __name__ == '__main__':
    main()





