
Basic Setup
===========


Quickstart
----------

Basic EMhub installation can be done with one pip command, although it is recommended to create a separate
Python environment (either venv or conda). For example:

.. code-block:: bash

    conda create -y --name=emhub python=3.8
    conda activate emhub

    cd ~/work/development
    git clone https://github.com/3dem/emhub.git

    cd emhub

    # If you want to use the development branch, then do:
    # git checkout devel

    pip install -e .

    # Generate some test data
    emh-data --create_instance

    export FLASK_APP=emhub
    export EMHUB_INSTANCE=~/.emhub/instances/test

    # Now launch the built-in Flask development server:
    flask run --debug

    # or with gunicorn:
    gunicorn -k gevent --workers=2 'emhub:create_app()' --bind 0.0.0.0:5000

    # Then launch a web browser at http://127.0.0.1:5000/
    # user: admin, password: admin


Environment Variables
---------------------

.. csv-table::
   :widths: 10, 50

   "``FLASK_APP``", "Flask variable defining the name of the application, **emhub**, in our case."
   "``EMHUB_INSTANCE``", "This variable should point to the folder where all the data for a given EMhub instance is stored. Inside that folder there will be ``emhub.sqlite`` database, configuration files and images related to entities or users' uploads. "


Instance Configuration
----------------------

Templates
.........

All pages of the EMhub web application use `Flask <https://flask.palletsprojects.com/en/2.3.x/>`_ templates based on
`Jinja <https://jinja.palletsprojects.com/en/3.1.x/>`_. Built-in templates are located under the ``emhub/templates`` folder.

All template files should go in the ``$EMHUB_INSTANCE/extra/templates`` folder. This will add new templates to the system
or override existing ones. Some templates that are likely to be redefined are:


.. csv-table::
   :widths: 10, 50

   "**TEMPLATE**", "**DESCRIPTION**"
   "``main.html``", "This is the application's main template. By changing this template, one can use a new icon or define a different header."
   "``main_left_sidebar.html``", "Left panel with sections and links to other pages."
   "``main_topbar.html``", "Logo and header definition."
   "``main_left_sidebar.html``", "Left panel with sections and links to other pages. "
   "``dashboard_right.html``", "Right content of the Dashboard page."

Templates require underlying ``content`` functions that provide the data source for the templates. New templates require the definition
of new content functions in the file ``$EMHUB_INSTANCE/extra/data_content.py``. It is also possible to extend the existing REST API by defining
new endpoints in ``$EMHUB_INSTANCE/extra/api.py``.

Read more about :any:`Customizing EMhub`.


Mail Config
...........

It is possible to define variables related to a Mail Server.
This allows EMhub to send emails for various notifications.

.. code-block:: python

    MAIL_SERVER = "smtp.emhub.org"
    MAIL_PORT = 587
    MAIL_USE_TLS = 1
    MAIL_DEFAULT_SENDER = "noreply@emhub.org"


Authentication
..............

Users can be authenticated in EMhub using the local database with a password. It is also possible to authenticate through
an external LDAP server. Some variables are required in ``config.py`` to configure authentication with LDAP.
See :any:`Authentication with LDAP </installation/auth_ldap>` for more details.


Using Redis
...........

In EMhub, we can optionally attach a `Redis <https://redis.io/docs/latest/get-started/>`_
server to improve the performance of certain operations.
Redis server is crucial when several workers communicate with the EMhub server, and the
concurrency level is higher, where the `Sqlite <www.sqlite.org>`_ database is
not performant enough.

A Redis configuration file should be included inside the EMhub instance folder
to attach a Redis server to EMhub. The Redis server should be started before
the EMhub server in the EMHUB_INSTANCE folder, and the same configuration file
should be used.

See :any:`Caching with Redis </installation/redis>` for more details.