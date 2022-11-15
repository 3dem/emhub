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
This script will update Application's  Representatives. "
"""

import os
import sys
from pprint import pprint


from emhub.client import open_client, config


def list_applications(code=None, update=False):
    with open_client() as dc:
        r = dc.request('get_applications', jsonData={})
        for a in r.json():
            if (not code or code == a['code']) and a['pi_list']:
                a['extra']['representative_id'] = a['pi_list'][0]
                del a['extra']['representative']
                if update:
                    print(">>> Updating application: ", a['code'])
                    # pi_list can not be updated here
                    attrs = {
                        'id': a['id'],
                        'extra': a['extra']
                    }
                    r2 = dc.request('update_application', jsonData={'attrs': attrs})
                    print(r2.json())
                else:
                    pprint(a)


def main():
    instance = os.environ['EMHUB_INSTANCE']
    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)
    print("EMHUB_INSTANCE: ", instance)

    update = '--update' in sys.argv

    # Uncomment the following fetch info or make changes in the real server
    #config.EMHUB_SERVER_URL = 'https://emhub.cryoem.se'

    list_applications(code=None, update=update)


if __name__ == '__main__':
    main()





