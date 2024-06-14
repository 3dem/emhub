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


class TestSessionTaskHandler(TaskHandler):
    def __init__(self, *args, **kwargs):
        TaskHandler.__init__(self, *args, **kwargs)
        targs = self.task['args']
        self.session_id = int(targs['session_id'])
        self.action = targs.get('action', 'Empty-Action')
        self.info(f"Retrieving session {self.session_id} from EMhub "
                  f"({config.EMHUB_SERVER_URL})")
        self.session = self.dc.get_session(self.session_id)

    def update_session_extra(self, extra):
        def _update_extra():
            extra['updated'] = Pretty.now()
            self.worker.request('update_session_extra',
                         {'id': self.session['id'], 'extra': extra})
            return True

        return self._request(_update_extra, 'updating session extra')

    def process(self):
        try:
            if self.action == 'monitor':
                return self.monitor()
            elif self.action == 'otf_test':
                return self.otf()
            raise Exception(f"Unknown action {self.action}")
        except Exception as e:
            self.update_task({'error': str(e), 'done': 1})
            self.stop()

    def monitor(self):
        extra = self.session['extra']
        raw = extra['raw']
        raw_path = raw['path']
        # If repeat != 0, then repeat the scanning this number of times
        repeat = self.task['args'].get('repeat', 1)

        if not os.path.exists(raw_path):
            raise Exception(f"Provided RAW images folder '{raw_path}' does not exists.")

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

    def otf(self):
        extra = self.session['extra']
        raw = extra['raw']
        raw_path = raw['path']
        otf = extra['otf']
        otf_path = otf['path']

        # Let's do some validations to check input paths and images
        if not os.path.exists(raw_path):
            raise Exception(f"Provided RAW images folder '{raw_path}' does not exists.")

        if os.path.exists(otf_path):
            raise Exception(f"Provided OTF folder '{otf_path}' alreayd exists."
                            f"Please delete it or use and unexisting path.")

        # Create OTF folder and configuration files for OTF
        def _path(*paths):
            return os.path.join(otf_path, *paths)

        self.pl.mkdir(otf_path)
        os.symlink(raw_path, _path('data'))
        acq = self.session['acquisition']
        # Make gain relative to input raw data folder
        acq['gain'] = _path('data', acq['gain'])
        with open(_path('scipion_otf_options.json'), 'w') as f:
            opts = {'acquisition': acq, '2d': False}
            json.dump(opts, f, indent=4)

        otf['status'] = 'created'

        # Now launch Scipion OTF
        self.pl.system(f"scipion python -m emtools.scripts.emt-scipion-otf --create {otf_path} &")

        #self.update_session_extra({'otf': otf})
        self.update_task({'otf_path': otf['path'],
                          'otf_status': otf['status'],
                          'count': self.count,
                          'done': 1})
        self.update_session_extra({'raw': raw})
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


if __name__ == '__main__':
    worker = TestSessionWorker(debug=True)
    worker.run()









