#!/usr/bin/env python
# **************************************************************************
# *
# * Authors:     J.M. de la Rosa Trevin (delarosatrevin@gmail.com)
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# * This program is distributed in the hope that it will be useful,
# * but WITHOUT ANY WARRANTY; without even the implied warranty of
# * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# * GNU General Public License for more details.
# *
# **************************************************************************

""" 
JSON server that will be connected to EMhub and will manage
the sessions' folders creation and data transfer.
"""
import os
import sys
import time
import argparse
import threading
from datetime import datetime, timedelta
from glob import glob
from collections import OrderedDict
import configparser
from pprint import pprint
from apscheduler.schedulers.background import BackgroundScheduler

from emtools.utils import Pretty, Process, JsonTCPServer, JsonTCPClient, Path, Color
from emtools.metadata import EPU

from emhub.client import open_client, config
from emhub.utils import datetime_from_isoformat

import sessions_config as sconfig


class SessionsData:
    def __init__(self, **kwargs):
        sessions_dict = OrderedDict()
        with open_client() as dc:
            req = dc.request('get_sessions', jsonData={})

            for i, s in enumerate(req.json()):
                sessions_dict[s['id']] = s
                if i == 10:
                    break

            resources_dict = {}
            req = dc.request('get_resources', jsonData={"attrs": ["id", "name"]})
            for r in req.json():
                resources_dict[r['id']] = r

        self.sessions = sessions_dict
        self.resources = resources_dict
        pprint(resources_dict)
        self.lock = threading.Lock()

    def print(self, *args):
        if self.verbose:
            print(*args)

    def active_sessions(self):
        return iter(s for s in self.sessions.values()
                    if s.get('status', 'finished') == 'active')

    def offload_session_files(self, session):
        """ Move files from the Raw folder to the Offload folder.
        Files will be moved when there has been a time without modification
        (file's timeout).
        """
        src = session['raw']['path']
        dst = session['offload']['path']
        ed = Path.ExtDict()

        now = datetime.now()
        td = timedelta(minutes=1)

        def _updateSessionFiles():
            new_session = dict(session)
            new_session['updated'] = Pretty.now()
            raw = new_session['raw']
            if 'files' in raw:
                ed.update(raw['files'])
            raw['files'] = dict(ed)
            ed.clear()
            self.update([new_session])

        def _moveFile(srcFile, dstFile):
            s = os.stat(srcFile)
            dt = datetime.fromtimestamp(s.st_mtime)
            if now - dt >= td:
                Process.system(f'rsync -ac --remove-source-files {srcFile} {dstFile}')
                ed.register(srcFile, stat=s)
                if len(ed) >= 10:  # update session info more frequently
                    _updateSessionFiles()

        Path.copyDir(src, dst, copyFileFunc=_moveFile)
        if ed:
            _updateSessionFiles()

    def update_active_sessions(self):
        for s in self.active_sessions():
            print(f"   Active session: {s['name']}, checking files")
            self.offload_session_files(s)

    def get_folders(self):
        folders = OrderedDict()
        for f in ['EPU', 'Offload', 'OTF', 'Groups']:
            folder = os.path.join(sconfig.SESSIONS_DATA_FOLDER, 'links', f)
            fpath = os.path.abspath(os.path.realpath(folder))
            folders[f] = (folder, fpath)
        return folders

    def create_session_otf(self, session):
        # Get absolute OTF root folder
        otf_root = self.get_folders()['OTF'][1]
        extra = session['extra']
        raw_path = extra['raw']['path']

        print(f">>> Creating OTF session from: {raw_path}")
        if not os.path.exists(raw_path):
            raise Exception("Input folder does not exists")

        date_ts = Pretty.now()  # Fixme Maybe use first file creation (for old sessions)
        date = date_ts.split()[0].replace('-', '')
        microscope = self.resources[session['resource_id']]['name']

        group = 'cyroemgrp'
        user = 'ISF'
        otf_folder = f"{date}_{microscope}_{group}_{user}_OTF"
        otf_path = os.path.join(otf_root, otf_folder)
        extra['otf'] = {'path': otf_path}
        session['data_path'] = otf_path
        print(f"rm -rf {otf_path}")
        os.system(f"rm -rf {otf_path}")

        def _path(*paths):
            return os.path.join(otf_path, *paths)

        os.mkdir(otf_path)
        os.symlink(raw_path, _path('data'))

        possible_gains = glob(_path('data', '*gain*.mrc'))
        if possible_gains:
            gain = possible_gains[0]
            os.symlink(os.path.relpath(gain, otf_folder), _path('gain.mrc'))

        # Create a general ini file with config/information of the session
        config = configparser.ConfigParser()

        config['GENERAL'] = {
            'group': group,
            'user': user,
            'microscope': microscope,
            'raw_data': raw_path
        }

        config['ACQUISITION'] = sconfig.acquisition[microscope]

        config['PREPROCESSING'] = {
            'images': 'data/Images-Disc1/GridSquare_*/Data/Foil*fractions.tiff',
            'software': 'None',  # or Relion or Scipion
        }

        with open(_path('README.ini'), 'w') as configfile:
            config.write(configfile)


class SessionsServer(JsonTCPServer):
    def __init__(self, address=None):
        address = address or sconfig.SESSIONS_SERVER_ADDRESS
        JsonTCPServer.__init__(self, address)
        self._refresh = 30
        self.data = SessionsData()
        self._files = {}
        #self._pollingThread = None
        self._scheduler = None

    def status(self):
        s = JsonTCPServer.status(self)
        s['sessions'] = len(self.data.sessions)
        config = {}
        for k in dir(sconfig):
            if k.startswith('SESSIONS_'):
                config[k] = getattr(sconfig, k)
        config['folders'] = {
            k: f"{v[0]} -> {v[1]}" for k, v in self.data.get_folders().items()
        }
        s['config'] = config
        s['active_sessions'] = [s['name'] for s in self.data.active_sessions()]
        return s

    def list(self, ):
        sessions = []
        for k, s in self.data.sessions.items():
            sessions.append(s)
        return {'sessions': sessions}

    def session_info(self, session_key):
        if session_key in self.data.sessions:
            return self.data.sessions[session_key]
        else:
            return {'errors': [f'Session {session_key} does not exists.']}

    def _session_handle_actions(self, dc, session, actions):
        extra = session['extra']
        remaining_actions = []
        for action in actions:
            try:
                print(f"   - Checking action: {action}")
                if action.startswith('update_raw'):
                    raw_path = extra['raw']['path']
                    raw_info = EPU.get_session_info(raw_path)
                    extra['raw'] = raw_info
                    extra['raw']['path'] = raw_path

                elif action.startswith('create_otf'):
                    self.data.create_session_otf(session)
            except Exception as e:
                print(e)
                remaining_actions.append(action)
        print(f"        Updating session {session['name']}")
        extra['actions'] = remaining_actions
        extra['updated'] = Pretty.now()
        dc.update_session(session)

    def _poll_sessions(self):
        """ Check for actions needed for EMhub's sessions. """
        while True:
            try:
                with open_client() as dc:
                    print("Connected to server: ", config.EMHUB_SERVER_URL)
                    print(">>> Polling active sessions...")
                    r = dc.request('poll_active_sessions', jsonData={})

                    for s in r.json():
                        print(f"   Handling session: {s['id']}")
                        extra = s['extra']
                        actions = extra.pop('actions', [])
                        self._session_handle_actions(dc, s, actions)
            except Exception as e:
                print("Some error happened: ", str(e))
                print("Waiting 60 seconds before retrying...")
                time.sleep(60)

    def _sessions_update_info(self):
        """ Inspect the files under active sessions and update 'raw' info.
        This job should not be run that frequent since it is not crucial info.
        """
        print(f"{Color.green(Pretty.now())} Updating sessions info...")
        with open_client() as dc:
            args = {'condition': 'status="active"',
                    "attrs": ["id", "name", "extra"]}
            r = dc.request('get_sessions', jsonData=args)
            for session in r.json():
                self._session_handle_actions(dc, session,
                                             ['update_raw:from_server'])

    def _sessions_sync_files(self):
        print(f"{Color.warn(Pretty.now())} Synchronizing files...")
        #self.data.update_active_sessions()

    def serve_forever(self, *args, **kwargs):
        print(f"{Color.green(Pretty.now())} Running server\n\taddress: {self._address}")
        # Start a thread with the server -- that thread will then start one
        # more thread for each request
        self._scheduler = BackgroundScheduler()
        # Schedule _poll_sessions function to run now
        self._scheduler.add_job(self._poll_sessions, 'date')
        self._scheduler.add_job(self._sessions_update_info, 'interval', minutes=5)
        self._scheduler.add_job(self._sessions_sync_files, 'interval', seconds=10)
        self._scheduler.start()

        JsonTCPServer.serve_forever(self, *args, **kwargs)

    def create_session(self, microscope, group, user, label):
        return self.data.create_session(microscope, group, user, label)

    def delete_session(self, session_name):
        return self.data.delete_session(session_name)


class SessionsClient(JsonTCPClient):
    def __init__(self, address=None):
        address = address or sconfig.SESSIONS_SERVER_ADDRESS
        JsonTCPClient.__init__(self, address)


def create_parser():
    parser = argparse.ArgumentParser(prog='emhub.sessions_server')
    parser.add_argument('--verbose', '-v', action='count')
    group = parser.add_mutually_exclusive_group()

    group.add_argument('--start_server', action='store_true',
                       help="Start the sessions server.")
    group.add_argument('--status', '-s', action='store_true',
                       help="Query sessions' server status.")
    group.add_argument('--list', '-l', action='store_true',
                       help="List all OTF sessions stored in the cache. ")
    group.add_argument('--info', '-i', type=int,
                       help="Get info about this session.")
    return parser


def run(args):
    if args.start_server:
        with SessionsServer() as server:
            server.serve_forever()
    else:
        client = SessionsClient()
        if not client.test():
            raise Exception(f"Server not listening on "
                            f"{sconfig.SESSIONS_SERVER_ADDRESS}")

        if args.status:
            status = client.call('status')['result']
            pprint(status)
        elif args.list:
            sessions = client.call('list')['result']['sessions']
            for s in sessions:
                print(s)
            print(f"Total: {len(sessions)}")
        elif args.info:
            session = client.call('session_info', args.info)['result']
            pprint(session)
        else:
            print("Nothing to do for now")


if __name__ == '__main__':
    parser = create_parser()
    run(parser.parse_args())
