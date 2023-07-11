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
This script will set random password for each user
and store it in a text file.
"""

import os
import sys
import secrets


from emhub.client import open_client, config


def no_pi_user(user):
    return ('pi' in user['roles'] or
            'manager' in user['roles'] or
            user['username'] == 'hal@scilifelab.se')


def list_users(update):
    headers = ["USERID", "USERNAME", "EMAIL", "PASSWORD", "Action"]
    format_str = u'{:<10}{:<30}{:<40}{:<20}{:<10}'

    not_change = []
    password_length = 10

    print(format_str.format(*headers))

    with open_client() as dc:
        r = dc.request('get_users', jsonData={})
        for user in r.json():
            change_pass = user['email'] not in not_change
            user['password'] = secrets.token_urlsafe(password_length) if change_pass else '*'

            if update and change_pass:
                dc.request('update_user', jsonData={'attrs': user})
                action = 'update'
            else:
                action = ''
            values = [user['id'], user['name'], user['email'],
                      user['password'], action]
            print(format_str.format(*values))


def main():
    instance = os.environ['EMHUB_INSTANCE']
    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)
    print("EMHUB_INSTANCE: ", instance)

    update = '--update' in sys.argv

    list_users(update)


if __name__ == '__main__':
    main()





