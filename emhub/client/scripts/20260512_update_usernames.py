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
Update EMhub user ``username`` fields from an email-to-LDAP JSON map.

The map file must be a JSON object: ``{"user@example.org": "ldap_username", ...}``.

Examples::

  python 20260512_update_usernames.py ldap_map.json
"""

import argparse
import json
import os
import sys

from emtools.utils import Pretty, Color
from emhub.client import open_client


def log(message):
    print(f"{Pretty.now()}: {message}", flush=True)


def update_users(ldap_map_file):
    """Update LDAP usernames for all users."""
    log(Color.green(">>> Updating LDAP usernames..."))
    with open(ldap_map_file, 'r') as f:
        ldap_map = json.load(f)

    with open_client() as dc:
        users = dc.request('get_users', jsonData={}).json()
        updated = 0
        not_found = 0
        for u in users:
            if ldap_username := ldap_map.get(u.get('email', ''), None):
                u['username'] = ldap_username
                dc.request('update_user', jsonData={'attrs': u})
                log(
                    f"{u.get('name', '')!r}: {u.get('email', '')} -> "
                    f"{Color.green(ldap_username)}"
                )
                updated += 1
            else:
                log(
                    f"{u.get('name', '')!r}: {u.get('email', '')} -> "
                    f"{Color.red('not found')}"
                )
                not_found += 1

        log(f"     Done. Updated {updated} user(s).")
        log(f"     {Color.red('Not found')} {not_found} user(s).")


def main():
    p = argparse.ArgumentParser(
        description='Update user usernames from an email-to-LDAP JSON map.',
    )
    p.add_argument(
        'ldap_map',
        metavar='LDAP_MAP_JSON',
        help='JSON file mapping user email to LDAP username',
    )
    args = p.parse_args()

    ldap_map_file = os.path.expanduser(args.ldap_map)
    if not os.path.isfile(ldap_map_file):
        log(Color.red(f'LDAP map file not found: {ldap_map_file!r}'))
        sys.exit(1)

    update_users(ldap_map_file)


if __name__ == '__main__':
    main()
