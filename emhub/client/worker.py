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
from logging.handlers import TimedRotatingFileHandler
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
    if not os.path.exists(logsFolder):
        Process.system(f"mkdir -p '{logsFolder}'")

    formatter = logging.Formatter(f'%(asctime)s %(levelname)s %(message)s')
    logger = logging.getLogger(logName)
    if toFile:
        self.logFile = os.path.join(logsFolder, logName)
        #handler = logging.FileHandler(self.logFile)
        handler = TimedRotatingFileHandler(self.logFile,
                                           when='w0', interval=1, backupCount=5)
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
        """ Initialize the TaskHandler

        Args:
            worker: Worker instance that created this TaskHandler.
            task: Task to be handled.
        """
        threading.Thread.__init__(self)
        self.worker = worker
        self.pl = self.worker.pl
        self.dc = worker.dc
        self.debug = worker.debug
        self.task = task
        self.sleep = 10  # seconds to sleep while handling the task
        self.count = 0  # number of times the process function has executed
        self._stopEvent = threading.Event()
        # Register this task handler in the current worker
        worker.add_handler(task, self)
        self._logPrefix = self.getLogPrefix()
        self.emhub_log = None

    def getLogPrefix(self):
        """ Internal function to have a unique Log prefix. """
        return f"TASK-{self.task['id']}"

    def info(self, msg):
        """ Log some info using the internal logger. """
        self.worker.logger.info(f"{self._logPrefix} {msg}")

    def error(self, msg):
        """ Log some error using the internal logger. """
        self.worker.logger.error(f"{self._logPrefix} {msg}")

    def stop(self):
        """ Stop the current thread. """
        self._stopEvent.set()

    def stopped(self):
        return self._stopEvent.is_set()

    def _stop_thread(self, error=None):
        self.info(f"STOPPING task handler.")
        if error:
            self.error(error)

    def _request(self, requestFunc, errorMsg, tries=10):
        return self.worker._request(requestFunc, errorMsg, tries=tries)

    def request_data(self, endpoint, jsonData=None):
        return self.worker.request_data(endpoint, jsonData=jsonData)

    def request_dict(self, endpoint, jsonData=None):
        return self.worker.request_dict(endpoint, jsonData=jsonData)

    def request_config(self, config):
        return self.worker.request_config(config)

    def update_remote(self, endpoint, data, tries=-1, wait=10):
        """ Update task info.

        Args:
            endpoint: either update_task or update_log
            event: info that will be sent as part of the update
            tries: try this many times to update the task, if less than zero, try forever
            wait: seconds to wait between tries
        """
        while tries:
            try:
                self.worker.request(endpoint, data)
                return True
            except Exception as e:
                self.error(f"Exception while updating task {self.getLogPrefix()}: {e}")
                time.sleep(wait)
            tries -= 1
        return False

    def update_log(self, event):
        if self.emhub_log is None:
            raise Exception("emhub_log is not defined.")

        # Make task_id appears first
        e = {'task_id': self.getLogPrefix()}
        e.update(event)

        data = {
            'log_id': self.emhub_log, 'event': e
        }
        return self.update_remote('update_log', data, tries=2, wait=5)

    def update_task(self, event, tries=-1, wait=10):
        data = {
            'task_id': self.task['id'],
            'event': event
        }
        self.update_remote('update_task', data)

    def run(self):
        """ Implement thread's activity, running an infinite loop calling
        `process` until the `stop` method is called.
        """
        self.info(f"Running task handler {self.__class__} for task {self.task['id']}")
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
                try:
                    errorLog = datetime.now().strftime("%y%m%d_%H%M%S_%f.err")
                    msg = f"ERROR: {str(e)}, LOG: {errorLog}"
                    self.error(msg)
                    with open(os.path.join(self.worker.logsFolder, errorLog), 'w') as f:
                        f.write(errorTrace)
                    # TODO: Send the log EMhub
                    #self.update_task({'error': errorTrace, 'done': 1})
                    print(e)
                except Exception as e2:
                    print(f"Another exception occurred while handling "
                          f"previous exception. ERROR: {str(e2)}")
                    traceback.print_exc()

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
        self.dc.timeout = 60
        self.dc.login(config.EMHUB_USER, config.EMHUB_PASSWORD)
        self.tasks = {}
        self._tasksLock = threading.Lock()
        self.debug = kwargs.get('debug', False)
        self._logPrefix = f"WORKER-{self.name}"

    def info(self, msg):
        self.logger.info(f"{self._logPrefix} {msg}")

    def error(self, msg):
        self.logger.error(f"{self._logPrefix} {msg}")

    def request(self, method, data, key=None):
        data['token'] = self.token
        r = self.dc.request(method,
                            jsonData={'attrs': data})
        result = r.json()
        if 'error' in result:
            self.error(f"Error from server: {result['error']}")
        elif key:
            if key in result:
                return result[key]
            else:
                self.error(f"Expected key {key} not found in server response: "
                           f"{str(result)}")
        else:
            return result

        return None

    def _request(self, requestFunc, errorMsg, tries=10):
        """ Make a request to the server, trying many times if it fails. """
        wait = 5  # Initial wait for 5 seconds and increment it until max 60
        while tries:
            tries -= 1
            try:
                return requestFunc()
            except Exception as e:
                retryMsg = f"Waiting {wait} seconds to retry." if tries else 'Not trying anymore.'
                self.error(f"REQUEST: {errorMsg}. {retryMsg}")
                if self.debug:
                    self.error(traceback.format_exc())
                time.sleep(wait)
                wait = min(60, wait * 2)

        return None

    def request_data(self, endpoint, jsonData=None):
        """ Make a request to one of the server's endpoints.

        Args:
            jsonData: arguments that will send as JSON to the request.
        """
        def _get_data():
            return self.dc.request(endpoint, jsonData=jsonData).json()

        errorMsg = f"retrieving data from endpoint: {endpoint}"
        return self._request(_get_data, errorMsg)

    def request_dict(self, endpoint, jsonData=None):
        """ Shortcut function to `request_data` that return the
        result as a dict.
        """
        return {s['id']: s for s in self.request_data(endpoint, jsonData=jsonData)}

    def request_config(self, config):
        """ Shortcut function to `request_data` that retrieve a config form. """
        data = {'attrs': {'config': config}}
        return self.request_data('get_config', jsonData=data)['config']

    def add_handler(self, task, handler):
        """ Add a task handler in a thread-safe way. """
        with self._tasksLock:
            self.tasks[task['id']] = handler

    def remove_handler(self, task):
        """ Remove one task in a thread-safe way. """
        with self._tasksLock:
            self.tasks.pop(task['id'], None)

    def handle_tasks(self, tasks):
        """ This method should be implemented in subclasses to associated
        different task handlers base on each task. """
        pass

    def get_tasks(self, key):
        self.info(f"Retrieving {key} tasks...")
        return self.request(f'get_{key}_tasks',
                            {'worker': self.name}, 'tasks')

    def process_tasks(self, key):
        if tasks := self.get_tasks(key):
            with self._tasksLock:
                new_tasks = [t for t in tasks if t['id'] not in self.tasks]
            self.info(f"Got {len(new_tasks)} tasks.")
            self.handle_tasks(new_tasks)

    def setup(self):
        create_logger(self, self.logsFolder, self.logFile,
                      toFile=True, debug=True)

        self.info(f"Setting up worker: {self.name}")
        self.info(f"      LOG_FILE: {self.logFile}")
        self.info(f"EMHUB server...")
        self.info(f"     SERVER_URL: {config.EMHUB_SERVER_URL}")

        self.token = self.request('connect_worker',
                                  {'worker': self.name, 'specs': System.specs()},
                                  key='token')
        if self.token is None:
            raise Exception(f"{Color.bold('Worker could not connect')}, got {Color.red('NONE')} as token!\n"
                            f"Check the connection with the EMhub server and "
                            f"the Redis server configuration.")

    def run(self):
        self.setup()
        self.process_tasks('pending')  # get pending tasks

        while True:
            try:
                self.process_tasks('new')  # sleep for 5 min while not new tasks
                # The following should not happen, but it is a protection
                # in case there are pending tasks not being handled
                self.process_tasks('pending')

            except Exception as e:
                self.error('FATAL ERROR: ' + str(e))
                self.error(traceback.format_exc())
                time.sleep(30)


class CmdWorker(Worker):
    def handle_tasks(self, tasks):
        for t in tasks:
            if t['name'] == 'command':
                handler = CmdTaskHandler(self, t)
            else:
                handler = DefaultTaskHandler(self, t)
            handler.start()


if __name__ == '__main__':
    worker = CmdWorker(debug=True)
    worker.run()
