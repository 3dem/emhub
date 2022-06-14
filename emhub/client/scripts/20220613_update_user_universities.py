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


def list_forms(name=None):
    with open_client() as dc:
        r = dc.request('get_forms', jsonData={})
        for form in r.json():
            if not name or name == form['name']:
                pprint(form)


def update_universites():
    """
    Chalmers University of Technology
    Swedish University of Agricultural Sciences
    Örebro University
    Other Swedish University
    International University
    Healthcare
    Industry
    Naturhistoriska Riksmuséet
    Other Swedish organization
    Other international organization
    """
    form = {
        'definition': {
            "params": [
                    {
                        "label": "Karolinska Institutet",
                        "value": "ki.se"
                    },
                    {
                        "label": "KTH Royal Institute of Technology",
                        "value": "kth.se"
                    },
                    {
                        "label": "Linköping University",
                        "value": "liu.se"
                    },
                    {
                        "label": "Lund University",
                        "value": "lu.se"
                    },
                    {
                        "label": "Stockholm University",
                        "value": "su.se"
                    },
                    {
                        "label": "Umeå University",
                        "value": "umu.se"
                    },
                    {
                        "label": "University of Gothenburg",
                        "value": "gu.se"
                    },
                    {
                        "label": "Uppsala University",
                        "value": "uu.se"
                    }
                ],
            'title': 'Universities'
        },
        'name': 'universities'
    }
    endpoint = 'create_form'
    with open_client() as dc:
        r = dc.request('get_forms', jsonData={})
        for f in r.json():
            if f['name'] == 'universities':
                endpoint = 'update_form'
                form['id'] = f['id']

        r2 = dc.request(endpoint, jsonData={'attrs': form})
        print(endpoint, ':', r2)


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
        list_forms('experiment')


if __name__ == '__main__':
    main()





