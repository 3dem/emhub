============
Installation
============




Basic Installation
------------------

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
    export EMHUB_TESTDATA=~/work/development/emhub-testdata
    export EMHUB_INSTANCE=~/work/development/emhub/instance

    # Now launch the built-in Flask development server:
    flask run

    # or with gunicorn:
    gunicorn -k gevent --workers=2 'emhub:create_app()' --bind 0.0.0.0:8080


Installation with Scipion
-------------------------

To be done.


Configuration
-------------

