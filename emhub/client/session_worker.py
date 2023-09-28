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
from emtools.metadata import EPU, MovieFiles

from emhub.client import config
from emhub.client.worker import (TaskHandler, DefaultTaskHandler, CmdTaskHandler,
                                 Worker)


class SessionTaskHandler(TaskHandler):
    def __init__(self, *args, **kwargs):
        TaskHandler.__init__(self, *args, **kwargs)
        self.mf = None
        self.dc = self.worker.dc

        targs = self.task['args']
        session_id = targs['session_id']
        self.action = targs.get('action', 'Empty-Action')

        self.logger.info("Getting config and session data from EMhub.")
        self.session = self.dc.get_session(session_id)
        attrs = {"attrs": {"id": self.session['id']}}
        self.sconfig = self.request_config('sessions')
        self.users = self.request_data('get_session_users', attrs)['session_users']
        self.resources = self.request_dict('get_resources',
                                           {"attrs": ["id", "name"]})
        self.microscope = self.resources[self.session['resource_id']]['name']

        self.sleep = targs.get('sleep', 60)

        print(Color.bold(f">>> Handling task for session {self.session['id']}"))
        print(f"\t action: {self.action}")
        print(f"\t   args: {targs}")

        if self.action == 'transfer':
            self.process = self.transfer_files
        elif self.action == 'monitor':
            self.process = self.monitor_files
        elif self.action == 'otf':
            self.process = self.otf
        else:
            self.process = self.unknown_action

    def update_session_extra(self, extra):
        extra['updated'] = Pretty.now()
        try:
            self.dc.update_session_extra({'id': self.session['id'], 'extra': extra})
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

    def unknown_action(self):
        self.update_task({
            'error': f'Unknown action {self.action}',
            'done': 1
        })
        self.stop()

    def monitor_files(self):
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
        pprint(update_args)
        del update_args['files']
        self.update_task(update_args)

    def _mkdir(self, d):
        if not os.path.exists(d):
            self.pl.system(f"mkdir -p '{d}'")

    def _cp(self, src, dst, **kwargs):
        self.pl.system(f"cp '{src}' '{dst}'", **kwargs)

    def _addslash(self, p):
        return p if p.endswith('/') else p + '/'

    def _rmslash(self, p):
        return p[:-1] if p.endswith('/') else p

    def transfer_files(self):
        """ Move files from the Raw folder to the Offload folder.
        Files will be moved when there has been a time without modification
        (file's timeout).
        """
        extra = self.session['extra']
        logger = self.logger
        raw = extra['raw']

        # Real raw path where frames are being recorded
        framesPath = self._addslash(raw['frames'])

        # Offload server path where to transfer the files
        rawPath = self._addslash(raw['path'])

        #  First time the process function is called for this execution
        if self.count == 1:
            self._mkdir(framesPath)
            self.mf = MovieFiles(root=rawPath)

            if os.path.exists(rawPath):
                logger.info("Restarting transfer task, loading transferred files.")
                self.mf.scan(rawPath)
                pprint(self.mf.info())
                raw.update(self.mf.info())
                self.update_session_extra({'raw': raw})
            else:
                logger.info("Starting transfer task")
                self._mkdir(rawPath)

        mf = self.mf  # shortcut

        self.n_files = 0
        self.n_movies = 0

        def _update():
            self.logger.info(f"Found {self.n_files} new files, "
                             f"{self.n_movies} new movies")
            if self.n_files > 0:
                pprint(mf.info())
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

        for root, dirs, files in os.walk(framesPath):
            rootRaw = root.replace(framesPath, rawPath)
            # rootEpu = root.replace(framesPath, epuPath)
            for d in dirs:
                _mkdir(rootRaw, d)
                # _mkdir(rootEpu, d)
            for f in files:
                srcFile = os.path.join(root, f)
                dstFile = os.path.join(rootRaw, f)
                s = os.stat(srcFile)
                dt = datetime.fromtimestamp(s.st_mtime)
                if now - dt >= td and dstFile not in mf:
                    mf.register(dstFile, stat=s)
                    transferred = True
                    self.n_files += 1
                    time.sleep(1)
                    # Register creation time of movie files
                    if f.endswith('fractions.tiff'):
                        self.n_movies += 1
                        # Only move now the movies files, not other metadata files
                        self.pl.system(f'rsync -ac --remove-source-files "{srcFile}" "{dstFile}"', retry=30)
                    else:  # Copy metadata files
                        self._cp(srcFile, dstFile, retry=30)

                if self.n_files >= 32:  # make frequent updates to keep otf updated
                    _update()

        # Only sleep when no data was found
        self.sleep = 0 if transferred else 60
        _update()
        self.logger.info(f"Sleeping {self.sleep} seconds.")

        # FIXME
        # Implement cleanup


        # now = datetime.now()
        #
        # if 'last_movie_creation' in info:
        #     lastMovieDt = datetime.fromtimestamp(info['last_movie_creation'])
        #     lastMovieDays = (now - lastMovieDt).days
        # else:
        #     lastMovieDays = None


        #
        # def _cleanUp():
        #     self.stop()
        #     sessionId = self.session['id']
        #     thread = self.manager.threadsDict.get((sessionId, 'otf'), None)
        #     self.manager.stop_otf(thread, self.session)
        #     self.dc.update_session({'id': sessionId, 'status': 'finished'})
        #
        #     self.logger.info(f"OTF: {otf_path}, "
        #                      f"exists: {os.path.exists(otf_path)}, "
        #                      f"created: {otfCreation}, STOPPED")
        #
        #     if os.path.exists(framesPath):
        #         self.logger.info(f"Deleting frames folder: {framesPath}")
        #         self.pl.system(f"rm -rf {framesPath}")
        #
        # if lastMovieDays:
        #     self.logger.info(f"Last movie: {lastMovieDt} ({lastMovieDays} days ago)")
        #     self.logger.info(f"Frames: {framesPath}, exists: {os.path.exists(framesPath)}")
        #     otfCreation = 'Unknown'
        #     if os.path.exists(otf_path):
        #         otfMt = datetime.fromtimestamp(os.path.getctime(os.path.join(otf_path, 'README.txt')))
        #         otfDays = (now - otfMt).days
        #         otfCreation = f"{otfDays} days ago"
        #         if otfDays:
        #             # Both transfer and otf are done, so we can mark this session as finished
        #             _cleanUp()
        # else:
        #     lastFile = os.path.join(framesPath, 'ScreeningSession.dm')
        #     if os.path.exists(lastFile):
        #         lastFileDt = os.path.getmtime(lastFile)
        #         lastFileDays = (now - lastFileDt).days
        #         if lastFileDays > 3:
        #             _cleanUp()

    def otf(self):
        # Stop all OTF tasks running in this worker
        if 'stop' in self.task['args']:
            self.logger.info("Stopping all OTF tasks.")
            stopped = self.worker.notify_launch_otf(self.task)
            self.logger.info(f"Stopped: {stopped}")
            self.update_task({
                'stopped_tasks': json.dumps(stopped),
                'done': 1
            })
            self.stop()
            return

        extra = self.session['extra']
        # logger = self.logger
        # raw = extra['raw']
        otf = extra['otf']
        # otf_path = otf['path']

        # if not self.launched:
        #     n = raw.get('movies', 0)
        #     if n > 16:
        #         pass

        try:
            if self.count == 1:
                self.worker.notify_launch_otf(self.task)
                self.create_otf_folder()
                self.launch_otf()
                self.update_task({'otf_path': otf['path'],
                                  'otf_status': otf['status'],
                                  'count': self.count})
            else:
                self.update_task({'count': self.count})
        except Exception as e:
            self.logger.error(str(e))
            self.logger.exception(e)
            self.update_task({
                'error': f'Exception {str(e)}',
                'done': 1
            })
            self.stop()

    def create_otf_folder(self):
        extra = self.session['extra']
        otf = extra['otf']
        raw_path = extra['raw']['path']
        otf_folder = os.path.basename(self._rmslash(raw_path)) + '_OTF'
        otf_root = self.sconfig['otf']['root']
        otf_path = os.path.join(otf_root, otf_folder)
        otf.update({'path': otf_path, 'status': 'created'})
        self.pl.system(f"rm -rf '{otf_path}'")

        def _path(*paths):
            return os.path.join(otf_path, *paths)

        self._mkdir(os.path.join(otf_path, 'EPU'))
        os.symlink(raw_path, _path('data'))

        gain_pattern = self.sconfig['data']['gain']
        possible_gains = glob(gain_pattern.format(microscope=self.microscope))
        if possible_gains:
            possible_gains.sort(key=lambda g: os.path.getmtime(g))
            gain = possible_gains[-1]  # Use updated gain
            real_gain = os.path.realpath(gain)
            base_gain = os.path.basename(real_gain)
            self._cp(real_gain, _path(base_gain))
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

    def launch_otf(self):
        """ Launch OTF for a session. """
        self.logger.info(f"Running OTF")
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

    def stop_otf(self):
        """ Stop the thread that is doing OTF and all subprocess.
        Also update the internal dictionary of threads-sessions-tasks
        """
        self.stop()
        otf = self.session['extra']['otf']
        processes = Process.ps('scipion', workingDir=otf['path'], children=True)
        for folder, procs in processes.items():
            try:
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
            if task_id != k:
                t = v.task
                if t['name'] == 'session' and t['args']['action'] == 'otf':
                    v.stop_otf()
                    stopped.append(t['id'])
        return stopped


if __name__ == '__main__':
    worker = SessionWorker(debug=True)
    worker.run()
