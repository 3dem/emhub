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

import os
import sys
import time
import logging
import argparse
import threading
from datetime import datetime, timedelta
from glob import glob
from collections import OrderedDict
import configparser
from pprint import pprint
import traceback

from emtools.utils import Pretty, Process, Path, Color, Timer
from emtools.metadata import EPU

from emhub.client import open_client, config


SESSIONS_DATA_FOLDER = os.environ.get('SESSIONS_DATA_FOLDER', None)


class SessionHandler:
    """ Class with base functionality used by the Worker thread and the
    main SessionManager.
    """
    def create_logger(self, logsFolder, logName):
        logFn = os.path.join(logsFolder, logName)
        handler = logging.FileHandler(logFn)
        formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
        handler.setFormatter(formatter)
        logger = logging.getLogger(logName)
        logger.setLevel(logging.DEBUG)
        logger.addHandler(handler)
        if self.debug:
            handler = logging.StreamHandler()
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        self.logger = logger
        self.pl = Process.Logger(logger)

    def session_loop(self, session_func):
        first = True

        while True:
            try:
                if not first:
                    time.sleep(60)
                    if self._stopEvent.is_set():
                        self.logger.info("Stopping worker thread.")
                        break
                    with open_client() as dc:
                        self.session = dc.get_session(self.session['id'])

                session_func(first)

            except Exception as e:
                self.logger.error('FATAL ERROR: ' + str(e))
                self.logger.error(traceback.format_exc())
                break
            first = False

    def update_session(self, session=None):
        session = session or self.session
        self.logger.info(f"Updating session {session['name']}")
        session['extra']['updated'] = Pretty.now()
        with open_client() as dc:
            dc.update_session(session)


class SjSessionWorker(threading.Thread, SessionHandler):
    def __init__(self, manager, session, task, debug):
        threading.Thread.__init__(self)
        SessionHandler.__init__(self)
        self.manager = manager
        self.session = session
        self.logger = None
        self.pl = None
        self.task = task
        self.debug = debug
        self._otf_launched = False
        self._stopEvent = threading.Event()

    def stop(self):
        self._stopEvent.set()

    def get_folder_name(self):
        """ Unique folder based on session info. """
        date_ts = Pretty.now()  # Fixme Maybe use first file creation (for old sessions)
        date = date_ts.split()[0].replace('-', '')
        name = self.session['name']
        return f"{date}_{self.microscope}_{name}"

    def create_raw_folder(self, frames_root, raw_root, session, pl):
        """ Create the folder where frames will be written from the microscope
        and also the raw folder were data will be offloaded.
        """
        extra = session['extra']

    def create_otf_folder(self):
        extra = self.session['extra']
        raw_path = extra['raw']['path']

        otf_folder = self.get_folder_name() + '_OTF'
        otf_root = self.sconfig['otf']['root']
        otf_path = os.path.join(otf_root, otf_folder)
        extra['otf'].update({'path': otf_path, 'status': 'created'})
        self.session['data_path'] = otf_path
        self.pl.system(f"rm -rf {otf_path}")

        def _path(*paths):
            return os.path.join(otf_path, *paths)

        os.mkdir(otf_path)
        os.symlink(raw_path, _path('data'))

        gain_pattern = self.sconfig['data']['gain']
        possible_gains = glob(gain_pattern.format(microscope=self.microscope))
        if possible_gains:
            gain = possible_gains[0]
            os.symlink(os.path.realpath(gain), _path('gain.mrc'))

        # Create a general ini file with config/information of the session
        config = configparser.ConfigParser()

        operator = self.users['operator'].get('name', 'No-operator')
        config['GENERAL'] = {
            'group': self.users['group'],
            'user': self.users['owner']['name'],
            'operator': operator,
            'microscope': self.microscope,
            'raw_data': raw_path
        }

        acq = dict(self.sconfig['acquisition'][self.microscope])
        config['ACQUISITION'] = acq

        config['PREPROCESSING'] = {
            'images': 'data/Images-Disc1/GridSquare_*/Data/Foil*fractions.tiff',
            'software': 'None',  # or Relion or Scipion
        }

        with open(_path('README.txt'), 'w') as configfile:
            config.write(configfile)

        opts = self.sconfig['otf']['relion']['options']
        with open(_path('relion_it_options.py'), 'w') as f:
            optStr = ",\n".join(f"'{k}' : '{v.format(**acq)}'" for k, v in opts.items())
            f.write("{\n%s\n}\n" % optStr)

    def create_folders(self):
        extra = self.session['extra']
        raw = extra.get('raw', None)
        otf = extra['otf']

        if not raw:
            raise Exception("Missing 'raw' from session")

        raw_path = raw['path']
        if not raw_path or not os.path.exists(raw_path):
            raise Exception("Missing raw_path")

        otf_path = otf.get('path', '')
        otf_exists = os.path.exists(otf_path)

        if not otf_exists or self.task['create']:
            self.logger.info(f'OTF folder does not exists, creating one')
            self.create_otf_folder()

    def update_session(self):
        self.logger.info(f"Updating session {self.session['name']}")
        self.session['extra']['updated'] = Pretty.now()
        with open_client() as dc:
            dc.update_session(self.session)

    def update_raw(self):
        extra = self.session['extra']
        raw = extra.get('raw', None)
        otf = extra['otf']
        raw_path = raw['path']

        timer = Timer()
        logger = self.logger
        epuPath = os.path.join(otf['path'], 'EPU')
        epuMoviesFn = os.path.join(epuPath, 'movies.star')
        last_movie = raw.get('last_movie', '')

        logger.info(f'Parsing RAW files from: {raw_path}')
        logger.info(f'            last movie: {last_movie}')
        timer.tic()
        raw = EPU.parse_session(raw_path,
                                outputStar=epuMoviesFn,
                                backupFolder=epuPath,
                                lastMovie=last_movie,
                                pl=self.pl)
        logger.info(f'Parsing took {timer.getToc()}')

        if last_movie != raw.get('last_movie', ''):
            raw['path'] = raw_path
            extra['raw'] = raw
            self.update_session()  # FIXME: Update raw only

    def update_otf(self):
        extra = self.session['extra']
        raw = extra.get('raw', None)
        otf = extra['otf']
        otf_status = otf['status']

        if otf_status == 'created':  # check to launch otf
            # this is a protection in case OTF status does not update on time
            if not self._otf_launched:
                n = raw['movies']
                launch_otf = n > 16
                if launch_otf:
                    otf['status'] = 'launched'
                    self.logger.info(f"Launching OTF after {raw['movies']} input movies .")
                    self.launch_otf()
                    self.update_session()  # FIXME: Update otf only
                    self._otf_launched = True
                else:
                    self.logger.info(f"OTF: folder already CREATED, "
                                f"input movies {raw['movies']}."
                                f"Waiting for more movies")

        elif otf_status in ['launched', 'running']:
            pass  # FIXME: monitor OTF progress

    def launch_otf(self):
        """ Launch OTF for a session. """
        otf = self.session['extra']['otf']
        otf_path = otf['path']
        workflow = otf.get('workflow', 'relion')

        if workflow == 'none':
            self.pl.logger.info('OTF workflow is None, so no doing anything.')
            return

        command = self.sconfig['otf'][workflow]['command']
        cmd = command.format(otf_path=otf_path, session_id=self.session['id'])
        self.pl.system(cmd + ' &')

    def run(self):
        sessionId = self.session['id']
        attrs = {"attrs": {"id": sessionId}}
        self.sconfig = self.manager.request_config('sessions')
        self.users = self.manager.request_data('get_session_users', attrs)['session_users']
        self.microscope = self.manager.resources[self.session['resource_id']]['name']
        taskName = self.task['name']
        logName = f"session_{self.session['id']}_{taskName}.log"
        self.create_logger(self.manager.logs_folder, logName)

        self.logger.info(f" > Starting Thread for Session {sessionId}, task '{taskName}'")

        def _handle_session(first):
            if taskName == 'raw':
                if first:
                    self.create_folders()
                self.update_raw()
            elif taskName == 'otf':
                self.update_otf()
            else:
                raise Exception('Unknown task ' + taskName)

        self.session_loop(_handle_session)


class SjSessionManager(SessionHandler):
    def __init__(self, debug=False):
        SessionHandler.__init__(self)

        self.debug = debug
        self._refresh = 30
        self._files = {}
        self._session_threads = {}
        self._scheduler = None
        self.logs_folder = os.path.expanduser('~/.emhub/sessions/logs')
        self.logger = None
        self.pl = None
        self.resources = []

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

    def stop_otf(self, session):
        otf_path = session['extra']['otf']['path']
        processes = Process.ps('relion', workingDir=otf_path)
        for folder, procs in processes.items():
            try:
                print(f"Killing processes for Session {session['id']}")
                for p in procs:
                    p.kill()
                session['extra']['otf']['status'] = 'stopped'
                self.update_session(session=session)
            except Exception as e:
                print(Color.red("Error: %s" % str(e)))

    def run(self):
        """ Check actions needed by this server """
        print(Color.green(f"Connected to server: {config.EMHUB_SERVER_URL}"))
        if not os.path.exists(self.logs_folder):
            Process.system(f"mkdir -p {self.logs_folder}")

        self.create_logger(self.logs_folder, "worker.log")
        self.resources = self.request_dict('get_resources',
                                           {"attrs": ["id", "name"]})
        first = True  # Send workers specs the first time
        threadsDict = {}
        while True:
            try:
                with open_client() as dc:
                    tasks = dc.get_session_tasks(specs=first)

                for t in tasks:
                    s = t["session"]
                    taskName = t['name']
                    sessionId = s['id']
                    self.logger.info(f"Got task {taskName} for session {sessionId}")
                    if taskName in ["raw", "otf"]:
                        if taskName == "otf" and t['stop']:
                            if thread := threadsDict.get((sessionId, 'otf'), None):
                                thread.stop()
                            self.stop_otf(s)
                            continue
                        threadKey = (sessionId, taskName)
                        if threadKey in threadsDict:
                            self.logger.error("Seems like a duplicate task!!!")
                        else:
                            threadsDict[threadKey] = SjSessionWorker(self, s, t, debug=False)
                            threadsDict[threadKey].start()

                first = False
                time.sleep(30)
            except Exception as e:
                self.logger.error("Some error happened: %s" % e)
                print("Waiting 60 seconds before retrying...")

            time.sleep(60)


if __name__ == '__main__':
    manager = SjSessionManager(debug=True)
    manager.run()
