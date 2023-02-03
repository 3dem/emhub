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
import traceback

from emtools.utils import Pretty, Process, JsonTCPServer, JsonTCPClient, Path, Color
from emtools.metadata import EPU

from emhub.client import open_client, config


def __server_address():
    parts = os.environ.get('SESSIONS_SERVER_ADDRESS', 'localhost:5555').split(':')
    return parts[0], int(parts[1])


SESSIONS_SERVER_ADDRESS = __server_address()
SESSIONS_DATA_FOLDER = os.environ.get('SESSIONS_DATA_FOLDER', None)


class SessionsData:
    def __init__(self, **kwargs):

        print("- Loading sessions...")
        self.sessions = self.request_dict('get_sessions')
        print(f"    Total: {len(self.sessions)}")

        print("- Loading resources...")
        self.resources = self.request_dict('get_resources',
                                           {"attrs": ["id", "name"]})
        print(f"    Total: {len(self.resources)}")
        pprint(self.resources)

        print("- Loading config...")
        self.config = self.request_config('sessions')
        pprint(self.config)

        def _check_folder(key, folder):
            exists = folder and os.path.exists(folder)
            color = Color.bold if exists else Color.red
            print(f"{key}: {color(folder)}")
            if not exists:
                print(Color.red(">>> Missing folder!!! Exiting."))
                sys.exit(1)

        _check_folder("SESSIONS_DATA_FOLDER", SESSIONS_DATA_FOLDER)
        for k, v in self.get_folders().items():
            _check_folder(k, v[1])

        if not os.path.exists(SESSIONS_DATA_FOLDER):
            print(Color.red(" Missing"))

        self.lock = threading.Lock()

    def request_data(self, endpoint, jsonData=None):
        with open_client() as dc:
            return dc.request(endpoint, jsonData=jsonData).json()

    def request_dict(self, endpoint, jsonData=None):
        return {s['id']: s for s in self.request_data(endpoint, jsonData=jsonData)}

    def request_config(self, config):
        data = {'attrs': {'config': config}}
        return self.request_data('get_config', jsonData=data)['config']

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
            folder = os.path.join(SESSIONS_DATA_FOLDER, f)
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

        attrs = {"attrs": {"id": session['id']}}
        users = self.request_data('get_session_users', attrs)['session_users']
        print(Color.red(">>> Users: "))
        pprint(users)

        date_ts = Pretty.now()  # Fixme Maybe use first file creation (for old sessions)
        date = date_ts.split()[0].replace('-', '')
        microscope = self.resources[session['resource_id']]['name']

        name = session['name']
        otf_folder = f"{date}_{microscope}_{name}_OTF"
        otf_path = os.path.join(otf_root, otf_folder)
        extra['otf'] = {'path': otf_path}
        session['data_path'] = otf_path
        print(f"rm -rf {otf_path}")
        os.system(f"rm -rf {otf_path}")

        def _path(*paths):
            return os.path.join(otf_path, *paths)

        os.mkdir(otf_path)
        os.symlink(raw_path, _path('data'))

        gain_pattern = self.config['data']['gain']
        possible_gains = glob(gain_pattern.format(microscope=microscope))
        if possible_gains:
            gain = possible_gains[0]
            os.symlink(os.path.realpath(gain), _path('gain.mrc'))

        # Create a general ini file with config/information of the session
        config = configparser.ConfigParser()

        operator = users['operator'].get('name', 'No-operator')
        config['GENERAL'] = {
            'group': users['group'],
            'user': users['owner']['name'],
            'operator': operator,
            'microscope': microscope,
            'raw_data': raw_path
        }

        acq = dict(self.config['acquisition'][microscope])
        config['ACQUISITION'] = acq

        config['PREPROCESSING'] = {
            'images': 'data/Images-Disc1/GridSquare_*/Data/Foil*fractions.tiff',
            'software': 'None',  # or Relion or Scipion
        }

        with open(_path('README.txt'), 'w') as configfile:
            config.write(configfile)

        options = """{{
'do_prep' : 'True', 
'do_proc' : 'False', 
'prep__do_at_most' : '16', 
'prep__importmovies__angpix' : '{pixel_size}', 
'prep__importmovies__kV' : '{voltage}', 
'prep__importmovies__Cs' : '{cs}', 
'prep__importmovies__fn_in_raw' : 'data/Images-Disc1/GridSquare_*/Data/FoilHole_*_fractions.tiff', 
'prep__importmovies__is_multiframe' : 'True',
'prep__motioncorr__do_own_motioncor': 'False',
'prep__motioncorr__fn_motioncor2_exe': '/software/scipion/EM/motioncor2-1.5.0/bin/motioncor2',
'prep__motioncorr__dose_per_frame' : '1.00',
'prep__motioncorr__do_save_noDW' : 'False',
'prep__motioncorr__do_save_ps' : 'False', 
'prep__motioncorr__do_float16' : 'False',
'prep__motioncorr__fn_gain_ref' : './gain.mrc', 
'prep__motioncorr__bin_factor' : '1', 
'prep__motioncorr__gpu_ids' : '0:1', 
'prep__motioncorr__nr_mpi' : '2', 
'prep__motioncorr__nr_threads' : '1',
'prep__motioncorr__patch_x' : '7',
'prep__motioncorr__patch_y' : '5',
'prep__motioncorr__other_args' : '--skip_logfile --do_at_most 16',
'prep__ctffind__fn_ctffind_exe' : '/software/scipion/EM/ctffind4-4.1.13/bin/ctffind', 
'prep__ctffind__nr_mpi' : '8',
'prep__ctffind__use_given_ps' : 'False',
'prep__ctffind__use_noDW' : 'False',
}}\n"""

        with open(_path('relion_it_options.py'), 'w') as f:
            f.write(options.format(**acq))

        config = self.request_config('sessions')
        opts = self.config['otf']['relion']['common']
        print(">>> Creating Relion OTF with options: ")
        pprint(opts)
        with open(_path('relion_it_options2.py'), 'w') as f:
            optStr = ",\n".join(f"'{k}' : '{v.format(**acq)}'" for k, v in opts.items())
            f.write("{\n%s\n}\n" % optStr)


class SessionsServer(JsonTCPServer):
    def __init__(self, address=None):
        address = address or SESSIONS_SERVER_ADDRESS
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
                traceback.print_exc()
                #remaining_actions.append(action)
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
        address = address or SESSIONS_SERVER_ADDRESS
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
                            f"{SESSIONS_SERVER_ADDRESS}")

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
