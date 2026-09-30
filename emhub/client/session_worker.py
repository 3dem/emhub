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
"""
Simple, instance-independent examples of workers for EMhub sessions.

Three levels of functionality, each one building on the previous:

1. **Monitor** (``SessionMonitorWorker``): for each active session, scan the
   folder provided in the *Create Session* dialog (``extra['raw']['path']``)
   and report the files statistics (``emtools.metadata.MovieFiles``) back to
   EMhub. The stats are stored in the session ``extra`` (shown in the session
   page) and appended to the session log (``log:session:<id>``).

2. **Monitor + root folders** (``--root NAME=PATH``): in addition, monitor the
   root folder(s) of each instrument and report their entries (sub-folders with
   size and number of movies) as possible new sessions. They are reported to
   the ``frames:<instrument>`` log, the one used by EMhub for this purpose.

3. **Transfer** (``SessionTransferWorker``): same as 1), but the session folder
   is first copied (rsync) to another location. The session then points to
   the copy (``raw.path``) and keeps the original location in ``raw.frames``.

Usage examples::

    emh-session-worker monitor
    emh-session-worker monitor --root Krios01=/data/krios01 --root Krios01=/data2/krios01
    emh-session-worker transfer --dest /data/offload

The EMhub connection is taken from the EMHUB_SERVER_URL, EMHUB_USER and
EMHUB_PASSWORD environment variables, and the host where the worker is
running needs to be registered in the ``config:hosts`` form.

Instance specific workers (e.g. with OTF processing or several transfer
stages) can be built by subclassing ``SessionHandler`` and ``SessionMonitorWorker``.
"""

import argparse
import os
import shutil
import json
import time

from emtools.utils import Pretty, Path, Timer
from emtools.metadata import MovieFiles

from emhub.client import config
from emhub.client.worker import TaskHandler, Worker


class SessionHandler(TaskHandler):
    """ Base handler for one session. It retrieves the session from EMhub
    at every iteration and stops when the session is no longer active.
    Subclasses should implement `process_session`.
    """
    def __init__(self, worker, task):
        self.session_id = int(task['args']['session_id'])
        TaskHandler.__init__(self, worker, task)
        self.emhub_log = f'log:session:{self.session_id}'
        self.sleep = task['args'].get('sleep', 60)
        self.daemon = True

    def getLogPrefix(self):
        return f"{self.task['args']['action'].upper()}-{self.session_id}"

    def _stop_thread(self, error=None):
        TaskHandler._stop_thread(self, error)
        self.worker.remove_handler(self.task)

    def get_session(self):
        session = self._request(lambda: self.dc.get_session(self.session_id),
                                f"retrieving session {self.session_id}")
        if session is None:
            raise Exception(f"Could not retrieve session {self.session_id}")
        return session

    def update_session_extra(self, extra):
        """ Update (only) the given keys of the session's extra. """
        def _update():
            extra['updated'] = Pretty.now()
            self.worker.request('update_session_extra',
                                {'id': self.session_id, 'extra': extra})
            return True

        return self._request(_update, 'updating session extra')

    def process(self):
        session = self.get_session()
        status = session['status']
        if status != 'active':
            self.update_log({'msg': f"Session is {status}, stopping.", 'done': 1})
            self.stop()
        else:
            self.process_session(session)

    def process_session(self, session):
        raise NotImplementedError


class FolderMonitorHandler(SessionHandler):
    """ Monitor the session raw folder and report files stats to EMhub. """
    def __init__(self, *args, **kwargs):
        SessionHandler.__init__(self, *args, **kwargs)
        self.mf = None  # MovieFiles, scanned incrementally
        self._mfRoot = None

    def get_path(self, session, raw):
        """ Return the path to monitor, or None if it is not ready yet.
        Subclasses can override to do something before (e.g transfer). """
        return raw.get('path', None)

    def process_session(self, session):
        raw = session['extra'].setdefault('raw', {})
        path = self.get_path(session, raw)

        if not path or not os.path.exists(path):
            self.info(f"Raw folder '{path}' does not exist, waiting...")
            return

        if self._mfRoot != path:  # first time or if the path was changed
            self.mf = MovieFiles()
            self._mfRoot = path

        self.mf.scan(path)
        info = self.mf.info()
        if not info:
            self.info(f"No files found in {path}")
            return

        raw.update(info)  # includes 'files': counts and size by extension
        self.update_session_extra({'raw': raw})

        del info['files']  # log events only accept flat values
        self.update_log(info)
        self.info(f"Files: {info['files_total']}, movies: {info['movies']}, "
                  f"size: {info['sizeH']}")


class TransferHandler(FolderMonitorHandler):
    """ Copy the session folder to another location (using rsync) and
    monitor the copy. The worker `dest` attribute is the root destination
    folder, and the session folder will be copied to `dest/<session name>`.

    Files that are still being written are copied too, but since rsync is
    repeated on each iteration, they will be updated later.
    """
    def get_path(self, session, raw):
        # If the source is already in 'frames', the raw path is the transfer
        source = raw.get('frames') or raw.get('path')
        if not source or not os.path.exists(source):
            return None

        name = session['name'].split(':')[-1]
        dest = os.path.join(self.worker.dest, name)
        os.makedirs(dest, exist_ok=True)

        t = Timer()
        n, size = Path.rsync(source, dest, '--no-compress', size=True)
        elapsed = t.getElapsedTime()
        self.info(f"Transferred {n} files from {source} to {dest}")
        self.update_log({
            'source': source,
            'dest': dest,
            'transferred_files': n,
            'transferred_size': f"{size} ({Pretty.size(size)})",
            'transfer_time': str(elapsed)
        })

        raw.update({'frames': source, 'path': dest})
        return dest


class RootFolderHandler(TaskHandler):
    """ Monitor the root folder(s) of one instrument and report their entries
    as possible new sessions. Each sub-folder is reported with its size and
    number of movies, to the same log used for the instrument frames folder.
    """
    def __init__(self, worker, instrument, roots, sleep=60):
        self.instrument = instrument
        self.roots = roots if isinstance(roots, list) else [roots]
        TaskHandler.__init__(self, worker,
                             {'id': f'root-{instrument}', 'args': {}})
        self.emhub_log = f'frames:{instrument}'
        self.sleep = sleep
        self.daemon = True
        self.folders = {}  # path -> MovieFiles, scanned incrementally

    def getLogPrefix(self):
        return f"ROOT-{self.instrument}"

    def process(self):
        t = Timer()
        entries = []

        for root in self.roots:
            for name in sorted(os.listdir(root)):
                path = os.path.join(root, name)
                try:
                    s = os.stat(path)
                except OSError:  # temporary files can disappear
                    continue

                if os.path.isdir(path):
                    mf = self.folders.setdefault(path, MovieFiles())
                    mf.scan(path)
                    entry = {'type': 'dir', 'size': mf.total_size,
                             'movies': mf.total_movies,
                             'ts': mf.counters[0].last_ts or s.st_mtime}
                else:
                    entry = {'type': 'file', 'size': s.st_size, 'ts': s.st_mtime}
                entry.update({'name': name, 'path': path, 'root': root})
                entries.append(entry)

        usage = [shutil.disk_usage(root) for root in self.roots]
        self.update_log({
            'maxlen': 3,  # only the last events are relevant
            'entries': json.dumps(entries),
            'usage': json.dumps({'total': sum(u.total for u in usage),
                                 'used': sum(u.used for u in usage)}),
            'elapsed': str(t.getElapsedTime())
        })
        self.info(f"Reported {len(entries)} entries from {', '.join(self.roots)}")


class SessionMonitorWorker(Worker):
    """ Worker that monitors the raw folder of each active session (mode 1)
    and, optionally, the root folders of the instruments (mode 2).

    Args:
        roots: dict {instrument name: list of root folders}
        sleep: seconds between updates
    """
    handler_class = FolderMonitorHandler

    def __init__(self, roots=None, sleep=60, **kwargs):
        Worker.__init__(self, **kwargs)
        self.roots = roots or {}
        self.handler_sleep = sleep

    def create_handler(self, session):
        task = {
            'id': f"{self.handler_class.__name__}-{session['id']}",
            'args': {'action': 'monitor', 'session_id': session['id'],
                     'sleep': self.handler_sleep}
        }
        return self.handler_class(self, task)

    def run(self):
        self.setup()

        for instrument, roots in self.roots.items():
            self.info(f"Monitoring root folders of {instrument}: {roots}")
            RootFolderHandler(self, instrument, roots, self.handler_sleep).start()

        last_id = 0
        while True:
            try:
                # This request blocks for a while if there are no new sessions
                sessions = self.request_data('poll_active_sessions',
                                             {'attrs': {'last_id': last_id,
                                                        'sleep': 10}})
                for s in sessions or []:
                    self.info(f"New active session: {s['id']}")
                    self.create_handler(s).start()
                    last_id = max(last_id, s['id'])
            except Exception as e:
                self.error(f"Error polling sessions: {e}")
                time.sleep(30)


class SessionTransferWorker(SessionMonitorWorker):
    """ Worker that copies each active session folder to `dest` (mode 3). """
    handler_class = TransferHandler

    def __init__(self, dest, **kwargs):
        SessionMonitorWorker.__init__(self, **kwargs)
        self.dest = dest


def main():
    p = argparse.ArgumentParser(prog='emh-session-worker')
    p.add_argument('--url', '-u', default='')
    subparsers = p.add_subparsers(dest='mode', required=True)

    def _add_common(sp):
        sp.add_argument('--root', action='append', default=[],
                        metavar='NAME=PATH',
                        help="Instrument root folder to be monitored (can be "
                             "repeated, also for the same instrument)")
        sp.add_argument('--sleep', type=int, default=60,
                        help="Seconds between updates")

    _add_common(subparsers.add_parser('monitor'))
    transfer_p = subparsers.add_parser('transfer')
    transfer_p.add_argument('--dest', required=True,
                            help="Folder where sessions will be copied")
    _add_common(transfer_p)

    args = p.parse_args()

    if args.url:
        config.EMHUB_SERVER_URL = args.url
        os.environ['EMHUB_SERVER_URL'] = args.url

    roots = {}  # an instrument can have several roots (--root repeated)
    for r in args.root:
        name, path = r.split('=', 1)
        roots.setdefault(name, []).append(path)
    kwargs = {'roots': roots, 'sleep': args.sleep, 'debug': True}

    if args.mode == 'monitor':
        SessionMonitorWorker(**kwargs).run()
    else:
        SessionTransferWorker(dest=args.dest, **kwargs).run()


if __name__ == '__main__':
    main()
