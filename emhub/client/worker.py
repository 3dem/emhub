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
    prefix = self.getLogPrefix()
    formatter = logging.Formatter(f'%(asctime)s {prefix} %(levelname)s %(message)s')
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
    else:
        logger.setLevel(logging.INFO)

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
        # Register this task handler in the current worker
        worker.tasks[task['id']] = self
        create_logger(self, self.worker.logsFolder, self.getLogName(),
                      toFile=True, debug=True)

    def getLogName(self):
        return f"task-{self.task['name']}-{self.task['id']}.log"

    def getLogPrefix(self):
        return f"TASK {self.task['id']}"

    def stop(self):
        self._stopEvent.set()

    def _stop_thread(self, error=None):
        task_id = self.task['id']

        self.logger.info(f"Stopping task handler for {task_id}.")

        if error:
            self.logger.error(error)

        if task_id in self.worker.tasks:
            del self.worker.tasks[task_id]

    def update_task(self, event, tries=-1, wait=10):
        """ Update task info.
        Args:
            event: info that will be sent as part of the update
            tries: try this many times to update the task, if less than zero, try forever
            wait: seconds to wait between tries
        """
        while tries:
            try:
                data = {
                    'task_id': self.task['id'],
                    'event': event
                }
                self.worker.request('update_task', data)
                return True
            except Exception as e:
                self.logger.error(f"Exception while updating task: {e}")
                time.sleep(wait)
            tries -= 1
        return False

    def run(self):
        self.logger.info(f"Running task handler {self.__class__} "
                         f"for task {self.task['id']}")
        self.logger.info(f"LOG_FILE: {self.logFile}")

        while True:
            try:
                if self.count:
                    time.sleep(self.sleep)
                    if self._stopEvent.is_set():
                        self._stop_thread()
                        break

                self.count += 1
                self.process()

            except Exception as e:
                errorTrace = traceback.format_exc()
                self._stop_thread(error=errorTrace)
                self.update_task({'error': errorTrace, 'done': 1})
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
            'error': f'There is no handler for task {name}',
            'done': 1
        })
        self.stop()


class CmdTaskHandler(TaskHandler):
    def process(self):
        repeat = self.task['args'].get('repeat', 1)
        sleep = self.task['args'].get('sleep', 10)
        for i in range(repeat):
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
        self.token = None  # API token used after connection
        self.name = kwargs.get('name', System.hostname())
        self.logFile = kwargs.get('logFile', 'worker.log')
        self.logsFolder = os.path.expanduser('~/.emhub/sessions/logs')
        self.dc = DataClient(server_url=config.EMHUB_SERVER_URL)
        self.dc.login(config.EMHUB_USER, config.EMHUB_PASSWORD)
        self.tasks = {}

    def __del__(self):
        self.dc.logout()

    def getLogPrefix(self):
        return f"WORKER {self.name}"

    def request(self, method, data, key=None):
        data['token'] = self.token
        r = self.dc.request(method,
                            jsonData={'attrs': data})
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

    def get_tasks(self, key, data):
        self.logger.info(f"Retrieving {key} tasks...")
        tasks = self.request(f'get_{key}_tasks', data, 'tasks')
        if tasks is not None:
            self.logger.info(f"Got {len(tasks)} tasks.")
            self.handle_tasks(tasks)

    def run(self):
        create_logger(self, self.logsFolder, self.logFile,
                      toFile=True, debug=True)

        self.logger.info(f"Running worker: {self.name}")
        self.logger.info(f"      LOG_FILE: {self.logFile}")
        self.logger.info(f"Connecting to EMHUB...")
        self.logger.info(f"     SERVER_URL: {config.EMHUB_SERVER_URL}")

        data = {'worker': self.name, 'specs': System.specs()}
        self.token = self.request('connect_worker', data, key='token')
        del data['specs']

        # Handling pending tasks
        self.get_tasks('pending', data)

        while True:
            try:
                self.get_tasks('new', data)
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
