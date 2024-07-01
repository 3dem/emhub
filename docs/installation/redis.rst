
Caching with Redis
==================

`Redis <https://redis.io/docs/latest/get-started/>`_ is an in-memory key-value store
widely used as a cache and message broker with optional durability. In EMhub, we can
optionally attach a Redis server to improve the performance of certain operations.
It is crucial when several workers communicate with the EMhub server and the
concurrency level is higher. In this way, we overcome some limitations of the
underlying `Sqlite <www.sqlite.org>`_ database for such cases.

A Redis configuration file should be included inside the EMhub instance folder
to attach a Redis server to EMhub. The Redis server should be started before
the EMhub server in the EMHUB_INSTANCE folder, and the same configuration file
should be used. Redis is widely available in Linux distributions and also as
a conda package. For example, one could run Redis in the following way:


.. code-block:: bash

    conda activate redis-server

    cd $EMHUB_INSTANCE && redis-server redis.conf --daemonize yes


An example config file is shown below:

.. tab:: $EMHUB_INSTANCE/redis.conf

    .. code-block:: bash

        # Redis configuration file example.
        #
        # Note that in order to read the configuration file, Redis must be
        # started with the file path as first argument:
        #
        # ./redis-server /path/to/redis.conf


        bind 127.0.0.1
        port 5001

        ################################ SNAPSHOTTING  ################################
        #
        # Save the DB on disk:
        #
        #   save <seconds> <changes>
        #
        #   Will save the DB if both the given number of seconds and the given
        #   number of write operations against the DB occurred.
        #
        #   In the example below the behaviour will be to save:
        #   after 900 sec (15 min) if at least 1 key changed
        #   after 300 sec (5 min) if at least 10 keys changed
        #   after 60 sec if at least 1000 keys changed
        #
        #   Note: you can disable saving completely by commenting out all "save" lines.
        #
        #   It is also possible to remove all the previously configured save
        #   points by adding a save directive with a single empty string argument
        #   like in the following example:
        #
        #   save ""

        save 900 1
        save 300 10
        save 60 1000

        dbfilename dump.rdb

        # The working directory.
        #
        # The DB will be written inside this directory, with the filename specified
        # above using the 'dbfilename' configuration directive.
        #
        # The Append Only File will also be created inside this directory.
        #
        # Note that you must specify a directory here, not a file name.
        dir ./
