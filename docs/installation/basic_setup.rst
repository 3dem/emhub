
Basic Setup
===========


Quickstart
----------

Basic EMhub installation can be done with one pip command, although it is recommended to create a separated
Python environment (either venv or conda). For example:

.. code-block:: bash

    conda create --name=emhub python=3.8
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

   "``FLASK_APP``", "Flask variable defining the name of the application, **emhub** in our case."
   "``EMHUB_INSTANCE``", "This variable should point to the folder where all the data for a given EMhub instance is stored. Inside that folder there will be ``emhub.sqlite`` database, configuration files and images related to entities or user's uploads. "


Instance Configuration
----------------------

Templates
~~~~~~~~~

All pages of the EMhub web application use `Flask <https://flask.palletsprojects.com/en/2.3.x/>`_ templates based on
`Jinja <https://jinja.palletsprojects.com/en/3.1.x/>`_. Builtin templates are located under the ``emhub/templates`` folder.

To redefine existing templates or to create new ones, one should place template files under the folder ``$EMHUB_INSTANCE/extra/templates``.
Some common templates to redefine are:


.. csv-table::
   :widths: 10, 50

   "**TEMPLATE**", "**DESCRIPTION**"
   "``main.html``", "Overall main template of the application. By changing this template one can use a new icon or define a different header."
   "``main_left_sidebar.html``", "Left panel with sections and links to other pages."
   "``main_topbar.html``", "Logo and header definition."
   "``main_left_sidebar.html``", "Left panel with sections and links to other pages. "
   "``dashboard_right.html``", "Right content of the Dashboard page."

Templates requires underlying ``content`` functions that provides the data source for the templates. New templates might require the definition
of new content functions in the file ``$EMHUB_INSTANCE/extra/data_content.py``. It is also possible to extend the existing REST API by definition
new endpoints in ``$EMHUB_INSTANCE/extra/api.py``.

Read more about :any:`Customizing EMhub`.

Mail Config
~~~~~~~~~~~

It is possible to define some variables related to a Mail Server. In that way,
EMhub can send emails for some notifications.

.. code-block:: python

    MAIL_SERVER = "smtp.emhub.org"
    MAIL_PORT = 587
    MAIL_USE_TLS = 1
    MAIL_DEFAULT_SENDER = "noreply@emhub.org"


Authentication
~~~~~~~~~~~~~~

Users can be authenticated in EMhub using the local database with a password. It is also possible to authenticate through
an external LDAP server. Some variables are required in ``config.py`` for the :any:`Authentication with LDAP </installation/auth_ldap>`.