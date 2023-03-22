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
import json
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
        self.logFile = os.path.join(logsFolder, logName)
        handler = logging.FileHandler(self.logFile)
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
                    time.sleep(self._sleep)
                    if self._stopEvent.is_set():
                        self.logger.info("Stopping worker thread.")
                        break
                    if self._update_session:
                        with open_client() as dc:
                            self.session = dc.get_session(self.session['id'])

                session_func(first)

            except Exception as e:
                self.logger.error('FATAL ERROR: ' + str(e))
                self.logger.error(traceback.format_exc())
            first = False

    def update_session_extra(self, extra, session=None):
        if session is None:
            self.logger.info("Session is None, using self")
            session = self.session
        self.logger.info(f"Updating session {session['name']}")
        extra['updated'] = Pretty.now()
        with open_client() as dc:
            dc.update_session_extra({'id': session['id'], 'extra': extra})


class SjSessionWorker(threading.Thread, SessionHandler):
    def __init__(self, manager, task, debug):
        threading.Thread.__init__(self)
        SessionHandler.__init__(self)
        self.manager = manager
        self.session = task['session']
        self.logger = None
        self.logFile = None
        self.pl = None
        self.task = task
        self.debug = debug
        self._otf_launched = False
        self._stopEvent = threading.Event()
        self._update_session = True
        self._sleep = 60

    def stop(self):
        self._stopEvent.set()

    def get_folder_name(self):
        """ Unique folder based on session info. """
        date_ts = Pretty.now()  # Fixme Maybe use first file creation (for old sessions)
        date = date_ts.split()[0].replace('-', '')
        name = self.session['name']
        return f"{date}_{self.microscope}_{name}"

    def create_folders(self):
        extra = self.session['extra']
        raw = extra.get('raw', None)
        otf = extra['otf']

        if raw is None:
            raise Exception("Missing 'raw' from session")

        raw_path = raw.get('path', '')
        if not raw_path:
            session_folder = self.get_folder_name()

            def _mkdir(root):
                folderPath = os.path.join(root, session_folder)
                self.pl.system(f"mkdir -p {folderPath}")
                return folderPath

            raw['frames'] = _mkdir(self.sconfig['raw']['root_frames'])
            rawRoot = self.sconfig['raw']['root']
            parts = self.users['owner']['email'].split('@')[0].split('.')
            userFolder = parts[0][0] + parts[1]
            userRoot = os.path.join(rawRoot,
                                    self.users['group'],
                                    self.microscope, str(datetime.now().year),
                                    'raw', 'EPU', userFolder)
            raw_path = raw['path'] = _mkdir(userRoot)  # FIXME: Add rules of Year/Scope/Group/User
            self.update_session_extra({'raw': raw})

        if not os.path.exists(raw_path):
            raise Exception("Missing raw_path")

        otf_path = otf.get('path', '')
        otf_exists = os.path.exists(otf_path)

        if not otf_exists or self.task.get('create', False):
            self.logger.info(f'OTF folder does not exists, creating one')
            self.create_otf_folder()

    def create_otf_folder(self):
        extra = self.session['extra']
        otf = extra['otf']
        raw_path = extra['raw']['path']

        otf_folder = self.get_folder_name() + '_OTF'
        otf_root = self.sconfig['otf']['root']
        otf_path = os.path.join(otf_root, otf_folder)
        otf.update({'path': otf_path, 'status': 'created'})
        self.pl.system(f"rm -rf {otf_path}")

        def _path(*paths):
            return os.path.join(otf_path, *paths)

        self.pl.system(f"mkdir {otf_path}")
        self.pl.system(f"mkdir {otf_path}/EPU")

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

        # Update OTF status
        self.update_session_extra({'otf': otf})

    def transfer_files(self):
        """ Move files from the Raw folder to the Offload folder.
        Files will be moved when there has been a time without modification
        (file's timeout).
        """
        extra = self.session['extra']
        logger = self.logger
        raw = extra['raw']
        epuPath = os.path.join(extra['otf']['path'], 'EPU')
        framesPath = raw['frames']
        rawPath = raw['path']

        now = datetime.now()
        td = timedelta(minutes=1)

        infoFile = self.logFile.replace('.log', '_info.json')

        if not hasattr(self, '_transfer_ed'):  # first time
            # FIXME When restarting the server, load ed from previous values
            logger.info("NEW transfer info")
            self._transfer_ed = Path.ExtDict()
            if os.path.exists(infoFile):
                with open(infoFile) as f:
                    infoJson = json.load(f)
                    self._transfer_ed.update(infoJson['ed'])
            self._epuData = EPU.Data(framesPath, epuPath)

        ed = self._transfer_ed
        epuData = self._epuData
        self._transfer_movies = []

        def _update():
            movies = self._transfer_movies
            self.logger.info(f"Found {len(movies)} new movies")
            if movies:
                movies.sort(key=lambda m: m[1])  # sort by time
                for movie in movies:
                    epuData.addMovie(*movie)
                info = epuData.info()
                info.update({
                    'size': ed.total_size,
                    'sizeH': Pretty.size(ed.total_size),
                    'files': ed
                })
                raw.update(info)
                logger.info(f"AFTER - info: {raw['movies']}")
                with open(infoFile, 'w') as f:
                    json.dump({'ed': ed}, f)
                epuData.write()
                self.update_session_extra({'raw': raw})
            self._transfer_movies = []

        def _mkdir(root, folder):
            folderPath = os.path.join(root, folder)
            if not os.path.exists(folderPath):
                self.pl.system(f"mkdir {folderPath}")

        def _gsThumb(f):
            return f.startswith('GridSquare') and f.endswith('.jpg')

        for root, dirs, files in os.walk(framesPath):
            rootRaw = root.replace(framesPath, rawPath)
            rootEpu = root.replace(framesPath, epuPath)
            for d in dirs:
                _mkdir(rootRaw, d)
                _mkdir(rootEpu, d)
            for f in files:
                srcFile = os.path.join(root, f)
                dstFile = os.path.join(rootRaw, f)
                s = os.stat(srcFile)
                dt = datetime.fromtimestamp(s.st_mtime)
                if now - dt >= td:
                    ed.register(srcFile, stat=s)
                    # Register creation time of movie files
                    if f.endswith('fractions.tiff'):
                        self._transfer_movies.append((os.path.relpath(srcFile, framesPath), s))
                    else:  # Copy metadata files into the OTF/EPU folder
                        dstEpuFile = os.path.join(rootEpu, f)
                        # only backup gridsquares thumbnails and xml files
                        if f.endswith('.xml') or _gsThumb(f):
                            self.pl.system(f'cp {srcFile} {dstEpuFile}')
                    self.pl.system(f'rsync -ac --remove-source-files {srcFile} {dstFile}')

            if len(self._transfer_movies) >= 32:  # make frequent updates to keep otf updated
                _update()

        # Only sleep when no data was found
        self._sleep = 0 if self._transfer_movies else 60
        _update()
        self.logger.info(f"Sleeping {self._sleep} seconds.")

    def update_raw(self):
        extra = self.session['extra']
        self._update_session = False
        raw = extra['raw']
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
            self.update_session_extra({'raw': raw})

    def update_otf(self):
        extra = self.session['extra']
        raw = extra.get('raw', None)
        otf = extra['otf']
        otf_status = otf.get('status', '')

        if otf_status == 'created':  # check to launch otf
            # this is a protection in case OTF status does not update on time
            if not self._otf_launched:
                n = raw['movies']
                launch_otf = n > 16
                if launch_otf:
                    otf['status'] = 'launched'
                    self.logger.info(f"Launching OTF after {raw['movies']} input movies .")
                    self.launch_otf()
                    self.update_session_extra({'otf': otf})
                    self._otf_launched = True
                    self._update_session = False  # we don't need to check raw anymore
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

        if taskName in ['transfer', 'raw']:
            self.create_folders()
            self._update_session = False

        def _handle_session(first):
            self.logger.info("Task name '%s', equal: %s" % (taskName, taskName == 'transfer'))
            if taskName == 'transfer':
                self.transfer_files()
            elif taskName == 'raw':
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
        otf = session['extra']['otf']
        processes = Process.ps('relion', workingDir=otf['path'])
        for folder, procs in processes.items():
            try:
                print(f"Killing processes for Session {session['id']}")
                for p in procs:
                    p.kill()
                otf['status'] = 'stopped'
                self.update_session_extra({'otf': otf}, session=session)
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
        status_file = os.path.join(self.logs_folder, 'worker-status.json')
        self.logger.info("Status file: %s" % status_file)

        first = True  # Send workers specs the first time
        threadsDict = {}

        # Reload previously active threads if the worker restarted
        if os.path.exists(status_file):
            with open(status_file) as f:
                for sessionId, taskName in json.load(f):
                    with open_client() as dc:
                        session = dc.get_session(sessionId)
                        task = {"name": taskName, "session": session}
                        self.logger.info(f"Relaunching thread for task {taskName}"
                                         f" (session {sessionId})")
                        threadKey = sessionId, taskName
                        threadsDict[threadKey] = SjSessionWorker(self, task, debug=False)
                        threadsDict[threadKey].start()

        while True:
            try:
                with open_client() as dc:
                    tasks = dc.get_session_tasks(specs=first)

                for t in tasks:
                    s = t["session"]
                    taskName = t['name']
                    sessionId = s['id']
                    self.logger.info(f"Got task {taskName} (session {sessionId})")
                    if taskName in ["raw", "otf", "transfer"]:
                        if taskName == "otf" and t['stop']:
                            # Check if there is a stop command
                            if thread := threadsDict.get((sessionId, 'otf'), None):
                                thread.stop()
                                del threadsDict[(sessionId, 'otf')]
                            self.stop_otf(s)
                            continue

                        threadKey = (sessionId, taskName)
                        if threadKey in threadsDict:
                            self.logger.error("Seems like a duplicate task!!!")
                            continue

                        # If OTF, check if we need to stop other OTFs
                        if taskName == 'otf':
                            threadItems = list(threadsDict.items())
                            for (sessionId, threadTask), thread in threadItems:
                                if threadTask == 'otf':
                                    thread.stop()
                                    self.stop_otf(thread.session)
                                    del threadsDict[(sessionId, 'otf')]

                        threadsDict[threadKey] = SjSessionWorker(self, t, debug=False)
                        threadsDict[threadKey].start()

                first = False
                # Update and store current working threads
                not_active = [k for k, thread in threadsDict.items()
                              if not thread.is_alive()]
                for k in not_active:
                    del threadsDict[k]

                with open(status_file, 'w') as f:
                    json.dump([k for k in threadsDict.keys()], f)

                time.sleep(30)

            except Exception as e:
                self.logger.error("Some error happened: %s" % e)
                print("Waiting 60 seconds before retrying...")


if __name__ == '__main__':
    manager = SjSessionManager(debug=True)
    manager.run()
