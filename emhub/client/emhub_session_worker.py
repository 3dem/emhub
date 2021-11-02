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
This script will check for actions to be taken on sessions, e.g: create folders or the README file
"""

import sys, os
import time
import datetime as dt
import argparse
from pprint import pprint
from contextlib import contextmanager


from pyworkflow.project import Manager
import pyworkflow.utils as pwutils

from pwem.objects import SetOfCTF


class config:
    EMHUB_SOURCE = os.environ['EMHUB_SOURCE']
    EMHUB_SERVER_URL = os.environ['EMHUB_SERVER_URL']
    EMHUB_USER = os.environ['EMHUB_USER']
    EMHUB_PASSWORD = os.environ['EMHUB_PASSWORD']


# add emhub source code to the path and import client submodule
sys.path.append(config.EMHUB_SOURCE)

from emhub.client import DataClient


@contextmanager
def open_client():
    dc = DataClient(server_url=config.EMHUB_SERVER_URL)
    try:
        dc.login(config.EMHUB_USER, config.EMHUB_PASSWORD)
        yield dc
    finally:
        dc.logout()


def main():
    while True:
        with open_client() as dc:
            r = dc.request('poll_sessions', jsonData={})

            print("Updating sessions: ")

            headers = ["id", "name", "status", "booking", "operator", "start"]
            row_format = u"{:<5}{:<25}{:<10}{:<10}{:<30}"
            print(row_format.format(*headers))


            for s in r.json():
                row = [s['id'], s['name'], s['status'],
                       s['booking_id'], s['operator_id'], s['start']]
                print(row_format.format(*row))

            for s in r.json():
                print("Updating session %s..." % s['id'])
                dc.update_session({'id': s['id'], 'status': 'created'})


if __name__ == '__main__':
    main()





