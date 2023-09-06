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
from emtools.metadata import EPU

from emhub.client import open_client, config, DataClient


def create_logger(self, logsFolder, logName, debug=True, toFile=True):
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    logger = logging.getLogger(logName)
    if toFile:
        self.logFile = os.path.join(logsFolder, logName)
        handler = logging.FileHandler(self.logFile)
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    if debug:
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    self.logger = logger
    self.pl = Process.Logger(logger)


class TaskHandler(threading.Thread):
    def __init__(self, worker, task):
        threading.Thread.__init__(self)
        self.worker = worker
        self.dc = worker.dc
        self.task = task
        self.sleep = 10  # seconds to sleep while handling the task
        self.count = 0  # number of times the process function has executed
        self._stopEvent = threading.Event()
        create_logger(self, '.',
                      f"task-{task['name']}-{task['id']}.log",
                      toFile=False, debug=True)

    def stop(self):
        self._stopEvent.set()

    def update_task(self, event):
        data = {
            'task_id': self.task['id'],
            'worker': self.worker.name,
            'event': event
        }
        self.worker.request('update_task', data)

    def run(self):
        while True:
            try:
                if self.count:
                    time.sleep(self.sleep)
                    if self._stopEvent.is_set():
                        self.logger.info("Stopping worker thread.")
                        break

                self.count += 1
                self.process()

            except Exception as e:
                self.logger.error('FATAL ERROR: ' + str(e))
                self.logger.error(traceback.format_exc())
                print(e)
            first = False

    def process(self):
        """ Process the given task.
        This method should be implemented in subclasses.
        This function will be called many times while processing
        the task. The stop method will signal to stop the main loop.
        """
        pass


class DefaultTaskHandler(TaskHandler):
    def process(self):
        name = self.task['name']
        self.update_task({
            'error': 'There is no handler for task {name}',
            'done': 1
        })
        self.stop()


class CmdTaskHandler(TaskHandler):
    def process(self):
        repeat = self.task['args'].get('repeat', 1)
        sleep = self.task['args'].get('sleep', 10)
        print("repeat: ", repeat)
        for i in range(repeat):
            print("i = ", i)
            try:
                if i > 0:
                    time.sleep(sleep)

                args = self.task['args']['cmd'].split()
                p = Process(*args, doRaise=False)
                event = {'output': p.stdout}
            except Exception as e:
                event = {'error': str(e),
                         'stack': traceback.format_exc()}
            self.update_task(event)

        self.update_task({'done': 1})
        self.stop()


class Worker:
    def __init__(self, **kwargs):
        # Login into EMhub and keep a client instance
        self.name = kwargs.get('name', 'localhost')
        self.logFile = kwargs.get('logFile', 'worker.log')
        self.dc = DataClient(server_url=config.EMHUB_SERVER_URL)
        self.dc.login(config.EMHUB_USER, config.EMHUB_PASSWORD)

    def __del__(self):
        self.dc.logout()

    def request(self, method, data, key=None):
        r = self.dc.request(method, jsonData={'attrs': data})
        result = r.json()
        if 'error' in result:
            self.logger.error(f"Error from server: {result['error']}")
            return None
        else:
            return result[key] if key else result

    def handle_tasks(self, tasks):
        """ This method should be implemented in subclasses to associated
        different task handlers base on each task. """
        pass

    def run(self):
        create_logger(self, '.', self.logFile,
                      toFile=False, debug=True)
        data = {'worker': self.name, 'specs': System.specs()}
        self.logger.info("Connecting worker...")
        result = self.request('connect_worker', data)
        del data['specs']

        while True:
            try:
                self.logger.info("Retrieving new tasks...")
                tasks = self.request('get_new_tasks', data, 'tasks')
                if tasks is not None:
                    self.logger.info(f"Got {len(tasks)} tasks.")
                    self.handle_tasks(tasks)

            except Exception as e:
                self.logger.error('FATAL ERROR: ' + str(e))
                self.logger.error(traceback.format_exc())
                time.sleep(30)


class TestWorker(Worker):
    def handle_tasks(self, tasks):
        for t in tasks:
            if t['name'] == 'command':
                handler = CmdTaskHandler(self, t)
            else:
                handler = DefaultTaskHandler(self, t)
            handler.start()


if __name__ == '__main__':
    worker = TestWorker(debug=True)
    worker.run()
