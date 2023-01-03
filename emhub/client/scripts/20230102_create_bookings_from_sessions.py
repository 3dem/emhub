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
        resources = {}
        req = dc.request('get_resources', jsonData={})
        for r in req.json():
            if r['status'] == 'active':
                resources[r['name']] = r
                resources[r['id']] = r

        print(">>> Resources: ")
        pprint(resources)

        users = load_users_map()

        req = dc.request('get_users', jsonData={})
        users = req.json()
        users_dict = {u['email']: u for u in users}

        # for u in req.json():
        #     for user in users.values():
        #         if user['email'] == u['email']:
        #             user['id'] = u['id']
        #             user['name'] = u['name']

        # Delete all sessions
        req = dc.request('get_sessions', jsonData={})
        for b in req.json():
            print(f"Deleting session ID = {b['id']}")
            delete_req = dc.request('delete_session',
                                    jsonData={'attrs': {'id': b['id']}})
            result = delete_req.json()
            if 'session' in result:
                print("  DELETED.")
            else:
                print("  Error: ", Color.red(result['error']))

        # Delete all bookings
        req = dc.request('get_bookings', jsonData={})
        for b in req.json():
            print(f"Deleting booking ID = {b['id']}")
            delete_req = dc.request('delete_booking',
                                    jsonData={'attrs': {'id': b['id']}})
            pprint(delete_req.json())
        # TZ_DELTA = 0  # Define timezone, UTC '0'
        tn_tzinfo = timezone(timedelta(hours=-7))

        def _utc_iso(dt, h=None):
            h = h or dt.hour
            tn_dt = datetime(dt.year, dt.month, dt.day, h, tzinfo=tn_tzinfo)
            utc_dt = tn_dt.astimezone(timezone.utc)
            return utc_dt.isoformat()

        sessions_dict = {}
        client = SessionsClient()
        sessions = client.call('list')['result']['sessions']
        users_map = load_users_map()

        def _user(r):
            """ Guess user from raw. """
            if 'user' in r:
                return r['user']
            parts = r['path'].split('/')
            for i, p in enumerate(parts):
                if p == 'EPU' and i < len(parts) - 1:
                    return parts[i + 1]
            return 'No-user'

        def _resource(r):
            parts = r['path'].split('/')
            for p in parts:
                if p in ['Krios01', 'Arctica01']:
                    return p
            return 'No-scope'

        print("\nSESSIONS")

        for sInfo in sessions:
            session = client.call('session_info', sInfo['name'])['result']
            raw = session.get('raw', {})
            if 'first_movie_creation' not in raw:
                print(Color.red("Error: No 'first_movie_creation' found in session."))
                pprint(session)
                continue
            otf = session.get('otf', {})
            g = raw.get('group', 'No-group')
            u = _user(raw)
            rName = _resource(raw)
            email = users_map.get(u, {}).get('email', 'No-email')
            if g == 'cryoem_center_grp' and email == 'No-email':
                u, email = 'ISF', 'israel.fernandez@stjude.org'
            #print(f"{g:<20} {u:<15} {email:<40} {rName:<15} {raw['path']}")
            user = users_dict.get(email, None)
            r = resources.get(rName, None)

            if user and r and 'id' in user:
                dt = Pretty.parse_datetime(raw['first_movie_creation'])
                bjson = {
                    'dt': dt,
                    'experiment': None,
                    'extra': {},
                    'owner_id': user['id'],
                    'resource_id': r['id'],
                    'type': 'booking',
                    'r_name': r['name'],
                    'u_name': user['name'],
                    'session': session
                }

                if 'path' in otf:
                    bjson['data_path'] = otf['path']
                    bjson['extra']['otf'] = otf['path']

                key = (dt.date(), r['id'])
                if not key in sessions_dict:
                    sessions_dict[key] = []
                sessions_dict[key].append(bjson)

        for key, blist in sorted(sessions_dict.items(), key=lambda item: item[0][0]):
            blist.sort(key=lambda b: b['dt'])
            chunk = (13 - len(blist)) // len(blist)
            stime = 7
            print(f"\n>>> List for {str(key[0])}: {len(blist)}")
            for bjson in blist:
                dt = bjson.pop('dt')
                bjson.update({
                    'start': _utc_iso(dt, stime),
                    'end': _utc_iso(dt, stime + chunk),
                })
                print(f"\n>>> Creating Booking: {bjson['r_name']:<10} {bjson['u_name']:<40}")
                print(f"                         dt: {dt}")
                del bjson['r_name']
                del bjson['u_name']
                session = bjson.pop('session')
                data_path = bjson.pop('data_path', '')
                result = dc.request('create_booking', jsonData={'attrs': bjson}).json()

                # print("\n>>>> Creating Booking")
                # pprint(bjson)
                # result = {'error': 'Read-Only now'}

                if 'error' in result:
                    booking_id = None
                    print(Color.red(f"    {result['error']}"))
                else:
                    booking_id = result['bookings_created'][0]['id']
                    print(f"    CREATED: Booking ID = {booking_id}")

                if booking_id and 'raw' in session:
                    stime += (chunk + 1)
                    #path = bjson['extra']['otf']
                    raw = session['raw']
                    dt_start = bjson['start']
                    if 'last_movie_creation' in raw:
                        dt_end = raw['last_movie_creation']
                    else:
                        dt_end = bjson['end']
                    # Create a session associated with the booking
                    sjson = {
                        'start': dt_start,
                        'end': dt_end,
                        'status': 'finished',
                        'data_path': data_path,
                        'resource_id': bjson['resource_id'],
                        'booking_id': booking_id,
                        'extra': {'raw_folder': raw['path'], 'otf': 'relion'},
                        'acquisition': raw.get('acquisition', {}),
                        #'stats': session['stats']
                    }
                    print(">>> Creating Session")
                    result = dc.request('create_session', jsonData={'attrs': sjson}).json()
                    if 'error' in result:
                        print(Color.red(f"    {result['error']}"))
                    else:
                        session_id = result['session']['id']
                        print(f"    CREATED: Session ID = {session_id}")


def main():
    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)

    create_bookings()


if __name__ == '__main__':
    main()





