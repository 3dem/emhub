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
This script will check for actions to be taken on sessions,
e.g: create folders or the README file
"""

import os
import sys
import time
import argparse
import subprocess
import datetime as dt
import tempfile
from pprint import pprint


from emhub.client import open_client, config


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

    def _folderName():
        return '%s%s%05d' % (prefix, sep, counter)

    def _folderPath():
        return os.path.join(folder, _folderName())

    def _run(args):
        print("Running: ", args)
        process = subprocess.run(args, capture_output=True, text=True)
        if process.returncode != 0:
            raise Exception(process.stderr)
        return process

    while os.path.exists(_folderPath()):
        counter += 1

    folderPath = _folderPath()

    try:
        # Allow to define the command to create sessions
        sudo = os.environ.get('EMHUB_SESSION_SUDO', '').split()

        # Create the folder
        _run(sudo + ['mkdir', folderPath])

        session_info['name'] = _folderName()
        session_info['extra'] = {'data_folder': folderPath}

        dateStr = dt.datetime.now().strftime('%Y%m%d')
        readmeFn = os.path.join(folderPath, 'README_%s.TXT' % dateStr)

        f = tempfile.NamedTemporaryFile('w', delete=False)
        for user in ['pi', 'user', 'operator']:
            u = session[user] or {'name': '', 'email': ''}
            f.write('%s.name: %s\n' % (user, u['name']))
            f.write('%s.email: %s\n' % (user, u['email']))
        f.write('description: %s\n' % session['title'])
        f.write('date: %s\n' % dateStr)
        f.close()

        # Move the README file to the folder
        os.chmod(f.name, 0o644)
        _run(sudo + ['cp', f.name, readmeFn])
        os.remove(f.name)

        adduserCmd = os.environ.get('EMHUB_SESSION_ADDUSER', '')

        if adduserCmd:
            args = adduserCmd.split() + [session_info['name']]
            # Add new user to data download machine
            process = _run(args)
            for line in process.stdout.split('\n'):
                if 'Error: ' in line:
                    raise Exception(line)
                elif 'user.password' in line:
                    password = line.split()[1].strip()
                    session_info['extra']['data_user_password'] = password

    except Exception as e:
        session_info['status'] = 'failed'
        session_info['extra'] = {'status_info': str(e)}

    return session_info


def eprint(*args, **kwargs):
    """ print to stderr """
    print(*args, file=sys.stderr, **kwargs)

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
            eprint("Sessions: ")
            for s in r.json():
                eprint("   ", s['name'])
        return

    while True:
        try:
            with open_client() as dc:
                eprint("Connected to server: ", config.EMHUB_SERVER_URL)
                r = dc.request('poll_sessions', jsonData={})

                for s in r.json():
                    eprint("Handling session %s: " % s['id'])
                    eprint("   - Creating folder: ",
                          os.path.join(s['folder'], s['name']))
                    eprint("   - Updating session")
                    session_info = create_session_folder(s)
                    pprint(session_info)
                    dc.update_session(session_info)
        except Exception as e:
            eprint("Some error happened: ", str(e))
            eprint("Waiting 60 seconds before retrying...")
            time.sleep(60)


if __name__ == '__main__':
    main()
