
==================================
St. Jude: Sessions and OTF Flow
==================================

This page describes how a microscope session goes at St. Jude, from its
creation in EMhub to the On-The-Fly (OTF) processing of the data:

1. A session is created from a booking, with the EMhub *Create Session* form.
2. The **transfer worker** moves the movies from the microscope frames buffer
   to the raw storage (GSCEM) and delivers them to the lab (Jude) storage.
3. The **OTF worker** creates an emwrap project when there is enough data,
   detecting if it is single-particle (SPA) or tomography, launches it and
   reports its status back to EMhub.
4. EMhub shows the session data and the OTF results.

It also describes the configuration side: which values come from the form,
which ones from the ``sessions`` config, and how the workflow template and the
jobs params are selected.

.. contents:: Contents
    :local:
    :depth: 2


Overview
--------

.. graphviz::
    :caption: Main components and data flow

    digraph overview {
        rankdir=TB;
        nodesep=0.5;
        node [shape=box, style="rounded,filled", fillcolor="#f5f5f5",
              fontname="Helvetica", fontsize=11];
        edge [fontname="Helvetica", fontsize=9];

        subgraph cluster_emhub {
            label="EMhub server"; style=dashed; fontname="Helvetica";
            form [label="Create Session\nform", fillcolor="#dbe9f6"];
            api [label="REST API\n+ sessions DB"];
            redis [label="Redis\nlogs / task streams"];
            pages [label="Session pages\nWorkers page", fillcolor="#dbe9f6"];
            {rank=same; form; api; redis; pages;}
        }

        epu [label="Microscope\nframes buffer\n(acquisition.frames)", shape=cylinder];

        subgraph cluster_workers {
            label="Session workers (emh-session-worker)"; style=dashed;
            fontname="Helvetica";
            tw [label="transfer worker\nframes / transfer / deliver",
                fillcolor="#fde9c9"];
            ow [label="OTF worker\notf", fillcolor="#fde9c9"];
        }
        {rank=same; epu; tw; ow;}

        raw [label="GSCEM raw storage\n(raw.root)", shape=cylinder];
        jude [label="Jude lab storage", shape=cylinder];
        otf [label="OTF project\n(otf.root/..._OTF_emwrap)\nemwrap jobs", shape=folder,
             fillcolor="#e2f0d9"];
        {rank=same; raw; jude; otf;}

        form -> api [label="create_session"];
        api -> redis -> pages;
        api -> tw [label="new active\nsessions (poll)"];
        api -> ow [label="new active\nsessions (poll)"];
        tw -> redis [label="update_log\nupdate_session_extra", style=dashed, constraint=false];
        ow -> redis [label="update_log\nupdate_session_extra", style=dashed, constraint=false];
        epu -> tw [label="rsync movies"];
        tw -> raw [label="transfer"];
        tw -> jude [label="deliver (rsync)"];
        raw -> otf [label="data symlink", constraint=false];
        ow -> otf [label="create + launch\n+ monitor"];
        otf -> pages [label="session.json\nSTAR outputs", style=dotted, constraint=false];
    }

Both workers are the same program (``session_worker_stjude.py`` in
``emhub-extras``), started with a different type. They poll EMhub for new
active sessions; each session task runs in its own process:

.. code-block:: bash

    emh-session-worker worker transfer   # frames, transfer, deliver
    emh-session-worker worker otf        # otf (create, launch and monitor)


Session lifecycle
-----------------

.. graphviz::
    :caption: Timeline of a session (lanes are who does each step)

    digraph lifecycle {
        rankdir=TB;
        newrank=true;
        node [shape=box, style="rounded,filled", fontname="Helvetica",
              fontsize=10, fillcolor="#f5f5f5"];
        edge [fontname="Helvetica", fontsize=9];

        subgraph cluster_user {
            label="User / staff (EMhub)"; style=dashed; fontname="Helvetica";
            u1 [label="Open Create Session\nfrom the booking", fillcolor="#dbe9f6"];
            u2 [label="Fill form, select\nframes folder + workflow", fillcolor="#dbe9f6"];
        }
        subgraph cluster_emhub {
            label="EMhub"; style=dashed; fontname="Helvetica";
            e1 [label="DataManager.create_session\nstatus = active"];
            e2 [label="Session page:\ndetails / live OTF"];
        }
        subgraph cluster_transfer {
            label="Transfer worker"; style=dashed; fontname="Helvetica";
            t0 [label="frames task (per microscope)\nlists EPU folders", fillcolor="#fde9c9"];
            t1 [label="transfer task\nframes -> raw path", fillcolor="#fde9c9"];
            t2 [label="deliver task\nraw -> Jude", fillcolor="#fde9c9"];
        }
        subgraph cluster_otf {
            label="OTF worker"; style=dashed; fontname="Helvetica";
            o1 [label="otf task: wait\nraw.movies > 8", fillcolor="#fde9c9"];
            o2 [label="create_otf_folder\n(gain, README, emwrap project)", fillcolor="#e2f0d9"];
            o3 [label="launch_otf\notf[workflow].command", fillcolor="#e2f0d9"];
            o4 [label="monitor processes / jobs\nreport status", fillcolor="#e2f0d9"];
        }

        t0 -> u2 [label="Session Folder\nchoices", style=dashed];
        u1 -> u2 -> e1;
        e1 -> t1 [label="poll"];
        e1 -> o1 [label="poll"];
        t1 -> t2 [label="+60 s"];
        t1 -> o1 [label="raw.path, raw.movies\n(session extra)", style=dashed];
        o1 -> o2 -> o3 -> o4;
        o4 -> e2 [label="otf.status"];
        t1 -> e2 [label="raw info", style=dashed];
    }

1. **Frames monitoring.** The transfer worker always runs one ``frames`` task
   per microscope. It scans the frames buffer roots
   (``acquisition[<Mic>]['frames']``) and logs the folders found in the EMhub
   log ``frames:<Mic>``. This list fills the *Session Folder* select in the
   form.
2. **Session creation.** The user creates the session from a booking (see
   `The Create Session form`_). The session is stored with
   ``status = 'active'``.
3. **Polling.** Each worker long-polls ``api/poll_active_sessions`` for
   active sessions newer than the last one seen, and only takes sessions
   starting within ±7 days. The worker state (active and done tasks) is kept in
   ``worker.json``, so tasks are resumed if the worker is restarted.
4. **Transfer.** The transfer worker adds a ``transfer`` task and, 60 s later,
   a ``deliver`` task for the session (see `Transfer and delivery`_).
5. **OTF.** The OTF worker adds an ``otf`` task, that waits for the data and
   then creates, launches and monitors the OTF project (see
   `OTF creation and monitoring`_).
6. **Display.** EMhub shows the session details and, once the OTF is running,
   the live processing results.


The Create Session form
-----------------------

The dialog is opened from the dashboard instrument card (``createSession``),
with the template set in ``sessions['create_session'][<Mic>]['template']``.
The content function is ``create_session_form`` (``emhub-extras/data_content.py``)
and the template is ``create_session_form.html``.

Only managers, members of the same lab or project editors can create a
session for a booking.

.. list-table:: Form fields
    :header-rows: 1
    :widths: 25 30 45

    * - Field
      - Stored in
      - Notes
    * - Session Folder
      - ``name`` (``<YYYYMMDD><Mic>:<folder>``)
      - Folders found by the ``frames`` task. The part after ``:`` is the
        frames folder to transfer.
    * - Owner, staff, microscope
      - ``owner_id``, ``operator_id``, ``resource_id``
      - Read-only, from the booking.
    * - Project
      - ``extra.project_id``
      -
    * - Voltage, magnification, pixel size, Cs, dose (per frame)
      - ``acquisition``
      - Defaults from ``sessions['acquisition'][<Mic>]``.
    * - OTF host *(advanced, admins)*
      - ``extra.otf.host``
      - Choices ``otf.hosts``, default ``otf.hosts_default[<Mic>]``.
    * - OTF workflow *(advanced, admins)*
      - ``extra.otf.workflow``
      - Choices ``otf.workflows``, default ``otf.workflow_default``. Its
        (lowercase) value is the key of the workflow config
        ``sessions['otf'][<workflow>]``.
    * - Raw folder *(advanced, admins)*
      - ``extra.raw.path``
      - Existing data, no transfer: a ``monitor`` task scans the folder.
    * - OTF folder *(advanced, admins)*
      - ``extra.otf.path``
      - Existing OTF folder, no project creation.

The form posts to ``api/create_session``. ``DataManager.create_session``
validates the name, sets the resource, operator and start time from the
booking, stores the session and creates the worker tasks given in ``tasks``
(only for the *raw folder* case; normally the workers find the new session by
polling).

The session JSON then looks like:

.. code-block:: json

    {
        "name": "20261019Krios02:Smith_apoferritin",
        "resource_id": 2,
        "status": "active",
        "acquisition": {"voltage": "300", "magnification": "130000",
                        "pixel_size": "0.93", "cs": "2.7", "dose": "1.0"},
        "extra": {
            "project_id": 123,
            "raw": {},
            "otf": {"workflow": "emwrap", "host": "otf-host01", "cryolo_model": ""}
        }
    }

The workers fill ``extra`` later on: ``raw`` (``frames``, ``path``, number of
movies and last file times), ``jude`` (``last_delivered``) and ``otf``
(``path`` and ``status``).


Transfer and delivery
---------------------

**transfer** (transfer worker)
    * Frames path: ``<acquisition.frames root>/<folder from the session name>``.
    * Raw path:
      ``<raw.root>/<group>/<Mic>/<year>/raw/EPU/<user>/<YYYYMMDD>_<Mic>_<name>/``,
      where ``<user>`` is built from the owner email (e.g. ``jsmith``).
    * Files are transferred once they have not changed for 30 s, in batches:
      movies with ``rsync --remove-source-files``, metadata files are copied.
    * After each batch it updates ``extra.raw`` (movies count, last creation
      times) and logs the transfer size and speed.
    * It finishes when the last file of the frames or raw folder is older
      than 24 hours (``TRANSFER_STOP_WAIT``), removing the frames folder if
      it is empty.

**deliver** (transfer worker)
    Rsync of the raw folder to the lab storage (``raw.jude_group_folder``,
    with ``raw.jude_group_mapping``), every 1 to 10 minutes, updating
    ``extra.jude.last_delivered``. It finishes 24 hours after the last rsync
    that delivered files (task arg ``wait`` in seconds), but not while
    rsync is failing.

Both tasks add a ``summary`` (JSON) to their log events: total files and
size, average speed, last transfer, idle minutes, pending files, rsync
errors, the estimated closing time and a state (``active``, ``waiting``, or
``stalled`` with pending files or rsync errors and no transfer for 30
minutes). It is sent with the events of each rsync and, when idle, at most
every 10 minutes; the Workers > Sessions page shows it in the Progress
column.

**monitor** (only when an existing raw folder is given)
    Scans the raw folder and updates ``extra.raw``, without transfer.


OTF creation and monitoring
---------------------------

The ``otf`` task of the OTF worker checks the session every 60 s (120 s once
the OTF is running). The OTF folder is ``extra.otf.path`` or, by default,
``<otf.root>/<YYYYMMDD>_<Mic>_<name>_OTF_emwrap``.

.. graphviz::
    :caption: Status of the otf task (``extra.otf.status``)

    digraph otf_status {
        rankdir=LR;
        node [shape=box, style="rounded,filled", fillcolor="#f5f5f5",
              fontname="Helvetica", fontsize=10];
        edge [fontname="Helvetica", fontsize=9];

        wait [label="waiting\nfor data"];
        created [label="created", fillcolor="#e2f0d9"];
        running [label="running", fillcolor="#e2f0d9"];
        stopped [label="stopped"];
        finished [label="finished", fillcolor="#dbe9f6"];
        failed [label="failed", fillcolor="#f8d7da"];
        cancelled [label="cancelled", fillcolor="#f8d7da"];

        wait -> created [label="raw.movies > 8\ncreate_otf_folder"];
        wait -> cancelled [label="no files / no raw folder\nafter 1 day"];
        created -> running [label="launch_otf"];
        running -> stopped [label="no processes"];
        stopped -> finished [label="1 idle day,\nall outputs"];
        running -> failed [label="failed jobs"];
        stopped -> running [label="resume / restart", style=dashed];
        failed -> running [label="otf_restart\n(clean | continue)", style=dashed];
    }

**create_otf_folder**
    1. Create the folder, with a ``data`` symlink to the raw folder.
    2. Find the gain: the newest file matching ``acquisition.gain_pattern`` in
       the raw folder or in the gain storage (``data.gain``), and keep both
       locations in sync.
    3. Write ``README.txt`` with the session, user and acquisition info.
    4. Create the emwrap project with ``OTF.fromSession`` (``emwrap.mix.otf``),
       that selects the OTF class (SPA or tomography, see below), and
       ``otf.create(session, sconfig, resources)``. The type detection is
       logged in the task log. The project is checked and the status is set
       to ``created``.

**launch_otf**
    Runs ``sessions['otf'][<workflow>]['command']``, formatted with
    ``{otf_path}`` and ``{session_id}``, in the background. If the workflow is
    ``none``, nothing is launched. The command runs the OTF runner of emwrap,
    that launches each job once its input has some data:

    .. code-block:: bash

        # e.g. 'command': "cd {otf_path} && emh-tomo --launch emwrap.mix.otf --run"
        emh-tomo --launch emwrap.mix.otf --run

**Monitoring**
    The task checks the ``emw`` processes in the OTF folder and the status of
    the jobs, and reports them with ``update_log`` (status, processes, jobs,
    last output, idle minutes) and ``update_session_extra``.

**Commands from EMhub**
    The session page (admins) can send ``otf_restart`` (``mode``: ``clean`` to
    create the project again, or ``continue``) and ``otf_stop`` tasks to the
    OTF worker host. Stop also kills the OTF runner and the running jobs, that
    are marked as aborted so they can be continued.

**Stopping the worker**
    When the worker is stopped (``systemctl stop``/``restart``: SIGTERM,
    Ctrl-C: SIGINT, or closed terminal: SIGHUP), its main process stops the
    task processes and, for each OTF task with running processing, the OTF
    (``OTF.stop``: runner, local and cluster jobs, marked as aborted). These
    tasks are marked with ``shutdown`` in ``worker.json`` and the session
    shows the OTF as ``stopped``. When the worker starts again they are
    resumed with ``restart: continue``: the jobs continue with their outputs.
    OTF tasks still waiting for data are resumed as usual.

    The task processes ignore Ctrl-C and terminal hangups, so the worker
    coordinates the shutdown. For the service, only the worker must receive
    SIGTERM: the unit uses ``KillMode=mixed`` (with ``TimeoutStopSec`` long
    enough to stop the OTFs), and the start script runs the worker with
    ``exec python ...`` so it is the main process. With the default
    ``KillMode=control-group`` all processes get SIGTERM at once, so the OTF
    processing is killed without being stopped (it is still continued when the
    worker starts again, if it was active in the last day).

    .. code-block:: ini
        :caption: emhub-worker-otf.service (relevant lines)

        [Service]
        ExecStart=/usr/local/em/scripts/emhub-worker-otf.sh
        Restart=on-failure
        RestartSec=30
        KillMode=mixed
        TimeoutStopSec=180


SPA or tomography
-----------------

The OTF class, and so the workflow template and jobs, is taken from
``sessions['otf'][<workflow>]['emwrap_otf']``:

* ``"spa"``, ``"tomo"`` or ``"module.Class"``: that class.
* ``"auto"`` (default): detected from the session data.
* a dict, e.g. ``{"tomo": "my_module.MyTomoOTF"}``: the class for the detected
  type (only needed for customizations that settings can not express).

There are no St. Jude subclasses: the instance specifics are settings in the
``sessions`` config (see `Configuration`_).

.. graphviz::
    :caption: Detection of the OTF type (``OTF.detectType``)

    digraph detect {
        node [shape=box, style="rounded,filled", fillcolor="#f5f5f5",
              fontname="Helvetica", fontsize=10];
        edge [fontname="Helvetica", fontsize=9];

        any [label="mdoc files in data/?\n(tomo mdoc_pattern or\n*.mdoc, */*.mdoc)", shape=diamond];
        ts [label="any mdoc with\n> 1 ZValue section?", shape=diamond];
        spaimg [label="SPA images_pattern\nmatches files?", shape=diamond];
        tomo [label="TomoOTF\ntomo-otf template", fillcolor="#e2f0d9"];
        spa [label="SpaOTF\nspa-otf template", fillcolor="#dbe9f6"];

        any -> ts [label="yes"];
        any -> spa [label="no"];
        ts -> tomo [label="yes (tilt series)"];
        ts -> spaimg [label="no"];
        spaimg -> spa [label="yes"];
        spaimg -> tomo [label="no (first tilt\nbeing acquired)"];
    }

SerialEM mdoc files of SPA movies have ``FrameSet`` sections, not ``ZValue``
ones, so they are not taken as tilt series.

.. list-table:: Default processing by type
    :header-rows: 1
    :widths: 20 40 40

    * -
      - SPA (``SpaOTF``)
      - Tomography (``TomoOTF``)
    * - Template
      - ``spa-otf``
      - ``tomo-otf``
    * - Jobs
      - ``emw-import-movies``, ``emw-preprocessing`` (MotionCor, ctffind,
        crYOLO, extraction), ``emw-rln2d``
      - ``emw-import-ts``, ``emw-warp-otf``, ``emw-aretomo3``
    * - Input
      - ``data/<images_pattern>``
      - ``data/<mdoc_pattern>`` and the tilt images folder
    * - Data dependent params
      - MotionCor patches from the image size, gain flip/rotation,
        EER grouping (``fmint.txt``), crYOLO model
      - Tilt axis angle (import and AreTomo3)


Configuration
-------------

Where the values come from
..........................

.. graphviz::
    :caption: Sources of the OTF project values

    digraph config {
        rankdir=LR;
        node [shape=box, style="rounded,filled", fillcolor="#f5f5f5",
              fontname="Helvetica", fontsize=10];
        edge [fontname="Helvetica", fontsize=9];

        subgraph cluster_session {
            label="Session (form)"; style=dashed; fontname="Helvetica";
            sacq [label="acquisition\npixel_size, dose,\nvoltage, cs", fillcolor="#dbe9f6"];
            sotf [label="extra.otf\nworkflow, cryolo_model", fillcolor="#dbe9f6"];
        }
        subgraph cluster_config {
            label="sessions config"; style=dashed; fontname="Helvetica";
            cacq [label="acquisition[<Mic>]\nimages_pattern, gain_pattern,\ngain_flip, eer_fractions,\ntomo: {...}", fillcolor="#fde9c9"];
            cwf [label="otf[<workflow>]\ncommand, emwrap_otf,\nemwrap_workflow,\njob_params, microscopes", fillcolor="#fde9c9"];
            cotf [label="otf\nroot, job_params", fillcolor="#fde9c9"];
        }
        tmpl [label="workflow template\nemwrap/config/workflows/*.json", shape=note];
        cls [label="OTF class\nSpaOTF / TomoOTF\n(+ customizeJobs)", fillcolor="#e2f0d9"];
        jobs [label="OTF project jobs\nparams", shape=folder, fillcolor="#e2f0d9"];

        sotf -> cwf [label="key"];
        cwf -> cls [label="emwrap_otf\n(or detected)"];
        cwf -> tmpl [label="emwrap_workflow\n(or class default)"];
        tmpl -> jobs [label="1. template params"];
        sacq -> jobs [label="2. setupJobs"];
        cacq -> jobs [label="2. settings"];
        cls -> jobs [label="3. customizeJobs"];
        cotf -> jobs [label="4. job_params"];
        cwf -> jobs [label="4. job_params\n(workflow, microscope)"];
    }

* **Acquisition values** (pixel size, dose per frame, voltage, Cs) come from
  the session (``session['acquisition']``), so they can be edited for each
  session. The ``acquisition[<Mic>]`` config gives the form defaults.
* **Settings** that describe the microscope data (patterns, gain orientation,
  EER grouping, tilt axis) are read with ``OTF.getSetting``: first from the
  workflow config and then from ``acquisition[<Mic>]``. A setting inside a
  ``spa`` or ``tomo`` dict takes precedence for that type. The generic
  ``images_pattern`` is the SPA one; tomography uses its own (``tomo``) one,
  ``tilt_images``, or the folder of the frames in the mdoc ``SubFramePath``.
* **Workflow template**: ``--workflow`` (command line), then
  ``emwrap_workflow`` (for the type), then the class default
  (``spa-otf`` or ``tomo-otf``). The template must have the jobs required by
  the OTF class.
* **Job params** are applied in this order (last wins):

  1. workflow template params,
  2. session values and settings (``setupJobs``),
  3. instance code (``customizeJobs`` of a subclass set in ``emwrap_otf``,
     if any),
  4. config ``job_params``: ``otf``, then ``otf[<workflow>]``, then
     ``otf[<workflow>]['microscopes'][<Mic>]``.

  Config params replace whole values, e.g. setting ``motioncor.extra_args``
  there drops ``-FmIntFile`` or ``-FlipGain`` added from the settings.

The created project has ``session.json`` (session id, OTF type, workflow
template used, jobs, steps and outputs, read by EMhub) and
``acquisition.json``.

Sessions config example
.......................

Only the keys used by this flow are shown:

.. code-block:: json
    :caption: sessions config (relevant keys)

    {
        "acquisition": {
            "Krios02": {
                "voltage": 300, "cs": 2.7, "pixel_size": 0.93, "dose": 1.0,
                "frames": ["/frames/Krios02"],
                "images_pattern": "Images-Disc*/GridSquare_*/Data/Foil*fractions.eer",
                "gain_pattern": "*{microscope}*Gain*.gain",
                "gain_flip": 0,
                "eer_fractions": 40,
                "tomo": {
                    "images_pattern": "Frames/*.eer",
                    "tilt_axis_angle": 85
                }
            }
        },
        "create_session": {"Krios02": {"template": "create_session_form.html"}},
        "data": {
            "gain": "/gscem/gains/",
            "cryolo_models": "/gscem/cryolo_models/*"
        },
        "raw": {
            "root": "/gscem",
            "hosts_default": {"Krios02": "transfer-host01"},
            "jude_group_folder": "/jude/{group}/cryoem",
            "jude_group_mapping": {}
        },
        "otf": {
            "root": "/gscem/OTF",
            "hosts": ["otf-host01", "otf-host02"],
            "hosts_default": {"Krios02": "otf-host01"},
            "workflows": ["None", "emwrap"],
            "workflow_default": "emwrap",
            "job_params": {},
            "emwrap": {
                "command": "cd {otf_path} && emh-tomo --launch emwrap.mix.otf --run",
                "emwrap_otf": "auto",
                "spa": {"emwrap_workflow": "/gscem/emhub/services/spa_otf_cryoem_slurm.json"},
                "tomo": {"emwrap_workflow": "/gscem/emhub/services/tomo_otf_warp_slurm.json"},
                "job_params": {
                    "emw-preprocessing": {"gpus": "0 1 2 3"}
                },
                "microscopes": {
                    "Krios02": {"job_params": {
                        "emw-preprocessing": {"batch_size": 32},
                        "emw-warp-otf": {"mctf.extra_create_settings": ""}
                    }}
                }
            }
        }
    }

The values above (paths, hosts, command) are illustrative, the real ones are
in the EMhub ``sessions`` config of the instance. The Warp-only tomography
template is kept in ``emhub-extras/emhub-stjude-cryoem/services/`` and copied
to the server ``emhub/services`` folder. Its ``--gain_flip_y`` default is
removed for the Krios02 with the microscope ``job_params`` (no code merges
other values into ``mctf.extra_create_settings``, so replacing it is safe).


Results in EMhub
----------------

* **Session details** (``session_details``): raw and Jude paths, transfer
  info and, for admins, the OTF worker status and the restart/stop buttons.
* **Live OTF** (``session_live``): once the OTF is running, EMhub opens the
  project in ``extra.otf.path`` and reads ``session.json`` (``movies``,
  ``micrographs``, ``coordinates``, ``classes2d`` for SPA) to show the
  processing results and plots.
* **Workers page**: each worker publishes its tasks in the ``worker:<host>``
  log every minute.


Current limitations
-------------------

* The form receives the crYOLO models but does not show a select for them, so
  ``extra.otf.cryolo_model`` is always empty.
* With the *OTF folder* advanced field, the form uses an undefined variable
  (``otf_folder`` instead of ``formValues.otf_folder``).
* The live view uses the tomography layout only if ``'tomo'`` is in
  ``extra.otf``, which the worker does not set (``session.json`` has
  ``otf_type``), and its Warp paths are fixed.
* The microscopes of the ``frames`` tasks and the rsync temporary folder are
  hard-coded in the transfer worker.
