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


from emhub.client import open_client, config


def no_pi_user(user):
    return ('pi' in user['roles'] or
            'manager' in user['roles'] or
            user['username'] == 'hal@scilifelab.se')


def list_users(update):
    with open_client() as dc:
        r = dc.request('get_users', jsonData={})
        i = 0
        for user in r.json():
            if no_pi_user(user) and user['pi_id'] is not None:
                i += 1
                print('%03d:' % i, user['id'], user['name'], user['roles'], user['pi_id'])
                if update and user['pi_id']:
                    print(" Updating pi=None")
                    user['pi_id'] = None
                    dc.request('update_user', jsonData={'attrs': user})


def main():
    instance = os.environ['EMHUB_INSTANCE']
    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)
    print("EMHUB_INSTANCE: ", instance)

    update = '--update' in sys.argv

    list_users(update)


if __name__ == '__main__':
    main()





