emhub
=====

Web application for monitoring EM results

Launching the development server
--------------------------------

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


To initialize the db:

`python -m emhub.data`

Running tests
-------------

`python -m unittest emhub.tests`


Publishing the package to PyPI
------------------------------

In order to make the emhub available to install with `pip install emhub`,
we need to:

.. code-block:: bash

    python install twine restructuredtext-lint
    cd emhub

    # It might be a good idea to check the README.rst before uploading:
    rst-lint README.rst

    python setup.py sdist
    twine upload dist/emhub-0.0.1a3.tar.gz


Creating a Docker image
-----------------------

A Dockerfile has been include to create Docker images.

.. code-block:: bash

    cd emhub
    docker build . -t emhub
    docker run --rm -p 8080:8080 --name=emhub -v $PWD/instance:/instance


Upgrading Database model with Alembic
-------------------------------------

If we modify the database models, then an update/migration is required.

.. code-block:: bash

    # Do changes in the model (data_models.py)

    alembic revision --autogenerate

    # Review the generated script

    alembic upgrade head  # or use first the --sql option to see the commands
