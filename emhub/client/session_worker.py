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

from emtools.utils import Pretty, Process, Path, Color, System
from emtools.metadata import EPU, MovieFiles, StarFile

from emhub.client import config
from emhub.client.worker import (TaskHandler, DefaultTaskHandler, CmdTaskHandler,
                                 Worker)


class SessionTaskHandler(TaskHandler):
    def __init__(self, *args, **kwargs):
        TaskHandler.__init__(self, *args, **kwargs)
        self.mf = None
        self.epu_session = None  # for EPU parsing during OTF
        self.dc = self.worker.dc
        self.update_session = False

        targs = self.task['args']
        self.session_id = int(targs['session_id'])
        self.action = targs.get('action', 'Empty-Action')

        self.get_session()
        self.logger.info("Getting config from EMhub.")
        attrs = {"attrs": {"id": self.session['id']}}
        self.sconfig = self.request_config('sessions')
        session_users = self.request_data('get_session_users', attrs)
        self.users = session_users.get('session_users', None)
        self.resources = self.request_dict('get_resources',
                                           {"attrs": ["id", "name"]})
        self.microscope = self.resources[self.session['resource_id']]['name']

        self.sleep = targs.get('sleep', 60)

        self.logger.info(f">>> Handling task for session {self.session_id}")
        self.logger.info(f"\t action: {self.action}")
        self.logger.info(f"\t   args: {targs}")

    def process(self):
        if self.users is None:
            raise Exception("Could not retrieve users information for this session")

        func = getattr(self, self.action, None)
        if func is None:
            return self.unknown_action()

        func()
        if self.update_session:
            # Update session information
            self.session = self.get_session()

    def getLogPrefix(self):
        prefix = self.task['args']['action'].upper()
        return f"{prefix}-{self.task['args']['session_id']}"

    def _request(self, requestFunc, errorMsg, tries=10):
        """ Make a request to the server, trying many times if it fails. """
        wait = 5  # Initial wait for 5 seconds and increment it until max 60
        while tries:
            tries -= 1
            try:
                return requestFunc()
            except Exception as e:
                retryMsg = f"Waiting {wait} seconds to retry." if tries else 'Not trying anymore.'
                self.logger.error(f"ERROR {errorMsg}. {retryMsg}")
                time.sleep(wait)
                wait = min(60, wait * 2)

        return None

    def update_session_extra(self, extra):
        def _update_extra():
            extra['updated'] = Pretty.now()
            self.dc.update_session_extra({'id': self.session['id'], 'extra': extra})
            return True

        return self.request(_update_extra, 'updating session extra')

    def get_session(self, tries=10):
        """ Retrieve session info to update local data. """
        def _get_session():
            self.logger.info(f"Retrieving session {self.session_id} from EMhub "
                             f"({config.EMHUB_SERVER_URL})")
            return self.dc.get_session(self.session_id)

        errorMsg = f"retrieving session {self.session_id} info."
        session = self._request(_get_session, errorMsg)

        if session:
            return session

        error = f"Could not retrieve session {self.session_id} after {tries} attempts."
        self.logger.error(error)
        raise Exception(error)

    def request_data(self, endpoint, jsonData=None):
        def _get_data():
            return self.dc.request(endpoint, jsonData=jsonData).json()

        errorMsg = f"retrieving data from endpoint: {endpoint}"
        return self._request(_get_data, errorMsg)

    def request_dict(self, endpoint, jsonData=None):
        return {s['id']: s for s in self.request_data(endpoint, jsonData=jsonData)}

    def request_config(self, config):
        data = {'attrs': {'config': config}}
        return self.request_data('get_config', jsonData=data)['config']

    def unknown_action(self):
        self.update_task({
            'error': f'Unknown action {self.action}',
            'done': 1
        })
        self.stop()

    def monitor(self):
        extra = self.session['extra']
        raw = extra['raw']
        # If repeat != 0, then repeat the scanning this number of times
        repeat = self.task['args'].get('repeat', 0)

        print(Color.bold(f"session_id = {self.session['id']}, monitoring files..."))
        print(f"    path: {raw['path']}")

        if self.count == 1:
            self.mf = MovieFiles()

        self.mf.scan(raw['path'])
        update_args = self.mf.info()
        raw.update(update_args)
        self.update_session_extra({'raw': raw})

        if repeat and self.count == repeat:
            self.stop()
            update_args['done'] = 1

        # Remove dict from the task update
        del update_args['files']
        self.update_task(update_args)

    def get_frames_path(self):
        """ Unique folder based on session info. """
        date_ts = Pretty.now()  # Fixme Maybe use first file creation (for old sessions)
        date = date_ts.split()[0].replace('-', '')
        name = self.session['name']
        return os.path.join(self.sconfig['raw']['root_frames'],
                            f"{date}_{self.microscope}_{name}")

    def transfer(self):
        """ Move files from the Raw folder to the Offload folder.
        Files will be moved when there has been a time without modification
        (file's timeout).
        """
        extra = self.session['extra']
        logger = self.logger
        raw = extra['raw']

        # Real raw path where frames are being recorded
        framesPath = Path.rmslash(raw.get('frames', '')) or self.get_frames_path()
        parts = self.users['owner']['email'].split('@')[0].split('.')
        userFolder = parts[0][0] + parts[1]
        rawRoot = self.sconfig['raw']['root']
        # Offload server path where to transfer the files
        rawPath = os.path.join(rawRoot, self.users['group'], self.microscope,
                                      str(datetime.now().year), 'raw', 'EPU',
                                      userFolder, os.path.basename(framesPath))
        framesPath = Path.addslash(framesPath)
        rawPath = Path.addslash(rawPath)

        #  First time the process function is called for this execution
        if self.count == 1:
            self.logger.info(f"Monitoring FRAMES FOLDER: {framesPath}")
            self.logger.info(f"Offloading to RAW FOLDER: {rawPath}")

            # JMRT 2023/11/08 We are not longer creating the Frames path because
            # new version of EPU requires that the folder does not exist for
            # starting a new session
            #self.pl.mkdir(framesPath)

            raw['frames'] = framesPath
            self.mf = MovieFiles(root=rawPath)

            if os.path.exists(rawPath):
                logger.info("Restarting transfer task, loading transferred files.")
                self.mf.scan(rawPath)
                raw.update(self.mf.info())
            else:
                logger.info("Starting transfer task")
                self.pl.mkdir(rawPath)
                raw['path'] = rawPath

            self.update_session_extra({'raw': raw})

        mf = self.mf  # shortcut

        self.n_files = 0
        self.n_movies = 0

        def _update():
            self.logger.info(f"Found {self.n_files} new files, "
                             f"{self.n_movies} new movies")
            if self.n_files > 0:
                raw.update(mf.info())
                self.update_session_extra({'raw': raw})
                # Remove dict from the task update
                self.update_task({'new_files': self.n_files,
                                  'new_movies': self.n_movies,
                                  'total_files': mf.total_files,
                                  'total_movies': mf.total_movies
                                  })
            self.n_files = 0
            self.n_movies = 0

        def _gsThumb(f):
            return f.startswith('GridSquare') and f.endswith('.jpg')

        now = datetime.now()
        td = timedelta(minutes=1)
        transferred = False

        self.logger.info(f"Scanning framesPath: {framesPath}")
        for root, dirs, files in os.walk(framesPath):
            rootRaw = root.replace(framesPath, rawPath)
            for d in dirs:
                self.pl.mkdir(os.path.join(rootRaw, d))
            for f in files:
                srcFile = os.path.join(root, f)
                dstFile = os.path.join(rootRaw, f)
                s = os.stat(srcFile)
                dt = datetime.fromtimestamp(s.st_mtime)

                if now - dt >= td and dstFile not in mf:
                    mf.register(dstFile, stat=s)
                    transferred = True
                    self.n_files += 1
                    # Register creation time of movie files
                    if f.endswith('fractions.tiff'):
                        self.n_movies += 1
                        # Only move now the movies files, not other metadata files
                        self.pl.system(f'rsync -ac --remove-source-files "{srcFile}" "{dstFile}"', retry=30)
                    else:  # Copy metadata files
                        self.pl.cp(srcFile, dstFile, retry=30)

                if self.n_files >= 32:  # make frequent updates to keep otf updated
                    _update()

        # Only sleep when no data was found
        self.sleep = 0 if transferred else 60
        _update()
        self.logger.info(f"Sleeping {self.sleep} seconds.")

        # FIXME
        # Implement cleanup

    def stop_all_otf(self, done=False):
        self.logger.info("Stopping all OTF tasks.")
        stopped = self.worker.notify_launch_otf(self.task)
        self.logger.info(f"Stopped: {stopped}")
        event = {'stopped_tasks': json.dumps(stopped)}
        if done:
            event['done'] = 1
            self.stop()
        self.update_task(event)

    def get_path_from(self, pathDict, referencePath, root, suffix=''):
        path = pathDict.get('path', None)
        if not path:
            folder = os.path.basename(Path.rmslash(referencePath)) + suffix
            path = os.path.join(root, folder)
        return path

    def otf(self):
        extra = self.session['extra']
        raw = extra['raw']
        self.update_session = True  # update session to check for new images

        # Stop all OTF tasks running in this worker
        if 'stop' in self.task['args']:
            self.stop_all_otf(done=True)

        clear = 'clear' in self.task['args']

        if clear and self.count == 1:
            self.stop_all_otf(done=False)

        try:
            n = raw.get('movies', 0)

            raw_path = raw.get('path', '')
            # logger = self.logger
            otf = extra['otf']
            otf_path = self.get_path_from(otf, raw_path, self.sconfig['otf']['root'],
                                          suffix='_OTF')

            self.logger.info(f"OTF path: {otf_path}, do clear: {clear}, movies: {n}")

            if os.path.exists(raw_path) and os.path.exists(otf_path):
                epuFolder = os.path.join(otf_path, 'EPU')
                epuStar = os.path.join(epuFolder, 'movies.star')

                if self.epu_session is None:
                    self.epu_session = EPU.Session(raw_path,
                                                   outputStar=epuStar,
                                                   backupFolder=epuFolder,
                                                   pl=self.pl)
                self.epu_session.scan()
                if not os.path.exists(epuFolder):
                    self.logger.info(f"File {epuStar} does not exist yet.")
                else:
                    with StarFile(epuStar) as sf:
                        self.logger.info(f"Scanned EPU folder, "
                                         f"movies: {sf.getTableSize('Movies')}")

            if not os.path.exists(otf_path) or clear:
                # OTF is not running, let's check if we need to launch it
                if raw_path and n > 16:
                    self.logger.info(f"Launching OTF after {n} images found.")
                    self.worker.notify_launch_otf(self.task)
                    self.create_otf_folder(otf_path)
                    self.launch_otf()
                    self.update_task({'otf_path': otf['path'],
                                      'otf_status': otf['status'],
                                      'count': self.count})
                    self.update_session = False  # after launching no need to update
            else:
                self.update_task({'count': self.count})
        except Exception as e:
            self.logger.exception(e)
            self.update_task({
                'error': f'Exception {str(e)}',
                'done': 1
            })
            self.stop()

    def create_otf_folder(self, otf_path):
        extra = self.session['extra']
        raw_path = extra['raw']['path']
        otf = extra['otf']
        otf.update({'path': otf_path, 'status': 'created'})
        self.pl.rm(otf_path)

        def _path(*paths):
            return os.path.join(otf_path, *paths)

        self.pl.mkdir(os.path.join(otf_path, 'EPU'))
        os.symlink(raw_path, _path('data'))

        gain_pattern = self.sconfig['data']['gain']
        possible_gains = glob(gain_pattern.format(microscope=self.microscope))
        if possible_gains:
            possible_gains.sort(key=lambda g: os.path.getmtime(g))
            gain = possible_gains[-1]  # Use updated gain
            real_gain = os.path.realpath(gain)
            base_gain = os.path.basename(real_gain)
            self.pl.cp(real_gain, _path(base_gain))
            os.symlink(base_gain, _path('gain.mrc'))

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
            'images': 'data/Images-Disc*/GridSquare_*/Data/Foil*fractions.tiff',
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

    def launch_otf(self):
        """ Launch OTF for a session. """
        self.logger.info(f"Running OTF")
        otf = self.session['extra']['otf']
        otf_path = otf['path']
        workflow = otf.get('workflow', '')
        if workflow == 'none':
            msg = 'OTF workflow is None, so no doing anything.'
            self.pl.logger.info(msg)
            self.update_task({'msg': msg, 'done': 1})
            self.stop()
        else:
            workflow_conf = self.sconfig['otf'].get(workflow, None)
            if not workflow_conf:
                raise Exception(f"Missing workflow '{workflow}' from "
                                f"sessions::config OTF section. ")

            command = workflow_conf['command']
            cmd = command.format(otf_path=otf_path, session_id=self.session['id'])
            self.pl.system(cmd + ' &')

    def stop_otf(self):
        """ Stop the thread that is doing OTF and all subprocess.
        Also update the internal dictionary of threads-sessions-tasks
        """
        self.stop()
        otf = self.session['extra']['otf']
        otf_path = otf.get('path', '')
        try:
            if otf_path:
                processes = Process.ps('scipion', workingDir=otf['path'], children=True)
                for folder, procs in processes.items():
                    self.logger.info(f"Killing processes for Session {self.session['id']}")
                    for p in procs:
                        p.kill()
            otf['status'] = 'stopped'
            self.update_session_extra({'otf': otf})
        except Exception as e:
            self.logger.error(Color.red("Error: %s" % str(e)))
        self.update_task({'msg': 'Forced to stop ', 'done': 1})


class SessionWorker(Worker):
    def handle_tasks(self, tasks):
        for t in tasks:
            if t['name'] == 'command':
                handler = CmdTaskHandler(self, t)
            elif t['name'] == 'session':
                handler = SessionTaskHandler(self, t)
            else:
                handler = DefaultTaskHandler(self, t)
            handler.start()

    def notify_launch_otf(self, task):
        """ This method should be called from tasks handlers to notify
        that a OTF is going ot be launched. Then, we must stop any other
        OTF tasks running in this host. (only one OTF running per host)
        """
        task_id = task['id']
        self.logger.info(f"Task handler {task_id} notified launching OTF")
        stopped = []
        for k, v in self.tasks.items():
            t = v.task
            if t['id'] != task_id and t['name'] == 'session' and t['args']['action'] == 'otf':
                v.stop_otf()
                stopped.append(t['id'])
        return stopped


if __name__ == '__main__':
    worker = SessionWorker(debug=True)
    worker.run()
