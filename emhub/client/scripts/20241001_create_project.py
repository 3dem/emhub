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


def create_project():
    with open_client() as dc:
        attrs = {
            'status': "special:news",
            'title': "News Project",
            'user_id': 59,
            'validate': False
        }
        r = dc.request('create_project', {'attrs': attrs})
        pprint(r.json())

def create_news():
    with open_client() as dc:
        r = dc.request('get_projects', jsonData={'condition': 'status="special:news"'})
        project = r.json()[0]
        pid = project['id']

        print(r.json())

        print("Project News: ", pid)
        newsConfig = dc.get_config('news')
        attrs = {
            'project_id': pid,
            'type': 'news',
            'extra': {}
        }
        # Delete all entries from that project
        print("------ Deleting OLD entries: ")
        r = dc.request('get_entries', {'condition': 'project_id=%d' % pid})
        for e in r.json():
            print("   Deleting ", e['id'], "...")
            dc.request('delete_entry', {'attrs': {'id': e['id']}})

        print("-------- Creating News: ")
        for n in newsConfig['news']:
            attrs['date'] = n['date']
            attrs['title'] = n['title']
            attrs['description'] = n['text']
            attrs['extra']['data'] = {
                'active': n['status'] == 'active',
                'type': n['type']
            }
            print("   ", attrs)
            r = dc.request('create_entry', {'attrs': attrs})
            print("   ", r.json())


def main():
    #create_project()
    create_news()


if __name__ == '__main__':
    main()





