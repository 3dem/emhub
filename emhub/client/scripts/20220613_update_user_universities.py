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
This script will update user(id=335) email and create universities form"
"""

import os
import sys
from pprint import pprint


from emhub.client import open_client, config


def list_entries():
    with open_client() as dc:
        r = dc.request('get_entries', jsonData={})
        for entry in r.json():
            t = entry['type']
            if t == 'grids_preparation':
                extra = entry['extra']
                table = extra.get('data', {}).get('grids_preparation_table', [])

                if table:
                    print('\n>>>>> Entry ', entry['id'])
                    for row in table:
                        pprint(row)


def rename_col(row, old_col, new_col):
    if old_col in row:
        row[new_col] = row[old_col]
        del row[old_col]

def remove_key(obj, key):
    if key in obj:
        del obj[key]


def update_universites():
    """
    Chalmers University of Technology
    Karolinska Institutet
    KTH Royal Institute of Technology
    Linköping University
    Lund University
    Stockholm University
    Swedish University of Agricultural Sciences
    Umeå University
    University of Gothenburg
    Uppsala University
    Örebro University
    Other Swedish University
    International University
    Healthcare
    Industry
    Naturhistoriska Riksmuséet
    Other Swedish organization
    Other international organization
    """
    with open_client() as dc:
        pass


def main():
    instance = os.environ['EMHUB_INSTANCE']
    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)
    print("EMHUB_INSTANCE: ", instance)

    update = '--update' in sys.argv

    # Uncomment the following fetch info or make changes in the real server
    config.EMHUB_SERVER_URL = 'https://emhub.cryoem.se'

    if update:
        update_universites()
    else:
        list_entries()


if __name__ == '__main__':
    main()





