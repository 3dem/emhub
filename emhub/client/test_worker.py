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
from emhub.client.session_worker import SessionTaskHandler, SessionWorker


class TestSessionTaskHandler(SessionTaskHandler):
    def __init__(self, *args, **kwargs):
        SessionTaskHandler.__init__(self, *args, **kwargs)

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

        diffStr = 'None' if lastTs is None else now - datetime.fromtimestamp(lastTs)
        self.logger.info(f'lastTs: {lastTs}, diff: {diffStr}')
        if lastTs and now - datetime.fromtimestamp(lastTs) > timedelta(days=3):
            update_args = mf.info()
            update_args['done'] = 1
            # Remove dict from the task update
            del update_args['files']
            self.update_task(update_args)
            self.stop()


    def scan(self):
        extra = self.session['extra']
        raw = extra['raw']
        raw_path = raw['path']

        if os.path.exists(raw_path):
            for root, dirs, files in os.walk(raw_path):
                self.info(f"Root: {root}")
                if dirs:
                    self.info(f"   Dirs: {len(dirs)}")
                    for d in dirs:
                        self.info(f"     {d}")

                if files:
                    self.info(f"   Files: {len(files)}")
                    for f in files:
                        self.info(f"     {f}")

        if self.count == 10:
            self.stop()



class TestSessionWorker(Worker):
    def handle_tasks(self, tasks):
        for t in tasks:
            if t['name'] == 'command':
                handler = CmdTaskHandler(self, t)
            elif t['name'] == 'session':
                handler = TestSessionTaskHandler(self, t)
            else:
                handler = DefaultTaskHandler(self, t)
            handler.start()

def print_groups(tasks):
    # Group tasks by worker
    groups = {}

    for t in tasks:
        w = t['worker']
        if w not in groups:
            groups[w] = []
        groups[w].append(t)

    for k, v in groups.items():
        print(Color.green(k))
        for t in v:
            s = t['status']
            s = Color.cyan(s) if s else Color.bold('No-status')
            print("  ", t['id'], f'{s:>20}', t['name'], t.get('args', {}))

def update_task(worker, tasks):
    task = None
    for t in all_tasks:
        if t['name'] == 'session':
            task = t
            break

    pprint(task)

    if task is None:
        return

    sid = task['args']['session_id']
    s = worker.dc.get_session(sid)
    extra = {'updated': Pretty.now()}
    worker.request('update_session_extra',
                   {'id': sid, 'extra': extra})

    raw = s['extra']['raw']
    otf = s['extra']['otf']
    mf = MovieFiles()
    mf.scan(raw['frames'])
    info = mf.info()
    pprint(info)
    ts = info['last_file_creation']
    d = datetime.now() - datetime.fromtimestamp(ts)
    print("Last file",
          Pretty.timestamp(ts),
          Pretty.elapsed(ts))

    #pprint(s)


if __name__ == '__main__':
    worker = TestSessionWorker(debug=True)

    worker.run()
    #worker.setup()

    #all_tasks = worker.get_tasks('all')
    #all_tasks = worker.get_tasks('pending')

    #print_groups(all_tasks)
    #update_task(worker, all_tasks)








