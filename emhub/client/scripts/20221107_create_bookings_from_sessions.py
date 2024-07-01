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

from emtools.session import SessionsOtf
from emtools.session.config import load_users_map
from emtools.utils import Pretty, Color

from emhub.client import open_client, config
from emhub.utils import datetime_from_isoformat


def list_sessions():
    so = SessionsOtf()
    sessions = so.find_sessions()
    for s in sessions:
        pass


def fetch_data():
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
        for u in req.json():
            for user in users.values():
                if user['email'] == u['email']:
                    user['id'] = u['id']
                    user['name'] = u['name']

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

        so = SessionsOtf()
        sessions_dict = {}

        for s in so.sessions.values():
            user = users.get(s['user'], None)
            r = resources.get(s['microscope'], None)
            if user and  not 'id' in user:
                pprint(user)
            if user and r and 'id' in user:

                dt = Pretty.parse_datetime(s['start'])
                bjson =  {
                    'dt': dt,
                    'experiment': None,
                    'extra': {'otf': s['path']},
                    'owner_id': user['id'],
                    'resource_id': r['id'],
                    'type': 'booking',
                    'r_name': r['name'],
                    'u_name': user['name']
                }

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
                dt = bjson['dt']
                bjson.update({
                    'start': _utc_iso(dt, stime),
                    'end': _utc_iso(dt, stime + chunk),
                })
                print(f"\n>>> Creating Booking: {bjson['r_name']:<10} {bjson['u_name']:<40}")
                print(f"                         dt: {bjson['dt']}")
                del bjson['r_name']
                del bjson['u_name']
                del bjson['dt']
                result = dc.request('create_booking', jsonData={'attrs': bjson}).json()
                if 'error' in result:
                    booking_id = None
                    print(Color.red(f"    {result['error']}"))
                else:
                    booking_id = result['bookings_created'][0]['id']
                    print(f"    CREATED: Booking ID = {booking_id}")

                if booking_id:
                    stime += (chunk + 1)
                    path = bjson['extra']['otf']
                    session = so.sessions[path]
                    dt_start = Pretty.parse_datetime(session['start'])
                    if session['end']:
                        dt_end = Pretty.parse_datetime(session['end'])
                    else:
                        dt_end = dt_start + timedelta(hours=5)
                    # Create a session associated with the booking
                    sjson = {
                        'name': os.path.dirname(session['path']),
                        'start': _utc_iso(dt_start),
                        'end': _utc_iso(dt_end),
                        'status': 'finished',
                        'data_path': path,
                        'resource_id': bjson['resource_id'],
                        'booking_id': booking_id,
                        'extra': {'raw_folder': session['data'], 'otf': 'relion'},
                        'acquisition': session['acquisition'],
                        'stats': session['stats']
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

    fetch_data()


if __name__ == '__main__':
    main()





