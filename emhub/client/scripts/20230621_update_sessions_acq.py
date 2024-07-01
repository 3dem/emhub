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

from emtools.utils import Pretty, Color
from emhub.client import open_client, config
from emhub.utils import datetime_from_isoformat

update = '--update' in sys.argv


def update_sessions_acq():
    with open_client() as dc:
        resources = dc.request('get_resources', jsonData=None).json()
        bookings = dc.request('get_bookings', jsonData=None).json()
        sessions = dc.request('get_sessions', jsonData=None).json()
        sconfig = dc.get_config('sessions')

        rDict = {r['id']: r['name'] for r in resources}
        brDict = {b['id']: rDict[b['resource_id']] for b in bookings}

        for s in sessions:
            acq = s['acquisition']
            ps = acq.get('pixel_size', None)
            rName = brDict[s['booking_id']]
            if ps:
                color = Color.green
                acqStr = str(acq)
            else:
                color = Color.red
                newAcq = sconfig['acquisition'][rName]
                acqStr = f"None -> {newAcq}"
                if update:
                    dc.update_session({'id': s['id'],
                                       'acquisition': newAcq})

            print(f"{color(s['name']):>25} {acqStr}")

        print(f"\n\nTotal sessions: {len(sessions)}")


def main():
    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)

    update_sessions_acq()


if __name__ == '__main__':
    main()





