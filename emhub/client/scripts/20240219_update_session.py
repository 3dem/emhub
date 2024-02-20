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
This script will create new bookings for specific bookings
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

update = '--update' in sys.argv


def update_session(args):
    dcSrc = DataClient()
    dcSrc.login(config.EMHUB_USER, config.EMHUB_PASSWORD)

    sessions = dcSrc.request('get_sessions', jsonData=None).json()

    print("Session id: ", args.session_id)
    for s in sessions:
        if s['id'] == int(args.session_id):
            print(f"Updating session {args.session_id}")
            acq = dict(s['acquisition'])
            acq['dose'] = '0.0381'
            s['acquisition'] = acq
            r = dcSrc.update_session(s)
            pprint(r)

    dcSrc.logout()


def main():
    p = argparse.ArgumentParser(prog='copy-session')

    p.add_argument('session_id')
   
    update_session(p.parse_args())


if __name__ == '__main__':
    main()





