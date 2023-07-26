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
This script change the names of all users in the database
"""
import datetime
import os
import sys
from faker import Faker

from emtools.utils import Pretty, Color

from emhub.client import open_client, config
from emhub.utils import datetime_from_isoformat

update = '--update' in sys.argv
users = '--users' in sys.argv
sessions = '--sessions' in sys.argv
projects = '--projects' in sys.argv


def change_user_names():
    with open_client() as dc:
        users = dc.request('get_users', jsonData=None).json()
        c = 0
        f = Faker()
        for u in users:
            if u['status'] == 'active':
                print(f"{u['id']:>5}   {u['email']:>30}  {u['name']:30} {u['username']}")
                c += 1
                if update:
                    name = ' '.join(f.name().split(' ')[-2:])
                    email = name.lower().replace(' ', '.') + '@emhub.org'
                    attrs = {'id': u['id'], 'name': name, 'email': email}
                    dc.request('update_user', jsonData={'attrs': attrs})

        print(f"\n\nTotal users: {c}")


def change_session_names():
    with open_client() as dc:
        sessions = dc.request('get_sessions', jsonData=None).json()
        sconfig = dc.get_config('sessions')

        for s in sessions:
            if update:
                dc.update_session({'id': s['id'],
                                   'name': f"S{s['id']:05d}"
                                   })

        print(f"\n\nTotal sessions: {len(sessions)}")


def change_project_names():
    with open_client() as dc:
        projects = dc.request('get_projects', jsonData=None).json()

        for p in projects:

            if update:
                extra = dict(p['extra'])
                extra['is_confidential'] = True
                attrs = {'id': p['id'], 'extra': extra, 'title': 'Project Title'}
                dc.request('update_project', jsonData={'attrs': attrs})

        print(f"\n\nTotal projects: {len(projects)}")


def main():
    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)

    if users:
        change_user_names()

    if sessions:
        change_session_names()

    if projects:
        change_project_names()


if __name__ == '__main__':
    main()





