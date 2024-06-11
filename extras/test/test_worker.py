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
        if self.action == 'monitor':
            return self.monitor()

        self.update_task({
            'error': f'Unknown action {self.action}',
            'done': 1
        })
        self.stop()

    def monitor(self):
        extra = self.session['extra']
        raw = extra['raw']
        # If repeat != 0, then repeat the scanning this number of times
        repeat = self.task['args'].get('repeat', 1)

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









