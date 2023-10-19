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
import psutil
import argparse
import threading
from datetime import datetime, timedelta
from glob import glob
from collections import OrderedDict
import configparser
from pprint import pprint
import traceback

from emtools.utils import System, Pretty, Process, Path, Color, Timer
from emtools.metadata import EPU

from emhub.client import DataClient, config


class TestWorker:
    def __init__(self):
        self.pl = None
        self.dc = None

    def request_data(self, endpoint, jsonData=None):
        return self.dc.request(endpoint, jsonData=jsonData).json()

    def request_dict(self, endpoint, jsonData=None):
        return {s['id']: s for s in self.request_data(endpoint, jsonData=jsonData)}

    def run(self):
        formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
        logger = logging.getLogger('outLogger')
        logger.setLevel(logging.DEBUG)
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        pl = Process.Logger(logger)

        logger.info(Color.green(f"Connected to server: {config.EMHUB_SERVER_URL}"))
        dc = DataClient()
        dc.login()

        attrs = {'host': System.hostname(),
                 'specs': System.specs(),
                 'alias': 'w1'
                 }

        r = dc.request('worker_init', jsonData={'attrs': attrs})
        print(">>> RESPONSE: ")
        pprint(r.json())


        while True:
            memPercent = psutil.virtual_memory()[2]
            logger.info(f"CPU: {psutil.cpu_percent()}, "
                        f"MEM: {memPercent}")
            time.sleep(3)

        dc.logout()


if __name__ == '__main__':
    manager = TestWorker()
    manager.run()
