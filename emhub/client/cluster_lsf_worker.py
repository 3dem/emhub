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
from emhub.client.worker import TaskHandler, DefaultTaskHandler, Worker


class LSFTaskHandler(TaskHandler):
    def __init__(self, *args, **kwargs):
        TaskHandler.__init__(self, *args, **kwargs)

    def process(self):
        args = {'maxlen': 2}
        try:
            from emtools.hpc.lsf import LSF
            queues = LSF().get_queues_json('cryo')
            args['queues'] = json.dumps(queues)
        except Exception as e:
            args['error'] = f"Error: {e}"
            args.update({'error': str(e),
                         'stack': traceback.format_exc()})

        self.logger.info("Sending queues info")
        self.update_task(args)
        time.sleep(30)


class LSFWorker(Worker):
    def handle_tasks(self, tasks):
        for t in tasks:
            if t['name'] == 'cluster-lsf':
                handler = LSFTaskHandler(self, t)
            else:
                handler = DefaultTaskHandler(self, t)
            handler.start()


if __name__ == '__main__':
    worker = LSFWorker(debug=True)
    worker.run()
