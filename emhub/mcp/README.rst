EMhub MCP server
================

``emhub.mcp`` is an `MCP <https://modelcontextprotocol.io>`_ (Model Context
Protocol) server that gives LLM agents (Claude Code, Claude Desktop, ...)
access to a running EMhub instance: the booking system (users, resources,
bookings, sessions, projects) and the data processing projects (jobs,
logs, output tables, workflows).


Running the server
------------------

Installation
~~~~~~~~~~~~

The ``mcp`` package is an optional dependency of emhub. Like emhub itself,
it requires Python >= 3.10 (emhub supports Python 3.10 - 3.15). Both the
1.x and 2.x versions of ``mcp`` are supported:

.. code-block:: bash

    pip install -e '.[mcp]'      # from the emhub repository
    # or, in an existing emhub environment
    pip install 'mcp>=1.20'

This installs the ``emh-mcp`` command (also available as
``python -m emhub.mcp``).

Development install
~~~~~~~~~~~~~~~~~~~

While the MCP server is under development it lives in the ``jm_mcp``
branch of emhub. Clone emhub on that branch, and emtools on ``devel``
(the branch ``jm_mcp`` is based on), then install both in editable mode
so the environment follows your checkouts:

.. code-block:: bash

    mkdir emhub-mcp && cd emhub-mcp
    git clone -b jm_mcp git@github.com:3dem/emhub.git
    git clone -b devel git@github.com:3dem/emtools.git

    python3.10 -m venv venv          # or: conda create -n emhub-mcp python=3.10
    source venv/bin/activate

    # emtools first, so pip uses the local checkout instead of PyPI
    pip install -e ./emtools -e './emhub[mcp]'

    emh-mcp --help

Python version:

* Any Python from 3.10 to 3.15 works (``python3.10`` above is only an
  example). The ``mcp`` package does not support older versions, and
  neither does emhub since the move to ``pyproject.toml``.
* The EMhub server needs Python >= 3.10 too, but the MCP server does not
  have to run in the same environment or machine: it is a separate
  process that talks to EMhub through its REST API, usually running on
  the machine where Claude Code or Claude Desktop runs.

Apple Silicon Macs: use a native arm64 Python (e.g. Homebrew's
``python3.10``, or Miniforge). Older Intel (x86_64) conda installations,
such as the one bundled with Scipion, run under Rosetta, and some pinned
packages have no x86_64 macOS wheels, so pip tries to build them from
source, which usually fails:

* ``gevent==26.9.0`` (from emhub's ``requirements.txt``) only has x86_64
  (universal2) wheels for Python >= 3.12.
* ``cryptography`` (required by ``mcp`` through ``PyJWT[crypto]``) has no
  x86_64 wheels since version 49; building it needs Rust, and downloading
  Rust fails behind a TLS inspecting proxy with
  ``CERTIFICATE_VERIFY_FAILED``.

Check the architecture with
``python -c "import platform; print(platform.machine())"``. If it prints
``x86_64`` on an Apple Silicon Mac, either switch to an arm64 Python or
use Python >= 3.12 and keep an older ``cryptography`` when installing:

.. code-block:: bash

    conda create -n emhub-mcp python=3.12
    conda activate emhub-mcp
    pip install -e ./emtools -e './emhub[mcp]' 'cryptography<49'

After pulling new changes there is nothing to reinstall, but running MCP
servers keep the old code: reconnect them (``/mcp`` in Claude Code) or
start a new session.

Configuration
~~~~~~~~~~~~~

The server connects to EMhub through its REST API and uses the same
environment variables as any other EMhub client script:

==================== =====================================================
Variable             Description
==================== =====================================================
``EMHUB_SERVER_URL`` EMhub server URL, e.g. ``https://emhub.example.org``
                     (default ``http://127.0.0.1:5000``).
``EMHUB_USER``       Username to login with.
``EMHUB_PASSWORD``   Password of that user.
``EMHUB_TIMEZONE``   Optional timezone of input dates without an offset,
                     e.g. ``America/Chicago`` (this machine's by default).
==================== =====================================================

It is convenient to keep the credentials in a file only readable by you,
e.g. ``~/.emhub/creds``:

.. code-block:: bash

    export EMHUB_USER=myuser
    export EMHUB_PASSWORD=mypassword

Command line
~~~~~~~~~~~~

.. code-block:: bash

    emh-mcp                       # all tools (booking + processing)
    emh-mcp --tools booking       # only booking_* tools
    emh-mcp --tools processing    # only processing_* tools

The server talks MCP over stdio: it is meant to be launched by an MCP
client, not run by hand. On startup it logs in and prints a line to stderr
with the user, its roles and whether admin tools are enabled.


Connecting a client
-------------------

Claude Code
~~~~~~~~~~~

Register the server with ``claude mcp add``. The ``-e`` options set the
environment of the server process:

.. code-block:: bash

    claude mcp add emhub \
        -e EMHUB_SERVER_URL=https://emhub.example.org \
        -e EMHUB_USER=myuser -e EMHUB_PASSWORD=mypassword \
        -- emh-mcp --tools all

To avoid storing the password in the Claude configuration, use a small
wrapper that reads the credentials file:

.. code-block:: bash

    claude mcp add emhub -- bash -c \
        'source ~/.emhub/creds && EMHUB_SERVER_URL=https://emhub.example.org exec emh-mcp'

Use ``-s user`` to make the server available in all your projects, or
``-s project`` to share it through the ``.mcp.json`` file of a project.
Check it with ``claude mcp list`` or ``/mcp`` inside Claude Code.

If ``emh-mcp`` is not in the ``PATH`` used by Claude Code, give the full
path of the command, e.g. ``/path/to/env/bin/emh-mcp``.

Several EMhub instances can be registered with different names, e.g.
``emhub-dev`` and ``emhub-prod``, each with its own ``EMHUB_SERVER_URL``.

Claude Desktop and other clients
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Any MCP client that launches stdio servers works the same way. For
Claude Desktop, add to ``claude_desktop_config.json``:

.. code-block:: json

    {
      "mcpServers": {
        "emhub": {
          "command": "/path/to/env/bin/emh-mcp",
          "args": ["--tools", "all"],
          "env": {
            "EMHUB_SERVER_URL": "https://emhub.example.org",
            "EMHUB_USER": "myuser",
            "EMHUB_PASSWORD": "mypassword"
          }
        }
      }
    }

Testing
~~~~~~~

The tools can be tried interactively with the MCP inspector:

.. code-block:: bash

    npx @modelcontextprotocol/inspector emh-mcp

Unit tests use a fake client, so no EMhub server is needed:

.. code-block:: bash

    python emhub/tests/test_mcp.py


Design decisions
----------------

One server, two tool groups
~~~~~~~~~~~~~~~~~~~~~~~~~~~

We considered two separate servers (one for bookings, users and
instruments, another for data processing) against a single one. We chose
**one package with two tool groups**, where each group can also be served
alone with ``--tools``:

* Both groups use the same transport (the EMhub REST API in
  ``emhub/blueprints/api.py``), the same login and the same permission
  model. Processing already goes through EMhub (``handle_workflow`` ->
  ``get_project_manager`` -> ``emwrap.base.ProjectManager``), so the MCP
  server never imports emwrap or accesses the data folders itself.
* The two domains are linked: a processing project is usually selected by
  ``session_id``, and a session comes from a booking. A single server can
  answer "how is the processing of my Krios01 session from yesterday
  going?" in one conversation.
* The only advantages of separate servers are a smaller tool list and
  having different audiences. ``--tools booking`` and
  ``--tools processing`` cover both cases without a second code base or a
  second set of credentials.
* MCP has no "routes": tools are grouped by name prefix (``booking_*``,
  ``processing_*``) and registered from separate modules.

Through the REST API, as the user
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The server is a client of EMhub, not part of the Flask application. Each
person runs it locally (stdio transport) with their own EMhub credentials,
so **EMhub enforces that user's permissions** on every request (who can
book which instrument, cancellation window, pending booking limits, who
can edit a processing project, ...). The MCP layer adds no permission
rules of its own besides hiding admin tools. A hosted HTTP server with
per-request authentication was left for later; the tool modules do not
depend on the transport.

Tool scope
~~~~~~~~~~

Tools are registered in three levels:

* **Read** tools, always available.
* **Safe writes**, always available: creating, updating and cancelling
  bookings; creating tomo projects; saving, launching, scheduling and
  stopping jobs; loading and exporting workflows; job labels and notes. EMhub validates them for the logged in user.
* **Admin** tools, only registered when the user has the ``admin`` or
  ``developer`` role: creating/updating users and resources, updating
  sessions and deleting jobs.

Tools carry MCP annotations (``readOnlyHint``, ``destructiveHint``) and
the docstrings of writing tools ask the model to confirm with the user
first.

Keeping results useful for a model
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

* List tools return a reduced set of fields (full records with the
  ``get_*`` tools); ``password_hash`` is always removed.
* Job logs and text files return only their last lines, output tables
  are paged (``offset``/``limit``), and long strings such as base64
  thumbnails are replaced by a placeholder.
* Tool docstrings are the specification the model reads: they document
  the date format, the filter condition syntax and the project selectors.
* Tools returning lists are annotated as ``list[dict]`` so the SDK sends
  structured output (a bare ``list`` is sent as one text block per item,
  without an output schema).

Errors
~~~~~~

EMhub errors are shortened to their message (no server traceback) and
raised as ``EmhubMcpError``, which subclasses the SDK ``ToolError`` when
``mcp`` is installed. This matters with mcp 2.x: the message of any other
exception is hidden and the model only sees "Error executing tool ...",
which would hide the reason a booking was rejected.

Dates
~~~~~

EMhub stores dates in UTC and treats dates without an offset as UTC. The
tools take input dates as ``'YYYY-MM-DD HH:MM'`` in local time (or
``EMHUB_TIMEZONE``) and convert them to UTC before sending them. Dates
returned by EMhub are UTC (ending in ``Z`` or ``+00:00``); the server
instructions ask the model to convert them for the user.


Implementation
--------------

==================== =====================================================
File                 Content
==================== =====================================================
``client.py``        ``EmhubMcpClient``: wrapper of
                     ``emhub.client.DataClient`` with ``call()``, error
                     handling, login again on an expired session, and the
                     current user and roles. It does not depend on MCP.
``server.py``        ``build_server()`` and ``main()`` (``emh-mcp``):
                     ``--tools`` option, server instructions, support for
                     ``MCPServer`` (mcp 2.x) and ``FastMCP`` (mcp 1.x).
``booking.py``       ``booking_*`` tools.
``processing.py``    ``processing_*`` tools.
``__main__.py``      ``python -m emhub.mcp``.
==================== =====================================================

Booking tools
~~~~~~~~~~~~~

* Read: ``booking_whoami``, ``booking_list_resources``,
  ``booking_list_bookings``, ``booking_get_booking``,
  ``booking_list_users``, ``booking_get_user``, ``booking_list_sessions``,
  ``booking_get_session``, ``booking_list_projects``,
  ``booking_get_config``.
* Safe writes: ``booking_create_booking``, ``booking_update_booking``,
  ``booking_cancel_booking``.
* Admin: ``booking_create_user``, ``booking_update_user``,
  ``booking_create_resource``, ``booking_update_resource``,
  ``booking_update_session``.

Processing tools
~~~~~~~~~~~~~~~~

Every processing tool selects the project with exactly one of
``session_id`` (on-the-fly processing of a session), ``entry_id`` (a
``tomo_processing`` entry) or ``path`` (the project folder), as
``DataManager.get_processing_project`` does.

Read tools work for anyone who can see the project. The tools that change
it (saving, launching, scheduling, stopping and deleting jobs, loading
workflows, labels and notes) are checked by EMhub
(``_check_can_edit_project`` in ``blueprints/api.py``), as for the web
UI. Allowed users are the editors of the project of the
``tomo_processing`` entry, the lab of the session owner and the editors
of the session project, and managers. A ``path`` is allowed for the
editors of the entries registered with that path, and for managers
only if there are none.

* Read: ``processing_list_projects``, ``processing_get_workflow``,
  ``processing_get_project_summary`` (jobs per status, failed, active,
  ready to run and blocked jobs, labels), ``processing_get_job`` (values,
  info, inputs/outputs and optionally logs, ``job.log``, error-like log
  lines, a search in the logs and the parameters form),
  ``processing_list_files``, ``processing_read_file``,
  ``processing_get_table``, ``processing_get_labels``,
  ``processing_list_workflows`` (workflow templates, through
  ``/api/get_workflow_templates``), ``processing_list_job_types``
  (``/api/get_job_types``), ``processing_describe_job_type`` (the
  parameters of a job type, before a job exists),
  ``processing_validate_job`` (check parameters without saving, through
  ``/api/validate_job``) and ``processing_wait_for_jobs`` (wait, at most
  10 minutes per call, until jobs finish, fail or are aborted).
* Safe writes: ``processing_create_tomo_project`` (a ``tomo_processing``
  entry, through ``/api/create_tomo_project``), ``processing_save_job``,
  ``processing_duplicate_jobs``, ``processing_copy_job`` (duplicate and
  change some parameters), ``processing_launch_job``,
  ``processing_schedule_job``, ``processing_stop_jobs``,
  ``processing_set_job_labels``, ``processing_save_label``,
  ``processing_delete_label``, ``processing_annotate_job``,
  ``processing_export_workflow`` (a workflow JSON in the project folder),
  ``processing_load_workflow`` (a template or a workflow JSON of the
  project).
* Admin: ``processing_delete_jobs``.

The ``/api/get_classes2d`` and ``/api/get_file_info`` endpoints are not
exposed: they read form data, do not require login and return large
image data.

Status
~~~~~~

* Unit tests (``emhub/tests/test_mcp.py``) pass with mcp 1.30 and 2.3,
  and on Python 3.10, 3.11 and 3.13 with the requirements of devel.
* Smoke tested over stdio against a local EMhub with an admin account:
  all booking read tools, and the processing read tools on a local
  emwrap project.
* Not tested yet: processing of real sessions (needs the data folders
  mounted where EMhub runs), the write tools, a non-admin account, and
  logging in again after the session expires.
