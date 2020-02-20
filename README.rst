
emhub
=====

Web application for monitoring EM results

Launching the development server
--------------------------------

.. code-block:: bash

    conda create --name=emhub-flask-py37 python=3.7
    conda install flask pillow

    export FLASK_APP=emhub
    export FLASK_ENV=development

    conda activate emhub-flask-py37

    flask run
