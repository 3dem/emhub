
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

The EMhub instance configuration and data files are inside the ``$EMHUB_INSTANCE/`` folder.
The following sections will refer to configuration files related to the application's different options.


Basic Config
............

The main configuration file of a Flask application is ``$EMHUB_INSTANCE/config.py``. There,
we need to define the ``SECRET_KEY`` variable, from the
`Flask documentation <https://flask.palletsprojects.com/en/2.3.x/config/#SECRET_KEY>`_:

.. csv-table::
   :widths: 10, 50

   "``SECRET_KEY``", "A secret key that will be used for securely signing the session cookie and can be used for any other security related needs by extensions or your application. It should be a long random bytes or str."

For example:

.. code-block:: python

    python -c 'import secrets; print(secrets.token_hex())'
    '192b9bdd22ab9ed4d12e236c78afcb9a393ec15f71bbf5dc987d54727823bcbf'


Then in ``$EMHUB_INSTANCE/config.py``:

.. code-block:: python

    SECRET_KEY = '192b9bdd22ab9ed4d12e236c78afcb9a393ec15f71bbf5dc987d54727823bcbf'


Mail Config
...........

It is possible to define variables related to a Mail Server.
This allows EMhub to send emails for various notifications.
We can add the following variables to ``$EMHUB_INSTANCE/config.py``:

.. code-block:: python

    MAIL_SERVER = "smtp.emhub.org"
    MAIL_PORT = 587
    MAIL_USE_TLS = 1
    MAIL_DEFAULT_SENDER = "noreply@emhub.org"


Authentication
..............

In EMhub, users are authenticated using the local database with a password by default.
It is also possible to authenticate through an external LDAP server.
For that, we need to install the `FlaskLDAP3Login plugin <https://flask-ldap3-login.readthedocs.io/en/latest/>`_:

.. code-block:: bash

    pip install flask-ldap3-login

And in the ``$EMHUB_INSTANCE/config.py`` file:

.. code-block:: python

    EMHUB_AUTH = 'LDAP'

Other LDAP related variables are required in that file. For more details see:
:any:`Authentication with LDAP </installation/auth_ldap>`


Using Redis
...........

In EMhub, we can optionally attach a `Redis <https://redis.io/docs/latest/get-started/>`_
server to improve the performance of certain operations.
Redis server is crucial when several workers communicate with the EMhub server, and the
concurrency level is higher, where the `Sqlite <www.sqlite.org>`_ database is
not performant enough.

A Redis configuration file should be included inside the EMhub instance folder
to attach a Redis server to EMhub (``$EMHUB_INSTANCE/redis.conf``).
The Redis server should be started before the EMhub server in the EMHUB_INSTANCE folder,
and the same configuration file should be used.

See :any:`Caching with Redis </installation/redis>` for more details.


Customization
-------------

EMhub has been designed for easy customization.
The following sections briefly explain the main concepts when extending and customizing EMhub.
The Developers Section's :any:`Customizing EMhub` page provides more details.

Templates
.........

All pages of the EMhub web application use `Flask <https://flask.palletsprojects.com/en/2.3.x/>`_ templates based on
`Jinja <https://jinja.palletsprojects.com/en/3.1.x/>`_. Built-in templates are located under the ``emhub/templates`` folder.

All additional template files should go in the ``$EMHUB_INSTANCE/extra/templates`` folder.
This will add new templates to the system or override existing ones. See more details at :any:`Changing Existing Templates`.

Content Functions
.................

Templates require underlying ``content`` functions that provide the data source for the templates. New templates require the definition
of new content functions in the file ``$EMHUB_INSTANCE/extra/data_content.py``.

API Endpoints
.............

It is also possible to extend the existing REST API by defining
new endpoints in ``$EMHUB_INSTANCE/extra/api.py``. See more at :any:`Extending the REST API`.


Setting up your Own Instance
----------------------------

If you have already installed the sample EMhub instance and have played with it,
you might be familiar with its main features. If you want to set up EMhub for
your center, it is time to check how to
:any:`configure your own EMhub instance <Setting up Instance Data>`.