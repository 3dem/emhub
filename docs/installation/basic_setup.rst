
Basic Setup
===========

Installation
------------

Basic EMhub installation can be done with one pip command, although it is recommended to create a separated
Python environment (either venv or conda). For example:

.. code-block:: bash

    conda create --name=emhub python=3.8
    conda activate emhub

    cd ~/work/development
    git clone git@github.com:3dem/emhub.git
    git clone git@github.com:3dem/emhub-testdata.git

    cd emhub
    pip install -e .

    export FLASK_APP=emhub
    export FLASK_ENV=development
    export EMHUB_INSTANCE=~/work/development/emhub/instance

    # Now launch the built-in Flask development server:
    flask run

    # or with gunicorn:
    gunicorn -k gevent --workers=2 'emhub:create_app()' --bind 0.0.0.0:8080


Environment Variables
---------------------

.. csv-table:: **Environment variables**
   :widths: 10, 50

   "``FLASK_APP``", "Flask variable defining the name of the application, **emhub** in our case."
   "``FLASK_ENV``", "Environment, can be set to *development* for debugging purposes."
   "``EMHUB_INSTANCE``", "Maximum amount of hours for bookings of this resources. Value 0 means no maximum. "

Instance Configuration
----------------------

Mail
~~~~

It is possible to define some variables related to a Mail Server. In that way,
EMhub can send emails for some notifications.

.. code-block:: python

    MAIL_SERVER = "smtp.emhub.org"
    MAIL_PORT = 587
    MAIL_USE_TLS = 1
    MAIL_DEFAULT_SENDER = "noreply@emhub.org"


Templates
~~~~~~~~~

There are other variables that allow customization by defining different templates
for some components of the web application. All templates are html (with Jinja2 templating)
under the `emhub/templates` folder.

.. csv-table:: **Template variables**
   :widths: 10, 50

   "**VARIABLE**", "**DESCRIPTION**"
   "``TEMPLATE_MAIN='main.html'``", "Overall main template of the application. By changing this template one can use a new icon or define a different header. Another usage is to change the left panel with links to other pages. "
   "``TEMPLATE_DASHBOARD_RIGHT='dashboard_right.html'``", "Right content of the Dashboard page. (TODO: Add link to SLL and StJude dashboards, and development info)."
   "``TEMPLATE_SESSION_CONTENT='session_content.html'``", "Page used to display the information about a given session. (TODO: Add link to SLL and StJude session content, and development info)."
   "``TEMPLATE_SESSION_BODY='create_session_form_body.html'``", "Dialog used when creating a new session. (TODO: Add link to SLL and StJude create session dialogs, and development info)."

Authentication
~~~~~~~~~~~~~~

Users can be authenticated in EMhub using the local database with a password. It is also possible to authenticate through
an external LDAP server. Some variables are required in `config.py` for the :any:`Authentication with LDAP </installation/auth_ldap>`.