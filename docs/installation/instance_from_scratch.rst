
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

You might want to import some existing users into EMhub. As an example, let's suppose
that we have our users information in a CSV file and we want to import them into
EMhub.

First step is to start the server after creating the instance:

.. code-block:: bash

    export FLASK_APP=emhub
    export EMHUB_INSTANCE=~/.emhub/instances/my_instance
    flask run --debug

In another terminal, load your EMhub conda environment and set the client
credentials:

.. code-block:: bash

    export EMHUB_SERVER_URL=http://127.0.0.1:5000
    export EMHUB_USER=admin
    export EMHUB_PASSWORD=admin

    # Test that the client's connection to the EMhub local server
    # the following command should list all forms
    emh-client form -l all

If everything is correct, we can run the following Python code
to import new users into EMhub. See the example CSV file from which we
are importing users.


.. tab:: Python code

    .. code-block:: python

        from emhub.client import open_client
        import csv

        with open_client() as dc:
            with open(fn) as f:
                csv_reader = csv.DictReader(f, delimiter=',')
                # Map emails to user's ID to set the PI
                usersDict = {}

                for row in csv_reader:
                    email = row['Email address']
                    roles = ['user']  # by default only user
                    attrs = {
                        'name': row['Name'],
                        'email': email,
                        'username': email,
                        'password': '1234',
                        'roles': roles,
                        'pi_id': usersDict.get(row['PI email'], {}).get('id', None)
                    }

                    if row['Is PI?'] == 'yes':
                        roles.append('pi')

                    if row['Site Admin?'] == 'yes':
                        roles.append('manager')

                    r = dc.request('create_user', jsonData={'attrs': attrs})
                    json = r.json()
                    if 'user' in json:
                        u = json['user']
                        usersDict[email] = u
                        print(u)
                    else:
                        print(f"ERROR: {json}")

.. tab:: CSV file

    .. code-block::

        Name,Email address,PI email,Department,Is PI?,Site Admin?
        Donna Anderson,donna.anderson@emhub.org,,Structural Biology,yes,,
        Elizabeth Salinas,elizabeth.salinas@emhub.org,,Structural Biology,yes,,
        Mathew Figueroa,mathew.figueroa@emhub.org,,Structural Biology,yes,,
        Debbie Cabrera,debbie.cabrera@emhub.org,donna.anderson@emhub.org,Structural Biology,,,
        Rachel Figueroa,rachel.figueroa@emhub.org,mathew.figueroa@emhub.org,Structural Biology,,,
        Jose Little,jose.little@emhub.org,elizabeth.salinas@emhub.org,Structural Biology,,,
        Benjamin Holland,benjamin.holland@emhub.org,donna.anderson@emhub.org,Structural Biology,,,
        Joshua Robinson,joshua.robinson@emhub.org,,Structural Biology,,yes,
        Andrea Tucker,andrea.tucker@emhub.org,,Structural Biology,,yes,
        Yolanda Walters,yolanda.walters@emhub.org,donna.anderson@emhub.org,Structural Biology,,,

.. note::
    Here, we do not consider the ``Department`` column from the CSV file.
    This could be useful if there are users from different departments or different
    universities that we want to group. We can use the REST API to create applications
    and then add users to applications.


.. note::
    We are setting a dummy password, '1234', for simplicity. A random password
    could be generated, stored, and sent to users requesting to change it. If
    external authentication is used (e.g., LDAP), the password is not used since
    the authentication will not take place via the EMhub database.


Importing Bookings
------------------

If there are bookings that we want to import, the best way is to modify the
initial JSON file and include booking info before creating the instance.

Another possibility is to use the REST API to create new bookings in a
similar way to the user's case. Main points to consider:

* Get the correct resource ID (microscope or other instrument) associated with the booking.
* Get the correct user ID (owner and optional creator/operator) associated with the booking.


