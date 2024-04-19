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
import shutil
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


class SessionTaskHandler(TaskHandler):
    def __init__(self, *args, **kwargs):
        TaskHandler.__init__(self, *args, **kwargs)
        self.mf = None
        self.epu_session = None  # for EPU parsing during OTF
        self.update_session = False

        targs = self.task['args']
        self.session_id = int(targs['session_id'])
        self.action = targs.get('action', 'Empty-Action')

        self.session = self.get_session()
        self.info("Getting config from EMhub.")
        attrs = {"attrs": {"id": self.session_id}}
        self.sconfig = self.request_config('sessions')
        session_users = self.request_data('get_session_users', attrs)
        self.users = session_users.get('session_users', None)
        self.resources = self.request_dict('get_resources',
                                           {"attrs": ["id", "name"]})
        self.microscope = self.resources[self.session['resource_id']]['name']

        self.sleep = targs.get('sleep', 60)

        self.info(f">>> Handling task for session {self.session_id}")
        self.info(f"\t action: {self.action}")
        self.info(f"\t   args: {targs}")

    def process(self):
        if self.users is None:
            raise Exception("Could not retrieve users information for this session")

        func = getattr(self, self.action, None)
        if func is None:
            return self.unknown_action()

        func()
        if self.update_session:
            # Update session information
            self.session = self.get_session()

    def getLogPrefix(self):
        prefix = self.task['args']['action'].upper()
        return f"{prefix}-{self.task['args']['session_id']}"

    def update_session_extra(self, extra):
        def _update_extra():
            extra['updated'] = Pretty.now()
            self.worker.request('update_session_extra',
                         {'id': self.session['id'], 'extra': extra})
            return True

        return self._request(_update_extra, 'updating session extra')

    def delete_task(self):
        def _delete():
            self.worker.request('delete')

    def get_session(self, tries=10):
        """ Retrieve session info to update local data. """
        def _get_session():
            self.info(f"Retrieving session {self.session_id} from EMhub "
                             f"({config.EMHUB_SERVER_URL})")
            return self.dc.get_session(self.session_id)

        errorMsg = f"retrieving session {self.session_id} info."
        session = self._request(_get_session, errorMsg)

        if session:
            return session

        error = f"Could not retrieve session {self.session_id} after {tries} attempts."
        self.error(error)
        raise Exception(error)

    def unknown_action(self):
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

            if 'check_frames' in self.task['args']:
                frames = raw.get('frames', '')
                uargs = {'frames': frames}
                if os.path.exists(frames):
                    mff = MovieFiles()
                    mff.scan(frames)
                    mffInfo = mff.info()
                    uargs.update({
                        'movies': mffInfo['movies'],
                        'size': mffInfo['sizeH'],
                        'lastFile': Pretty.elapsed(mffInfo['last_file'])
                    })
                self.update_task(uargs)

        # Remove dict from the task update
        del update_args['files']
        self.update_task(update_args)

    def get_session_name(self):
        """ Strip down : for uniqueness. """
        n = self.session['name']
        return n if ':' not in n else n.split(':')[1]

    def get_session_fullname(self):
        """ Unique folder based on session name, date and instrument. """
        date_ts = self.session['start']
        date = date_ts.split('T')[0].replace('-', '')
        return f"{date}_{self.microscope}_{self.get_session_name()}"

    def transfer(self):
        """ Move files from the Raw folder to the Offload folder.
        Files will be moved when there has been a time without modification
        (file's timeout).
        """
        extra = self.session['extra']
        logger = self.worker.logger
        raw = extra['raw']
        framesRoot = self.sconfig['raw']['root_frames']
        sessionName = self.get_session_name()
        framesPath = Path.rmslash(raw.get('frames',
                                          os.path.join(framesRoot, sessionName)))
        parts = self.users['owner']['email'].split('@')[0].split('.')
        userFolder = parts[0][0] + parts[1]
        rawRoot = self.sconfig['raw']['root']
        fullName = self.get_session_fullname()
        # Offload server path where to transfer the files
        rawPath = os.path.join(rawRoot, self.users['group'], self.microscope,
                                      str(datetime.now().year), 'raw', 'EPU',
                                      userFolder, fullName)
        framesPath = Path.addslash(framesPath)
        rawPath = Path.addslash(rawPath)

        #  First time the process function is called for this execution
        if self.count == 1:
            self.info(f"Monitoring FRAMES FOLDER: {framesPath}")
            self.info(f"Offloading to RAW FOLDER: {rawPath}")

            # JMRT 2023/11/08 We are no longer creating the Frames path because
            # new version of EPU requires that the folder does not exist for
            # starting a new session
            #self.pl.mkdir(framesPath)

            raw['frames'] = framesPath
            raw['path'] = rawPath
            self.mf = MovieFiles(root=rawPath)
            self.seen = {}

            if os.path.exists(rawPath):
                self.info("Restarting transfer task, loading transferred files.")
                self.mf.scan(rawPath)
                raw.update(self.mf.info())
            else:
                self.info("Starting transfer task")
                self.pl.mkdir(rawPath)

            self.update_session_extra({'raw': raw})

        mf = self.mf  # shortcut
        seen = self.seen
        self.n_files = 0
        self.n_movies = 0

        def _update():
            self.info(f"Found {self.n_files} new files, "
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

        td = timedelta(minutes=1)
        transferred = False

        now = datetime.now()
        self.info(f"Scanning framesPath: {framesPath}")

        for root, dirs, files in os.walk(framesPath):
            rootRaw = root.replace(framesPath, rawPath)
            for d in dirs:
                self.pl.mkdir(os.path.join(rootRaw, d))
            for f in files:
                srcFile = os.path.join(root, f)
                dstFile = os.path.join(rootRaw, f)

                # Do not waste time on already processed files
                if dstFile in mf:
                    continue

                now = datetime.now()
                # Sometimes there are temporary files that does not
                # exist and the os.stat fails, we will ignore these entries
                try:
                    s = os.stat(srcFile)
                except:
                    continue

                unmodified = False

                # JMRT 20240130: We are having issues with the modified date in
                # the Krios G4 DMP server, where files are in the future
                # so we are changing how to detect if a file is modified or not
                if dstFile in seen:
                    unmodified = (now - seen[dstFile]['t'] >= td and
                                  s.st_mtime == seen[dstFile]['mt'])
                else:
                    seen[dstFile] = {'mt': s.st_mtime, 't': now}

                # Old way to check modification
                # dt = datetime.fromtimestamp(s.st_mtime)
                # unmodified = now - dt >= td
                if unmodified:
                    mf.register(dstFile, stat=s)
                    del seen[dstFile]
                    transferred = True
                    self.n_files += 1
                    # Register creation time of movie files
                    if EPU.is_movie_fn(f):
                        self.n_movies += 1
                        # Only move now the movies files, not other metadata files
                        self.pl.system(f'rsync -ac --remove-source-files "{srcFile}" "{dstFile}"', retry=30)
                    else:  # Copy metadata files
                        self.pl.cp(srcFile, dstFile, retry=30)

                if self.n_files >= 32:  # make frequent updates to keep otf updated
                    _update()

        # Only sleep when no data was found
        self.sleep = 0 if transferred else 60
        _update()
        self.info(f"Sleeping {self.sleep} seconds.")

        info = mf.info()
        self.framesInfo = None

        def _elapsed(key, info, days):
            if ts := info.get(f'{key}_creation', None):
                td = now - datetime.fromtimestamp(ts)
                f = info.get(key, 'No-file')
                self.info(f'{key}: {f}, '
                          f'{Pretty.timestamp(ts)} -> '
                          f'{Pretty.elapsed(ts)}')
                if td > timedelta(days=days):
                    return True
            return False

        def _stop():
            """ Check various conditions that will make the TRANSFER task
            to stop. For example, last raw file older than 3 days. """
            if self.n_files:  # Do not check stop while finding new files
                return False

            frames = False
            if os.path.exists(framesPath):
                mf = MovieFiles()
                mf.scan(framesPath)
                self.framesInfo = mf.info()
                frames = _elapsed('last_file', self.framesInfo, 3)

            return (frames or
                    _elapsed('first_file', info, 5) or
                    _elapsed('last_file', info, 3))

        if _stop():
            update_args = info
            update_args['done'] = 1
            # Remove dict from the task update
            if 'files' in info:
                del update_args['files']

            if self.framesInfo:
                if int(self.framesInfo['movies']) == 0:
                    self.info(f'Stopping transfer, cleaning frames folder: '
                              f'{framesPath}.')
                    self.pl.rm(framesPath)
            self.update_task(update_args)
            self.stop()

    def stop_all_otf(self, done=False):
        self.info("Stopping all OTF tasks.")
        stopped = self.worker.notify_launch_otf(self.task)
        self.info(f"Stopped: {stopped}")
        event = {'stopped_tasks': json.dumps(stopped)}
        if done:
            event['done'] = 1
            self.stop()
        self.update_task(event)

    def get_path_from(self, pathDict, referencePath, root, suffix=''):
        path = pathDict.get('path', None)
        if not path:
            folder = os.path.basename(Path.rmslash(referencePath)) + suffix
            path = os.path.join(root, folder)
        return path

    def otf(self):
        extra = self.session['extra']
        raw = extra['raw']
        self.update_session = True  # update session to check for new images

        # Debugging option to only create the OTF folder and exit
        if otf_folder := self.task['args'].get('create_otf_folder'):
            self.create_otf_folder(otf_folder, update_session=False)
            self.update_task({
                'done': 1
            })
            self.stop()
            return

        # Stop all OTF tasks running in this worker
        if 'stop' in self.task['args']:
            self.stop_all_otf(done=True)

        clear = 'clear' in self.task['args'] and self.count == 1

        if clear:
            self.stop_all_otf(done=False)

        try:
            n = raw.get('movies', 0)
            raw_path = raw.get('path', '')
            raw_exists = os.path.exists(raw_path)
            # logger = self.logger
            otf = extra['otf']
            otf_path = self.get_path_from(otf, raw_path, self.sconfig['otf']['root'],
                                          suffix='_OTF')
            otf_exists = os.path.exists(otf_path)

            otfStr = otf_path if len(otf_path) > 4 else 'NOT READY'
            self.info(f"OTF path: {otfStr}, do clear: {clear}, movies: {n}")

            if not otf_exists or clear:
                # OTF is not running, let's check if we need to launch it
                if raw_exists and n > 16:
                    self.info(f"Launching OTF after {n} images found.")
                    self.worker.notify_launch_otf(self.task)
                    self.create_otf_folder(otf_path)
                    otf_exists = True
                    self.launch_otf()
                    self.update_task({'otf_path': otf['path'],
                                      'otf_status': otf['status'],
                                      'count': self.count})
                    self.update_session = False  # after launching no need to update
            else:
                self.update_task({'count': self.count})

            if otf_exists and raw_exists:
                epuFolder = os.path.join(otf_path, 'EPU')
                epuStar = os.path.join(epuFolder, 'movies.star')

                if self.epu_session is None:
                    self.epu_session = EPU.Session(raw_path,
                                                   outputStar=epuStar,
                                                   backupFolder=epuFolder,
                                                   pl=self.pl)
                self.epu_session.scan()
                if not os.path.exists(epuStar):
                    self.info(f"File {epuStar} does not exist yet.")
                else:
                    with StarFile(epuStar) as sf:
                        self.info(f"Scanned EPU folder, "
                                         f"movies: {sf.getTableSize('Movies')}")
                if self.update_session:
                    self.info(f"No longer need to update session.")
                    self.update_session = False  # after launching no need to update

        except Exception as e:
            self.worker.logger.exception(e)
            self.update_task({
                'error': f'Exception {str(e)}',
                'done': 1
            })
            self.stop()

    def create_otf_folder(self, otf_path, update_session=True):
        extra = self.session['extra']
        raw_path = extra['raw']['path']
        otf = extra['otf']
        otf.update({'path': otf_path, 'status': 'created'})
        self.pl.rm(otf_path)

        def _path(*paths):
            return os.path.join(otf_path, *paths)

        self.pl.mkdir(os.path.join(otf_path, 'EPU'))
        os.symlink(raw_path, _path('data'))

        gain_path = os.path.dirname(self.sconfig['data']['gain'])
        acq = dict(self.sconfig['acquisition'][self.microscope])

        # Copy the gain reference file to the OTF folder and set it for processing
        # We will try to get the gain from the following places:
        # 1. From the Raw data folder (now it is copied there with EPU-Falcon4i)
        # 2. From our storage of gains
        # We will copy to the raw folder if it is not there
        # We will copy to the storage if it is not there
        gain_pattern = acq.pop('gain_pattern').format(microscope=self.microscope)

        def _last_gain(path, pattern):
            if gains := glob(os.path.join(path, pattern)):
                gains.sort(key=lambda g: os.path.getmtime(g))
                return os.path.realpath(gains[-1])
            return None

        # Check first if there is a gain in the raw folder
        raw_gain = _last_gain(raw_path, gain_pattern)
        real_gain = raw_gain or _last_gain(gain_path, gain_pattern)
        base_gain = os.path.basename(real_gain)
        self.pl.cp(real_gain, _path(base_gain))

        if not raw_gain:
            self.pl.cp(real_gain, os.path.join(raw_path, base_gain))
        else:
            # Let's backup the gain if does not exists
            back_gain = os.path.join(gain_path, base_gain)
            if not os.path.exists(back_gain):
                self.pl.cp(real_gain, back_gain)

        # Create a general ini file with config/information of the session
        config = configparser.ConfigParser()

        operator = self.users['operator'].get('name', 'No-operator')
        config['GENERAL'] = {
            'group': self.users['group'],
            'user': self.users['owner']['name'],
            'operator': operator,
            'microscope': self.microscope,
            'raw_data': raw_path
        }
        acq['gain'] = base_gain
        acq.update(self.session['acquisition'])
        images_pattern = acq.get('images_pattern',
                                 "Images-Disc*/GridSquare_*/Data/Foil*fractions.tiff")
        config['ACQUISITION'] = acq

        config['PREPROCESSING'] = {
            'images': 'data/' + images_pattern,
            'software': 'None',  # or Relion or Scipion
        }

        with open(_path('README.txt'), 'w') as configfile:
            config.write(configfile)

        opts = self.sconfig['otf']['relion']['options']
        with open(_path('relion_it_options.py'), 'w') as f:
            optStr = ",\n".join(f"'{k}' : '{v.format(**acq)}'" for k, v in opts.items())
            f.write("{\n%s\n}\n" % optStr)

        opts = self.sconfig['otf']['scipion']['options']
        cryolo_model = otf.get('cryolo_model', None)

        if cryolo_model:
            model = os.path.basename(cryolo_model)
            os.symlink(cryolo_model, _path(model))
            opts['picking'] = {'cryolo_model': model}

        with open(_path('scipion_otf_options.json'), 'w') as f:
            opts['acquisition'] = acq
            json.dump(opts, f, indent=4)

        # Update OTF status
        if update_session:
            self.update_session_extra({'otf': otf})

    def launch_otf(self):
        """ Launch OTF for a session. """
        self.info(f"Running OTF")
        otf = self.session['extra']['otf']
        otf_path = otf['path']
        workflow = otf.get('workflow', '')
        if workflow == 'none':
            msg = 'OTF workflow is None, so no doing anything.'
            self.pl.logger.info(msg)
            self.update_task({'msg': msg, 'done': 1})
            self.stop()
        else:
            workflow_conf = self.sconfig['otf'].get(workflow, None)
            if not workflow_conf:
                raise Exception(f"Missing workflow '{workflow}' from "
                                f"sessions::config OTF section. ")

            command = workflow_conf['command']
            cmd = command.format(otf_path=otf_path, session_id=self.session['id'])
            self.pl.system(cmd + ' &')

    def stop_otf(self):
        """ Stop the thread that is doing OTF and all subprocess.
        Also update the internal dictionary of threads-sessions-tasks
        """
        self.stop()
        otf = self.session['extra']['otf']
        otf_path = otf.get('path', '')
        try:
            if otf_path:
                processes = Process.ps('scipion', workingDir=otf['path'], children=True)
                for folder, procs in processes.items():
                    self.info(f"Killing processes for Session {self.session['id']}")
                    for p in procs:
                        p.kill()
            otf['status'] = 'stopped'
            self.update_session_extra({'otf': otf})
        except Exception as e:
            self.error(Color.red("Error: %s" % str(e)))
        self.update_task({'msg': 'Forced to stop ', 'done': 1})


class FramesTaskHandler(TaskHandler):
    """ Monitor frames folder located at
    config:sessions['raw']['root_frames']. """
    def __init__(self, *args, **kwargs):
        TaskHandler.__init__(self, *args, **kwargs)
        # Load config
        self.sconfig = self.request_config('sessions')
        self.root_frames = self.sconfig['raw']['root_frames']

    def process(self):
        if self.count == 1:
            self.entries = {}

        args = {'maxlen': 2}
        updated = False

        try:
            for e in os.listdir(self.root_frames):
                entryPath = os.path.join(self.root_frames, e)
                s = os.stat(entryPath)
                if os.path.isdir(entryPath):
                    if e not in self.entries:
                        self.entries[e] = {'mf': MovieFiles(), 'ts': 0}
                    dirEntry = self.entries[e]
                    if dirEntry['ts'] < s.st_mtime:
                        dirEntry['mf'].scan(entryPath)
                        dirEntry['ts'] = s.st_mtime
                        updated = True
                elif os.path.isfile(entryPath):
                    if e not in self.entries or self.entries[e]['ts'] < s.st_mtime:
                        self.entries[e] = {
                            'type': 'file',
                            'size': s.st_size,
                            'ts': s.st_mtime
                        }
                        updated = True

            if updated:
                entries = []
                for e, entry in self.entries.items():
                    if 'mf' in entry:  # is a directory
                        newEntry = {
                            'type': 'dir',
                            'size': entry['mf'].total_size,
                            'movies': entry['mf'].total_movies,
                            'ts': entry['ts']
                        }
                    else:
                        newEntry = entry
                    newEntry['name'] = e
                    entries.append(newEntry)

                args['entries'] = json.dumps(entries)
                u = shutil.disk_usage(self.root_frames)
                args['usage'] = json.dumps({'total': u.total, 'used': u.used})

        except Exception as e:
            updated = True  # Update error
            args['error'] = f"Error: {e}"
            args.update({'error': str(e),
                         'stack': traceback.format_exc()})

        if updated:
            self.info("Sending frames folder info")
            self.update_task(args)

        time.sleep(30)


class SessionWorker(Worker):
    def handle_tasks(self, tasks):
        handlers = {
            'command': CmdTaskHandler,
            'session': SessionTaskHandler,
            'frames': FramesTaskHandler
        }

        for t in tasks:
            HandlerClass = handlers.get(t['name'], DefaultTaskHandler)
            handler = HandlerClass(self, t)
            handler.start()

    def notify_launch_otf(self, task):
        """ This method should be called from tasks handlers to notify
        that a OTF is going ot be launched. Then, we must stop any other
        OTF tasks running in this host. (only one OTF running per host)
        """
        task_id = task['id']
        self.info(f"Task handler {task_id} notified launching OTF")
        stopped = []
        current_threads = [v for v in self.tasks.values()]
        for v in current_threads:
            t = v.task
            if t['id'] != task_id and t['name'] == 'session' and t['args']['action'] == 'otf':
                v.stop_otf()
                stopped.append(t['id'])
        return stopped


if __name__ == '__main__':
    worker = SessionWorker(debug=True)
    worker.run()
