
Developing Workers
==================

Overview
--------

Workers are Python scripts that communicate with EMhub via its REST API
(:ref:`using Python client code <Using EMhub Client>`). It is a good
mechanism to extend EMhub functionality and get some tasks executed in
machines other than those running the EMhub server. The main difference between
a worker and another script using the API is that the worker is supposed to run
all the time (e.g., as a Linux service) and maintain two-way communication with the EMhub server
via task handling.

For example, one could use a worker in a machine that has access
to the image acquisition directory. That worker could get notified (via a task)
when a new session has started and where are the expected image files. From there,
the worker can handle data transfer and trigger on-the-fly processing if required.
It can also update the information related to that session, reflecting the progress
of the associated tasks (e.g., number of files transferred, total size, data processing, etc).

Implementing a worker will likely require some coding to address the specific
needs of a given task. However, some base classes have already been implemented
to help with server communication and other operations. In this section, we will
go through a comprehensive example of a worker implementation that will also
touch on different aspects of the system architecture.


Implementing a basic OTF worker
-------------------------------

In this example, we will implement a simple EMhub worker that will launch a
CryoEM on-the-fly data processing. The workflow will use Scipion to run the pipeline
and will execute the following steps: import, motioncor, ctffind and cryolo.

Installation with Scipion and Redis setup
.........................................

Let's start by by :ref:`installing EMhub with Scipion <Installation with Scipion>`
since we will need it to launch the OTF workflow.

.. note::
    If you are using a different software for the workflow, then it is not required
    to install EMhub with Scipion.

Generate the test dataset to use it as the starting point for our next steps:

.. code-block:: bash

    emh-data --create_instance

The workers' interactions with EMhub via tasks require more communication and
concurrency than other operations. Thus, Redis is required for in-memory storage
of task information, as well as some caching. We need to ensure that we have
properly installed Redis (server side and Python client library for EMhub).
Moreover, the redis.conf file should be provided in the instance folder.
Check more about it on the :ref:`Caching with Redis` page.

Summarizing:

.. code-block:: bash

    # Install Redis server and client from conda
    conda install -y redis redis-py -c conda-forge

    # Copy Redis conf file from template
    mv $EMHUB_INSTANCE/redis.conf.template $EMHUB_INSTANCE/redis.conf

    # Run Redis server in background
    cd $EMHUB_INSTANCE && redis-server redis.conf --daemonize yes

    # Test connection with Redis server:
    redis-cli -p 5001 set foo boo
    emh-client redis --keys

Testing the Client and basic Worker
...................................

Once EMhub's server is running, we can open a new terminal and configure the
environment for using a REST client. Load the EMhub environment (e.g. conda
environment) and set the variables accordingly. In the test instance, there
is a ``$EMHUB_INSTANCE/bashrc`` file that one can easily source:

.. code-block:: bash

    source $EMHUB_INSTANCE/bashrc

    # Check if the client is properly configured

    emh-client
    # Should print all EMHUB_* variables and their values

    emh-client form -l all
    # Should print the list of Forms from the server


When we are sure that the client can communicate properly with the server, we need
to register our machine as a possible worker. First, find out what is the hostname
as given by the following command:

.. code-block:: bash

    emt-ps --hostname
    c124663

Then you need to edit the form ``config:hosts`` JSON (from the Forms page)
with that host as key (in my case *c124663*) as in the following example:

.. code-block:: json

    {
        "c124663": {"alias": "c124663"}
    }

Once the hostname is registered as a possible host, we can launch a test
worker to check if it connects with the server:

.. code-block:: bash

    python -m emhub.client.worker

If everything goes well, you should see the worker log and it should be ready
for handling tasks. If we look again into the ``config:hosts`` form, now the
entry should be extended with your machine hardware as reported by the worker.
In my case it looks like the following:

.. code-block:: json

    {
        "c124663": {
            "alias": "c124663",
            "updated": "2024-06-16 12:08:52",
            "specs": {
                "CPUs": 128,
                "GPUs": {
                    "NVIDIA GeForce RTX 3090": {
                        "count": 2,
                        "memory": "24576 MiB"
                    }
                },
                "MEM": 503
            },
            "connected": "2024-06-16 12:08:52"
        }
    }

Now we can go to the *Workers* page and check the our host appears there (green
and with a recent "Last update" value). We can go ahead and create a "command"
task to test if the worker handles it correctly. Click on the *Create Task* button
and specify *command* as the task name and *{"cmd": "ls -l /tmp/"}* as the args.
After that a new Task entry should appear as *Pending* and in the worker terminal
it should noticed the new tasks and work on it. This simple task will execute
the provide command and send back the results in the Task history. After some time,
you should be able to see the task as *Done* and open the history to see the result.


Creating Session to trigger OTF
...............................

Now we have all the pieces to start developing a worker for OTF data processing.
If you go the the Dashboard page of your test instance, you might see some bookings
for this week. If you click on the "Cr


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

