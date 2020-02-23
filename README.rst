emhub
=====

Web application for monitoring EM results

Launching the development server
--------------------------------

.. code-block:: bash

    conda create --name=emhub-flask-py37 python=3.7 flask sqlalchemy pillow h5py
    conda activate emhub-flask-py37

    export FLASK_APP=emhub
    export FLASK_ENV=development

    # For testing with thumbnails
    cd ~/work/development
    git clone git@github.com:3dem/emhub-testdata.git

    export EMHUB_TESTDATA=~/work/development/emhub-testdata

    flask run
