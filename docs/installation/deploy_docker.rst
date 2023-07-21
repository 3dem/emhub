
Deploying in a Docker Container
===============================

Building a Docker Image
-----------------------

A Docker image for running EMhub can be created with the following dockerfile:

.. code-block:: docker

    FROM python:3.8

    LABEL description="Python 3.8 based image to run emhub application"
    LABEL maintainer="J.M. de la Rosa Trevin delarosatrevin@gmail.com"

    ENV EMHUB_INSTANCE /emhub-data/emhub-instance

    RUN pip install emhub
    RUN groupadd -g 2000 hubby && useradd -m -u 2000 -g hubby hubby

    USER hubby
    CMD [ "gunicorn", "-k", "gevent", "--workers=4", "emhub:create_app()", "--bind", "0.0.0.0:8080" ]


Running the Container
---------------------

Then one can save that in a file named ``Dockerfile`` and run there:

.. code-block:: bash

    # Building the image
    docker build . -t emhub --no-cache


    # Checking that the new emhub image was created
    docker images ls


    # Running the application, mapping the port from the container to
    # the host machine and mapping a volume containing the instance data folder
    docker run -d --rm -p 127.0.0.1:8080:8080 --name=emhub -v /home/hubby/emhub-data/:/emhub-data emhub:latest

    # Check the container is properly running
    docker ps

    # Checking logs
    docker logs emhub

    # Stopping the app
    docker stop emhub





