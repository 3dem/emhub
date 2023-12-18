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

from emhub.client import open_client, config, DataClient


SESSIONS_DATA_FOLDER = os.environ.get('SESSIONS_DATA_FOLDER', None)


class SessionHandler:
    """ Class with base functionality used by the Worker thread and the
    main SessionManager.
    """
    def __init__(self):
        # Login into EMhub and keep a client instance
        self.dc = DataClient(server_url=config.EMHUB_SERVER_URL)
        self.dc.login(config.EMHUB_USER, config.EMHUB_PASSWORD)

    def __del__(self):
        self.dc.logout()

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
                        self.session = self.dc.get_session(self.session['id'])

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
        try:
            self.dc.update_session_extra({'id': session['id'], 'extra': extra})
            return True
        except Exception as e:
            self.logger.error(f"Error connecting to {config.EMHUB_SERVER_URL} "
                              f"to update session.")
            return False

    def request_data(self, endpoint, jsonData=None):
        return self.dc.request(endpoint, jsonData=jsonData).json()

    def request_dict(self, endpoint, jsonData=None):
        return {s['id']: s for s in self.request_data(endpoint, jsonData=jsonData)}

    def request_config(self, config):
        data = {'attrs': {'config': config}}
        return self.request_data('get_config', jsonData=data)['config']


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
            raw_path = raw['path'] = _mkdir(userRoot)
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
            possible_gains.sort(key=lambda g: os.path.getmtime(g))
            gain = possible_gains[-1]  # Use updated gain
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
        acq.update(self.session['acquisition'])
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

        opts = self.sconfig['otf']['scipion']['options']
        cryolo_model = otf.get('cryolo_model', None)

        if cryolo_model:
            model = os.path.basename(cryolo_model)
            os.symlink(cryolo_model, _path(model))
            opts['picking'] = {'cryolo_model': model}

        with open(_path('scipion_otf_options.json'), 'w') as f:
            opts['acquisition'] = acq
            json.dump(opts, f, indent=4)

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
        otf_path = extra['otf']['path']
        epuPath = os.path.join(otf_path, 'EPU')
        framesPath = raw['frames']
        rawPath = raw['path']

        now = datetime.now()
        td = timedelta(minutes=1)

        infoFile = self.logFile.replace('.log', '_info.json')

        if not hasattr(self, '_transfer_ed'):  # first time
            logger.info("NEW transfer info")
            self._transfer_ed = Path.ExtDict()
            self._transferred_files = set()
            if os.path.exists(infoFile):
                with open(infoFile) as f:
                    infoJson = json.load(f)
                    self._transfer_ed.update(infoJson['ed'])
            logger.info(f"Loading EPU.Data, framesPath: {framesPath}, epuPath: {epuPath}")
            self._epuData = EPU.Data(framesPath, epuPath)

        ed = self._transfer_ed
        epuData = self._epuData
        self._transfer_movies = []
        self._files_count = 0

        def _update():
            movies = self._transfer_movies
            self.logger.info(f"Found {len(movies)} new movies")
            if self._files_count > 0:
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
                with open(infoFile, 'w') as f:
                    json.dump({'ed': ed}, f)
                epuData.write()
                self.update_session_extra({'raw': raw})
            self._transfer_movies = []
            self._files_count = 0

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
                if now - dt >= td and srcFile not in self._transferred_files:
                    self._transferred_files.add(srcFile)
                    ed.register(srcFile, stat=s)
                    self._files_count += 1
                    # Register creation time of movie files
                    if f.endswith('fractions.tiff'):
                        self._transfer_movies.append((os.path.relpath(srcFile, framesPath), s))
                        # Only move now the movies files, not other metadata files
                        self.pl.system(f'rsync -ac --remove-source-files "{srcFile}" "{dstFile}"', retry=30)
                    else:  # Copy metadata files into the OTF/EPU folder
                        self.pl.system(f'cp "{srcFile}" "{dstFile}"', retry=30)
                        dstEpuFile = os.path.join(rootEpu, f)
                        # only backup gridsquares thumbnails and xml files
                        if f.endswith('.xml') or _gsThumb(f):
                            self.pl.system(f'cp "{srcFile}" "{dstEpuFile}"', retry=30)

            if self._files_count >= 32:  # make frequent updates to keep otf updated
                self.logger.info(f"Transferred {self._files_count} files.")
                _update()

        # Only sleep when no data was found
        self._sleep = 0 if self._transfer_movies else 60
        self.logger.info(f"Transferred {self._files_count} files.")
        _update()
        self.logger.info(f"Sleeping {self._sleep} seconds.")
        info = epuData.info()
        now = datetime.now()

        if 'last_movie_creation' in info:
            lastMovieDt = datetime.fromtimestamp(info['last_movie_creation'])
            lastMovieDays = (now - lastMovieDt).days
        else:
            lastMovieDays = None

        def _cleanUp():
            self.stop()
            sessionId = self.session['id']
            thread = self.manager.threadsDict.get((sessionId, 'otf'), None)
            self.manager.stop_otf(thread, self.session)
            self.dc.update_session({'id': sessionId, 'status': 'finished'})

            self.logger.info(f"OTF: {otf_path}, "
                             f"exists: {os.path.exists(otf_path)}, "
                             f"created: {otfCreation}, STOPPED")

            if os.path.exists(framesPath):
                self.logger.info(f"Deleting frames folder: {framesPath}")
                self.pl.system(f"rm -rf {framesPath}")

        if lastMovieDays:
            self.logger.info(f"Last movie: {lastMovieDt} ({lastMovieDays} days ago)")
            self.logger.info(f"Frames: {framesPath}, exists: {os.path.exists(framesPath)}")
            otfCreation = 'Unknown'
            if os.path.exists(otf_path):
                otfMt = datetime.fromtimestamp(os.path.getctime(os.path.join(otf_path, 'README.txt')))
                otfDays = (now - otfMt).days
                otfCreation = f"{otfDays} days ago"
                if otfDays:
                    # Both transfer and otf are done, so we can mark this session as finished
                    _cleanUp()
        else:
            lastFile = os.path.join(framesPath, 'ScreeningSession.dm')
            if os.path.exists(lastFile):
                lastFileDt = os.path.getmtime(lastFile)
                lastFileDays = (now - lastFileDt).days
                if lastFileDays > 3:
                    _cleanUp()


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
                                doBackup=True,
                                lastMovie=last_movie,
                                pl=self.pl)
        logger.info(f'Parsing took {timer.getToc()}')

        if last_movie != raw.get('last_movie', ''):
            raw['path'] = raw_path
            extra['raw'] = raw
            self.update_session_extra({'raw': raw})

        lastMovieDt = datetime.fromtimestamp(raw['last_movie_creation'])
        now = datetime.now()
        lastMovieDays = (now - lastMovieDt).days

        if lastMovieDays:
            self.logger.info(f"Last movie: {lastMovieDt} ({lastMovieDays} days ago)")
            maxDays = 1
            if lastMovieDays > maxDays:
                self.logger.info(f"STOPPING 'raw' task since last movie is "
                                 f"older than {maxDays} days")
                self.stop()

    def update_otf(self):
        extra = self.session['extra']
        raw = extra.get('raw', None)
        otf = extra['otf']
        otf_status = otf.get('status', '')

        if otf_status == 'created':  # check to launch otf
            # this is a protection in case OTF status does not update on time
            if not self._otf_launched:
                n = raw.get('movies', 0)
                launch_otf = n > 16
                if launch_otf:
                    otf['status'] = 'launched'
                    self.logger.info(f"Launching OTF after {n} input movies .")
                    self.launch_otf()
                    self.update_session_extra({'otf': otf})
                    self._otf_launched = True
                    self._update_session = False  # we don't need to check raw anymore
                else:
                    self.logger.info(f"OTF: folder already CREATED, "
                                     f"input movies {n}."
                                     f"Waiting for more movies")

        elif otf_status in ['launched', 'running']:
            pass  # FIXME: monitor OTF progress

    def launch_otf(self):
        """ Launch OTF for a session. """
        self.logger.info(f"Notifying launch of OTF, self: {self}")
        manager.notify_launch_otf(self)

        otf = self.session['extra']['otf']
        otf_path = otf['path']
        workflow = otf.get('workflow', 'default')
        if workflow == 'default':
            workflow = self.sconfig['otf']['workflow']['default']
        elif workflow == 'none':
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

        self.logger.info(f" > Working on Session {sessionId}, Task '{taskName}' ({self})")

        if taskName in ['transfer', 'raw']:
            self.create_folders()
            self._update_session = False

        def _handle_session(first):
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

    def print(self, *args):
        if self.verbose:
            print(*args)

    def stop_otf(self, thread, session):
        """ Stop the thread that is doing OTF and all subprocess.
        Also update the internal dictionary of threads-sessions-tasks
        """
        if thread:
            thread.stop()
            del self.threadsDict[(session['id'], 'otf')]

        otf = session['extra']['otf']
        processes = Process.ps('', workingDir=otf['path'])
        for folder, procs in processes.items():
            try:
                self.logger.info(f"Killing processes for Session {session['id']}")
                for p in procs:
                    p.kill()
                otf['status'] = 'stopped'
                self.update_session_extra({'otf': otf}, session=session)
            except Exception as e:
                self.logger.error(Color.red("Error: %s" % str(e)))

    def notify_launch_otf(self, thread):
        """ Through this method a thread notifies that is launching OTF.
        Then, if there is any other OTF running, we must stop it.
        """
        self.logger.info(f"Thread  {thread} notified OTF launch")
        threadKey = (thread.session['id'], 'otf')
        threadItems = list(self.threadsDict.items())
        for (sessionId, threadTask), thread2 in threadItems:
            if threadTask == 'otf' and thread != thread2:
                self.logger.info(f"Stopping thread  {thread2}.")
                self.stop_otf(thread2, thread2.session)

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
        self.threadsDict = threadsDict = {}

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
                    # DEPRECATED
                    tasks = dc.get_session_tasks(specs=first)

                for t in tasks:
                    s = t["session"]
                    taskInfo = dict(t)
                    del taskInfo['session']

                    taskName = t['name']
                    sessionId = s['id']
                    self.logger.info(f"Got task {taskInfo} (session {sessionId})")
                    if taskName in ["raw", "otf", "transfer"]:
                        if taskName == "otf" and (t['create'] or t['stop']):
                            thread = threadsDict.get((sessionId, 'otf'), None)
                            self.stop_otf(thread, s)
                            if not t['create']:  # restart case
                                continue

                        threadKey = (sessionId, taskName)
                        if threadKey in threadsDict:
                            self.logger.error("Seems like a duplicate task!!!")
                            continue

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
                self.logger.error("Waiting 60 seconds before retrying...")
                time.sleep(60)


if __name__ == '__main__':
    manager = SjSessionManager(debug=True)
    manager.run()
