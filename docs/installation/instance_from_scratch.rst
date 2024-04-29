
Setting up Instance Data
========================

At this point, you have probably installed the sample EMhub instance and are
familiar with its main features. You also have realized how the application
marks many ticks and all it can do for your facility. So, it is time to set
up EMhub for your center. This page will explain the initial steps to
configure EMhub for your site.


Creating a Minimal Instance
---------------------------

The initial example EMhub instance contains several users, instruments,
bookings, and other entries. This is good for showing many application
features but is not ideal for setting up your instance from scratch.
We provide another JSON file to create a minimal instance for that purpose.

For that, you can run the following command (from your emhub code folder):

.. code-block:: bash

    cd emhub  # folder with EMhub code

    # Generate minimal EMhub instance
    emh-data --create_instance ~/.emhub/instances/minimal emhub/data/imports/minimal_instance_data.json

This will create a minimal instance with no bookings and a few users and resources.
This is a better starting point for adding your users, resources, and other data
that you might want to import.

If you already have some data that you want to import, you can modify the JSON file
to reflect the entities you want to include (e.g., users, bookings, projects).
Look at the extended `example JSON file <https://github.com/3dem/emhub/blob/devel/emhub/data/imports/test_instance_data.json>`_
to check the expected field for each entry. Then:

.. code-block:: bash

    cp emhub/data/imports/minimal_instance_data.json my_data.json

    # Edit my_data.json to add data entities

    # Generate your EMhub instance
    emh-data --create_instance ~/.emhub/instances/my_instance my_data.json


After you have a running instance, the best way to import data by :any:`Using EMhub Client`.

Importing Users
---------------

You might want to import some existing users into EMhub. 

