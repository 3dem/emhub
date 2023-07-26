
Using EMhub Client
==================

The EMhub :ref:`REST API` is a powerful way for external programs/scripts
to interact with the application and extends its functionalities. In the following
section there are some examples about how to use the API via the `DataClient` class
in Python and also from Javascript.


Python
------

Interacting with the EMhub :ref:`REST API` is basically sending requests to the
remote server and processing the returned response. This could be done with standard
Python libraries such as `requests`. To facility the communication, EMhub provides
the :ref:`emhub.client` module to communicate with the server. Following are some
examples of it usage.


Backing-up Forms in a JSON file
...............................
We can fetch all forms from the EMhub server and store it in a JSON file. Similarly
we can read a JSON file and restore the Forms into another instance. For example,
let assume we want to get forms from a remote server and set their values in a
development one.

.. code-block:: python

    from emhub.client import DataClient, open_client

    # Connect to the remote server and login using some user/password
    dc1 = DataClient(server_url='https://emhub.org')
    dc.login(user, password)
    # Fetch all forms
    forms = dc.request('get_forms', jsonData=None).json()
    # Dump forms into a JSON file
    with open('forms.json', 'w') as f:
        formList = [{'id': f['id'],
                     'name': f['name'],
                     'definition': f['definition']
                     }
                    for f in forms
                    ]
        json.dump(formList, f, indent=4)
    dc.logout()

    # Now connect to another server and load info from JSON file
    # Assuming that by default the config are set for the development server:
    with open('forms.json') as f:
        formList = json.load(f)

    with open_client() as dc2:
        for form in formList:
            print(f">>> Updating form ID={form['id']}\t {form['name']}")
            dc.request('update_form', jsonData={'attrs': form})


Disguising the Database Info
............................

In this example, image that we want to present an EMhub running instance, but
we don't want to reveal real users' identity neither projects or sessions name.
We can modify run a development instance and modify the database for hidding
the real information.


.. code-block:: python

    from emhub.client import DataClient, open_client
    from faker import Faker

    with open_client() as dc:

        # Update user's name and email with fake values
        users = dc.request('get_users', jsonData=None).json()
        f = Faker()
        for u in users:
            name = ' '.join(f.name().split(' ')[-2:])
            email = name.lower().replace(' ', '.') + '@emhub.org'
            attrs = {'id': u['id'], 'name': name, 'email': email}
            dc.request('update_user', jsonData={'attrs': attrs})

        # Modify sessions to hide real name
        sessions = dc.request('get_sessions', jsonData=None).json()
        for s in sessions:
            dc.update_session({'id': s['id'], 'name': f"S{s['id']:05d}"})

        # Hide project's title and make all 'confidential'
        projects = dc.request('get_projects', jsonData=None).json()
        for p in projects:
            # read 'extra' property where 'is_confidential' is stored
            extra = dict(p['extra'])
            extra['is_confidential'] = True
            attrs = {'id': p['id'], 'extra': extra, 'title': 'Project Title'}
            dc.request('update_project', jsonData={'attrs': attrs})

