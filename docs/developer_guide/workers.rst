
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


Launching a basic OTF worker
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
In my case, it looks like the following:

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


Now we need to navigate to the *Workers* page and ensure that our host is displayed there in 
green with a recent "Last update" value. Next, we can create a "command" task to verify if 
the worker processes it correctly. Click on the *Create Task* button and enter *command* as 
the task name and *{"cmd": "ls -l /tmp/"}* as the arguments. Subsequently, a new Task entry 
should appear as *Pending*, and the worker terminal should acknowledge the new tasks and 
begin processing them. This task will run the provided command and report 
back the results in the Task history. After a while, you should be able to view the task 
status as *done* and review the results in the history.


Creating a Session to trigger OTF
.................................

We have all the components ready to begin developing a worker for OTF data processing. 
If you visit the Dashboard page of your test instance, you might notice some bookings 
for this week. When you click on the "New Session" button, an error will occur. This 
is because we still need to create a dialog page for setting up a new session and 
establish the necessary infrastructure to handle it.


Let's first create an ``$EMHUB_INSTANCE/extra`` folder for extra customization
and copy some files we already have as examples.

.. code-block:: bash

    mkdir $EMHUB_INSTANCE/extra

    cp -r $SCIPION_HOME/source/core/emhub/extras/test/* $EMHUB_INSTANCE/extra/

This should copy the following files:

.. csv-table::
   :widths: 20, 50

   "`extra/templates/create_session_form.html <https://github.com/3dem/emhub/blob/devel/extras/test/templates/create_session_form.html>`_", "Template file to define the session creation dialog."
   "`extra/data_content.py <https://github.com/3dem/emhub/blob/devel/extras/test/data_content.py>`_", "File defining content functions to support template files, in this case *create_session_form*."
   "`extra/test_worker.py <https://github.com/3dem/emhub/blob/devel/extras/test/test_worker.py>`_", "Test worker to launch OTF workflow."

Read more about :ref:`EMhub customization here<Customizing EMhub>`.

After copying the additional files, ensure that the EMhub server is stopped, 
along with the worker that was running in the previous section. Restart the 
EMhub server by running "flask run --debug" to reload the content from 
"$EMHUB_INSTANCE/extra". In the worker terminal (with the client environment 
already configured), execute:

.. code-block:: bash

    python $EMHUB_INSTANCE/extra/test_worker.py

Remember to click on the "New Session" button again from the Dashboard page 
to open the session dialog. Make sure to input a folder with data, specify 
the image pattern, and provide the gain reference image file. Also, select 
"Scipion" as the workflow and choose an output folder.

.. tab:: New session dialog

    .. image:: https://github.com/3dem/emhub/wiki/images/emhub_new_session_test.png
       :width: 100%

.. tab:: Example of input parameters

    .. image:: https://github.com/3dem/emhub/wiki/images/emhub_new_session_testFILLED.png
       :width: 100%


After creating the session, two tasks will be generated: "monitor" and "otf_test". 
The "monitor" task will instruct the worker to monitor the input folder and provide 
information about the number of files, images, and overall folder size. 
The "otf_test" task will launch the OTF workflow with Scipion. Below, you can find 
the related session pages.


.. tab:: Session Info page

    .. image:: https://github.com/3dem/emhub/wiki/images/emhub_new_session_test_info.png
       :width: 100%

.. tab:: Session Live page

    .. image:: https://github.com/3dem/emhub/wiki/images/emhub_new_session_test_live2.png
       :width: 100%

Continue reading the next section to delve into the code of the files in "extra" 
and better understand the role of the underlying components.


Understanding underlying components
-----------------------------------

Jinja2/HTML/Javascript
......................

In the file `extra/templates/create_session_form.html <https://github.com/3dem/emhub/blob/devel/extras/test/templates/create_session_form.html>`_, we define the HTML template for arranging the inputs in the session dialog. Additionally, we write some JavaScript code to retrieve the values input by the user and communicate with the server to create tasks related to the session, which will be handled by the worker. Let's take a look at a code fragment from that file:

.. code-block:: html+jinja
    :caption: Code fragment from: extra/templates/create_session_form.html
    :linenos:
    :emphasize-lines: 3, 7, 17

    <!-- Modal body -->
    <div class="modal-body">
    <input type="hidden" id="booking-id" value="{{ booking.id }}">

    <!-- Create Session Form -->
    <div class="col-xl-12 col-lg-12 col-md-12 col-sm-12 col-12">
        <form id="session-form" data-parsley-validate="" novalidate="">
            <div class="row">
                <!-- Left Column -->
                <div class="col-7">
                    {{ section_header("Basic Info") }}

                    <!-- Some lines omitted here -->

                    <!-- Project id -->
                    {% call macros.session_dialog_row_content("Project ID") %}
                        <select id="session-projectid-select" class="selectpicker show-tick" data-live-search="true" data-key="project_id">
                                <option value="0">Not set</option>
                                {% for p in projects %}
                                    {% set selected = 'selected' if p.id == booking.project.id else '' %}
                                    <option {{ selected }} value="{{ p.id }}">{{ p.title }}</option>
                                {% endfor %}
                            </select>
                    {% endcall %}

                    {{ section_header("Data Processing", 3) }}
                    {{ macros.session_dialog_row('Input RAW data folder', 'raw_folder', '', 'Provide RAW data folder') }}
                    {{ macros.session_dialog_row('Input IMAGES pattern', 'images_pattern', acquisition['images_pattern'], '') }}
                    {{ macros.session_dialog_row('Input GAIN image', 'gain', '', '') }}
                    {{ macros.session_dialog_row('Output OTF folder', 'otf_folder', '', '') }}


In line 3, we are defining a hidden input and the value is expanded to the *booking.id*.
The *booking* variable should be provided to render the template by the corresponding
content function (*create_session_form*).

In line 7, we are defining a form that will help us conveniently retrieve all the values 
provided by the user. To achieve this, the inputs need to define the *data-key* value, 
which will be used as the key in the collected data mapping (e.g., line 17). Additionally, 
we are defining *data-key* values in lines 27 to 30 by using Jinja2 macros. These macros 
make it easy to generate repeating blocks of HTML template with different parameters.

The JavaScript section of this template file also plays an important role in compiling 
the information provided by the user and creating tasks using EMhub's REST API.

.. code-block:: javascript
    :caption: Javascript fragment from extra/templates/create_session_form.html
    :linenos:
    :emphasize-lines: 2, 6, 15, 35

    function onCreateClick(){
        var formValues = getFormAsJson('session-form');
        var host = formValues.host;
        var attrs = {
            booking_id: parseInt(document.getElementById('booking-id').value),
            acquisition: {
                voltage: formValues.acq_voltage,
                magnification: formValues.acq_magnification,
                pixel_size: formValues.acq_pixel_size,
                dose: formValues.acq_dose,
                cs: formValues.acq_cs,
                images_pattern: formValues.images_pattern,
                gain: formValues.gain
            },
            tasks: [['monitor', host]],
            extra: {
                project_id: formValues.project_id, raw: {}, otf: {}
            }
        }

        // Some lines omitted here

        // Validate that the OTF folder is provided if there is an OTF workflow selected
        if (formValues.otf_folder){
            attrs.tasks.push(['otf_test', host])
            attrs.extra.otf.path = formValues.otf_folder;
            attrs.extra.otf.workflow = formValues.otf_workflow;
        }
        else if (formValues.otf_workflow !== 'None') {
            showError("Provide a valid <strong>OUTPUT data folder</strong> if " +
                "doing any processing");
            return;
        }

        var ajaxContent = $.ajax({
            url: "{{ url_for('api.create_session') }}",
            type: "POST",
            contentType: 'application/json; charset=utf-8',
            data: JSON.stringify({attrs: attrs}),
            dataType: "json"
        });

        ajaxContent.done(function(jsonResponse) {
            if ('error' in jsonResponse)
                showError(jsonResponse['error']);
            else {
                window.location = "{{ url_for_content('session_default') }}" +
                    "&session_id=" + jsonResponse.session.id;
            }
        });

First, on line 2, all input values are retrieved from the form. Then, on line 6, 
the *acquisition* object is prepared as expected by the server REST endpoint. 
On line 15, an initial task *monitor* is defined, and an extra task *otf_test* 
is added on line 24 if the *otf_folder* has a non-empty value. 
The second parameter of the tasks is the hostname where they will be executed, 
which the user provides in the session form. 
Finally, on line 35, the AJAX request is sent to create a new session. If the result 
is successful, the page is reloaded, or an error is shown otherwise.


The Content Function
....................

To render the template page, the *create_session_form* is needed, which should
provide all the required data. This function should be provided in the `extra/data_content.py <https://github.com/3dem/emhub/blob/devel/extras/test/data_content.py>`_ file.


.. code-block:: python
    :caption: Content function in extra/data_content.py
    :linenos:
    :emphasize-lines: 7, 10, 21

    @dc.content
    def create_session_form(**kwargs):
        """ Basic session creation for EMhub Test Instance
        """
        dm = dc.app.dm  # shortcut
        user = dc.app.user
        booking_id = int(kwargs['booking_id'])

        # Get the booking associated with this Session to be created
        b = dm.get_booking_by(id=booking_id)
        can_edit = b.project and user.can_edit_project(b.project)

        # Do some permissions validation
        if not (user.is_manager or user.same_pi(b.owner) or can_edit):
            raise Exception("You can not create Sessions for this Booking. "
                            "Only members of the same lab can do it.")

        # Retrieve configuration information from the Form config:sessions
        # We fetch default acquisition info for each microscope or
        # the hosts that are available for doing OTF processing
        sconfig = dm.get_config('sessions')

        # Load default acquisition params for the given microscope
        micName = b.resource.name
        acq = sconfig['acquisition'][micName]
        otf_hosts = sconfig['otf']['hosts']

        data = {
            'booking': b,
            'acquisition': acq,
            'session_name_prefix': '',
            'otf_hosts': otf_hosts,
            'otf_host_default': '',
            'workflows': ['None', 'Scipion'],
            'workflow_default': '',
            'transfer_host': '',
            'cryolo_models': {}
        }
        data.update(dc.get_user_projects(b.owner, status='active'))
        return data

This content function is designed to take in one parameter, which is the *booking_id*. 
It is read in line 7 and used in line 10 to fetch the *Booking* entry from the database using SqlAlchemy ORM.
In line 21, an example demonstrates the process of retrieving "configuration" forms, 
which follow the naming convention of *config:NAME*, and then utilizing them in the session 
(or any template page) dialog. In this instance, we are making use of *config:session* to automatically 
populate default acquisition values for different microscopes. Finally, the *data* dictionary is made up 
of various key-value pairs and is returned. This data will be utilized by Flask to render the template.


The Worker Script
.................

The last component is the worker code in 
`extra/test_worker.py <https://github.com/3dem/emhub/blob/devel/extras/test/test_worker.py>`_. 
Workers are typically created using subclasses of two classes: `TaskHandler` and `Worker`. 
The `Worker` class establishes the connection with EMhub and defines the types of tasks it 
will react to by creating the corresponding `TaskHandler`. This class will then "process" 
the given tasks. The code fragment below shows the *process* function for our `TaskHandler`.

.. code-block:: python

    def process(self):
        try:
            if self.action == 'monitor':
                return self.monitor()
            elif self.action == 'otf_test':
                return self.otf()
            raise Exception(f"Unknown action {self.action}")
        except Exception as e:
            self.update_task({'error': str(e), 'done': 1})
            self.stop()

Here, the handler defines a *process* function for tasks of type *monitor* or *otf_test* and launches an error otherwise.

.. important::

    The *process* function will be called from an infinite loop. The handler can
    set the *self.sleep* attribute to sleep that many seconds between calls. It
    should also call the function *self.stop()* when the task is completed
    (successfully or with failure) and no more processing is needed. The attribute
    *self.count* can also be used to know the count of *process* function calls.

Below is the *monitor* function that basically check the number of files
and their size in the input data folder. It will update back the task with
that information.

.. code-block:: python
    :linenos:
    :emphasize-lines: 6

    def monitor(self):
        extra = self.session['extra']
        raw = extra['raw']
        raw_path = raw['path']
        # If repeat != 0, then repeat the scanning this number of times
        repeat = self.task['args'].get('repeat', 1)

        if not os.path.exists(raw_path):
            raise Exception(f"Provided RAW images folder '{raw_path}' does not exists.")

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

In line 6, there is an optional parameter called *repeat* which indicates the 
number of times to repeat the "monitor". The ``MovieFiles`` class from the *emtools* 
library is instantiated in line 15 and utilized in line 17 to scan the input 
folder. This class incorporates a caching mechanism to prevent re-reading files 
that have already been read. In line 20, the function *update_function_extra* 
is invoked to update the *extra* property of the session with the retrieved 
information. Subsequently, in line 28, the task is updated, setting *done=1*, 
which marks the task as completed.

The following code snippet displays the *otf* function, which shares some similarities 
with the *monitor* function but performs different tasks. The main distinctions are in 
line 13, where a JSON configuration file is created, and in line 20, where the workflow 
is initiated.

.. code-block:: python
    :linenos:
    :emphasize-lines: 13, 20

    def otf(self):
        # Some lines omitted here

        # Create OTF folder and configuration files for OTF
        def _path(*paths):
            return os.path.join(otf_path, *paths)

        self.pl.mkdir(otf_path)
        os.symlink(raw_path, _path('data'))
        acq = self.session['acquisition']
        # Make gain relative to input raw data folder
        acq['gain'] = _path('data', acq['gain'])
        with open(_path('scipion_otf_options.json'), 'w') as f:
            opts = {'acquisition': acq, '2d': False}
            json.dump(opts, f, indent=4)

        otf['status'] = 'created'

        # Now launch Scipion OTF
        self.pl.system(f"scipion python -m emtools.scripts.emt-scipion-otf --create {otf_path} &")


Other Worker Examples
---------------------

Cluster Queues Worker
.....................

This example demonstrates an existing worker responsible for monitoring the jobs 
of a queueing system. The worker code is simple, mainly defining its capability 
to handle a “cluster-lsf” task by registering a `TaskHandler` for it.

.. code-block:: python

    class LSFWorker(Worker):
        def handle_tasks(self, tasks):
            for t in tasks:
                if t['name'] == 'cluster-lsf':
                    handler = LSFTaskHandler(self, t)
                else:
                    handler = DefaultTaskHandler(self, t)
                handler.start()


In the next step, the task handler will implement the *process* function
and use the function ``LSF().get_queues_json('cryo')`` to retrieve information
about the jobs running on the "cryo" queues. This part can be modified to 
make this worker compatible with a different queueing system. The retrieved 
information will be stored in ``args['queues']`` as a JSON string and then
sent to the EMhub server using the *update_task* function.

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

In this example, we have implemented a `TaskHandler` that monitors a 
filesystem path in order to detect new EPU session folders. It utilizes 
the `request_config` function to obtain configuration information from 
the EMhub server. Specifically, it retrieves the location where the raw 
frames will be written. The `process` function is designed to be called 
continually, allowing the handler to scan the location for new folders. 
As with the previous example, the gathered information is sent back to 
EMhub as a JSON string through the `update_task` function.


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

Below is a more detailed example of a worker responsible for managing data transfer 
or processing data in real time during a specific session. It receives new tasks 
from the EMhub server, retrieves information about the assigned session, and updates 
the session details as the tasks are processed.

Check the `Sessions Worker <https://github.com/3dem/emhub/blob/devel/emhub/client/session_worker.py>`_ code in Github.

