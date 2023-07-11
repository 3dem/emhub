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
This script will create new bookings for specific bookings
"""
import datetime
import os
import sys
import secrets
from pprint import pprint
from datetime import timezone, timedelta, datetime

from emtools.session import SessionsClient
from emtools.session.config import load_users_map
from emtools.utils import Pretty, Color

from emhub.client import open_client, config
from emhub.utils import datetime_from_isoformat


def create_bookings():
    with open_client() as dc:
        # Delete all sessions
        req = dc.request('get_sessions', jsonData={})
        sessions_dict = {}

        for s in req.json():
            extra = s['extra']
            if 'raw_folder' in extra:
                sessions_dict[extra['raw_folder']] = s

        client = SessionsClient()
        sessions = client.call('list')['result']['sessions']
        users_map = load_users_map()
        i = 0
        for sInfo in sessions:
            session = client.call('session_info', sInfo['name'])['result']
            raw = session.get('raw', {})
            raw_path = raw.get('path', '')

            if raw_path not in sessions_dict:
                continue

            acq = raw.get('acquisition', {})
            if acq:
                del raw['acquisition']
                s['acquisition'] = acq
            del raw['duration']
            del raw['sizeH']

            extra = {'raw': raw}

            otf = session.get('otf', {})
            s = sessions_dict[raw_path]
            if otf:
                del otf['group']
                del otf['microscope']
                del otf['raw_error']
                del otf['data']
                del otf['exists']
                del otf['user']
                extra['otf'] = otf
                if 'path' in otf:
                    s['data_path'] = otf['path']

            s['extra'] = extra
            print(Color.bold(f">>> Updating session: {s['id']}"))
            result = dc.request('update_session', jsonData={'attrs': s}).json()
            if 'error' in result:
                print(Color.red(f"    {result['error']}"))
            else:
                session_id = result['session']['id']
                print(f"    Updated: Session ID = {session_id}")
            i += 1


def main():
    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)

    create_bookings()


if __name__ == '__main__':
    main()





