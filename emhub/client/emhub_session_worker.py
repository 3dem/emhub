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

import os
import argparse
import subprocess


from emhub.client import DataClient, open_client


def create_session_folder(session):
    """ Create the session folder, the session counter might change if the given
    one already exist in the filesystem. In that case the next counter will be
    found. A README file will also be created with some session info.
    """
    session_info = {
        'id': session['id'],
        'status': 'created',
    }

    folder = session['folder']
    name = session['name']
    # We assume that the session counter are the last characters of the name
    # i.g fac00034, dbb00122 or cem00378_00012
    if '_' in name:
        prefix, counterStr = name.split('_')
        counter = int(counterStr)
        sep = '_'
    else:
        prefix = name[:3]
        counter = int(name[3:])
        sep = ''

    def _folderPath():
        return os.path.join(folder, '%s%s%s' % (prefix, sep, counter))

    while os.path.exists(_folderPath()):
        counter += 1

    folderPath = _folderPath()
    # Allow to define the command to create sessions
    args = os.environ.get('EMHUB_SESSION_MKDIR', 'mkdir').split()
    args.append(folderPath)
    print("Running: ", *args)
    process = subprocess.run(args, capture_output=True, text=True)

    if process.returncode != 0:
        session_info['status'] = 'failed'
        session_info['extra'] = {'status_info': process.stderr}
    else:
        session_info['name'] = '%s%s%s' % (prefix, sep, counter)

    return session_info


def main():
    parser = argparse.ArgumentParser()
    add = parser.add_argument  # shortcut

    add('--list', action='store_true',
        help="List existing sessions in the server.")

    args = parser.parse_args()

    # Testing function to just list the sessions
    if args.list:
        with open_client() as dc:
            r = dc.request('get_sessions', jsonData={})
            print("Sessions: ")
            for s in r.json():
                print("   ", s['name'])

        return

    while True:
        with open_client() as dc:
            r = dc.request('poll_sessions', jsonData={})

            for s in r.json():
                print("Handling session %s: " % s['id'])
                print("   - Creating folder: ", os.path.join(s['folder'], s['name']))
                print("   - Updating session")
                session_info = create_session_folder(s)
                dc.update_session(session_info)


if __name__ == '__main__':
    main()





