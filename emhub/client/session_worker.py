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
from emtools.metadata import EPU, DataFiles

from emhub.client.worker import (TaskHandler, DefaultTaskHandler, CmdTaskHandler,
                                 Worker)


class SessionTaskHandler(TaskHandler):
    def __init__(self, **args):
        TaskHandler.__init__(self, **args)
        args = self.task['args']
        session_id = args['session_id']
        action = args['action']
        self.session = self.dc.get_session(self.session['id'])

        if action == 'transfer':
            self.process = self.transfer_files

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

        now = datetime.now()
        td = timedelta(minutes=1)

        def _mkdir(root, folder=''):
            folderPath = os.path.join(root, folder)
            if not os.path.exists(folderPath):
                self.pl.system(f"mkdir {folderPath}")

        #  First time the process function is called for this execution
        if self.count == 1:
            if not os.path.exists(framesPath):
                _mkdir(framesPath)

            self._data_files = DataFiles(lambda fn: fn.endswith('fractions.tiff'))

            if os.path.exists(rawPath):
                logger.info("Restarting transfer task, loading transferred files.")
                self._data_files.scan(rawPath)
            else:
                logger.info("Starting transfer task")
                _mkdir()

        ed = self._transfer_ed
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


        def _gsThumb(f):
            return f.startswith('GridSquare') and f.endswith('.jpg')

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
                        # Not doing the EPU backup for now
                        #dstEpuFile = os.path.join(rootEpu, f)
                        # only backup gridsquares thumbnails and xml files
                        #if f.endswith('.xml') or _gsThumb(f):
                        #    self.pl.system(f'cp "{srcFile}" "{dstEpuFile}"', retry=30)

            if self._files_count >= 32:  # make frequent updates to keep otf updated
                self.logger.info(f"Transferred {self._files_count} files.")
                _update()

        # Only sleep when no data was found
        self.sleep = 0 if self._transfer_movies else 60
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
    worker = Worker(debug=True)
    worker.run()
