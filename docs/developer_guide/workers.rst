
Developing Workers
==================

Workers are Python scripts that communicate with EMhub via its REST API
(:ref:`using Python client code <Using EMhub Client>`). It provides a great
way to extend EMhub functionality and get some tasks executed in
machines other than those running the EMhub server. The main difference between
a worker and another script using the API is that the worker is supposed to run
all the time (e.g., as a Linux service) and maintain two-way communication with the EMhub server.

For example, one could use a worker in a machine that has access
to the image acquisition directory. That worker could get notified (via a task)
when a new session has started and the associated data folder. From there,
the worker can handle data transfer and trigger on-the-fly
processing if required. It can also update back the
information related to that session, reflecting the progress of the associated
tasks (e.g., number of files transferred, total size, data processing, etc).

Implementing a worker will likely require some coding to address the specific
needs of a given task. However, some base classes have already been implemented
to help with server communication and other operations.
We also provide some examples that may serve as a starting point for developing new workers.


Basic Classes
-------------
When implementing a new worker, we need to deal with two main classes:
`TaskHandler` and `Worker`. In the `TaskHandler`, we need to implement the `process`
method that will take care of the task processing. This method will be called
inside the handler infinite loop until the `stop` method is called. The following
examples provide some valuable tips.

Examples
--------

Cluster Queues Worker
.....................

This example shows an existing worker who monitors the jobs of a queueing system.
The worker code is simple, mainly defining that it can handle a “cluster-lsf”
task by registering a ``TaskHandler`` for it.

.. code-block:: python

    class LSFWorker(Worker):
        def handle_tasks(self, tasks):
            for t in tasks:
                if t['name'] == 'cluster-lsf':
                    handler = LSFTaskHandler(self, t)
                else:
                    handler = DefaultTaskHandler(self, t)
                handler.start()


Then, the task handler implements the `process` function and
uses the function ``LSF().get_queues_json('cryo')``
to retrieve information about the jobs running on the “cryo” queues.
That part could be modified to adapt this worker to a different queueing system.
The retrieved information is stored in ``args[‘queues’]`` as a JSON string and
sent to the EMhub server via the function `update_task`.

.. code-block:: python

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



EPU Session Monitoring
......................

This example shows the implementation of a `TaskHandler` that monitors a filesystem path
to detect new EPU session folders. It uses the function `request_config` to get
configuration information from the EMhub server. In this case, it gets the location
where the raw frames will be written. The `process` function will be called indefinitely, and the handler will scan the location to find new folders. Similarly to the previous example, the information is sent back to EMhub as a JSON string via `update_task`.


.. code-block:: python

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


Data Transfer and On-The-Fly Processing
.......................................

Here is a more complex example of a worker who handles data transfer or on-the-fly data
processing for a given session. It gets new tasks from the EMhub server and retrieves
data about the assigned session. It also updates the session info as the tasks are being
processed.

Check the `Sessions Worker <https://github.com/3dem/emhub/blob/devel/emhub/client/session_worker.py>`_ code in Github.
`