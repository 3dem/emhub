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
        targs = self.task['args']
        session_id = targs['session_id']
        self.action = targs.get('action', 'Empty-Action')
        self.session = self.dc.get_session(session_id)
        self.sleep = targs.get('sleep', 60)
        self.mf = None

        print(Color.bold(f">>> Handling task for session {self.session['id']}"))
        print(f"\t action: {self.action}")
        print(f"\t   args: {targs}")

        if self.action == 'transfer':
            self.process = self.transfer_files
        elif self.action == 'monitor':
            self.process = self.monitor_files
        else:
            self.process = self.unknown_action

    def update_session_extra(self, extra):
        w = self.worker
        extra['updated'] = Pretty.now()
        try:
            w.dc.update_session_extra({'id': self.session['id'], 'extra': extra})
            return True
        except Exception as e:
            w.logger.error(f"Error connecting to {config.EMHUB_SERVER_URL} "
                           f"to update session.")
            return False

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
        del update_args['files']
        self.update_task(update_args)

    def transfer_files(self):
        """ Move files from the Raw folder to the Offload folder.
        Files will be moved when there has been a time without modification
        (file's timeout).
        """
        extra = self.session['extra']
        logger = self.logger
        raw = extra['raw']

        # Real raw path where frames are being recorded
        framesPath = raw['frames']

        # Offload server path where to transfer the files
        rawPath = raw['path']

        def _mkdir(root, folder=''):
            folderPath = os.path.join(root, folder)
            if not os.path.exists(folderPath):
                self.pl.system(f"mkdir {folderPath}")

        #  First time the process function is called for this execution
        if self.count == 1:
            _mkdir(framesPath)
            self.mf = MovieFiles()

            if os.path.exists(rawPath):
                logger.info("Restarting transfer task, loading transferred files.")
                self.mf.scan(rawPath)
            else:
                logger.info("Starting transfer task")
                _mkdir(rawPath)

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
                    # Register creation time of movie files
                    if f.endswith('fractions.tiff'):
                        self.n_movies += 1
                        # Only move now the movies files, not other metadata files
                        self.pl.system(f'rsync -ac --remove-source-files "{srcFile}" "{dstFile}"', retry=30)
                    else:  # Copy metadata files into the OTF/EPU folder
                        self.pl.system(f'cp "{srcFile}" "{dstFile}"', retry=30)
                        # Not doing the EPU backup for now
                        #dstEpuFile = os.path.join(rootEpu, f)
                        # only backup gridsquares thumbnails and xml files
                        #if f.endswith('.xml') or _gsThumb(f):
                        #    self.pl.system(f'cp "{srcFile}" "{dstEpuFile}"', retry=30)

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


if __name__ == '__main__':
    worker = SessionWorker(debug=True)
    worker.run()
