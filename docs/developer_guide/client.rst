
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
Python libraries such as ``requests``. To facility the communication, EMhub provides
the :ref:`emhub.client` module to communicate with the server. Following are some
examples of it usage.

Getting Bookings in a Range
...........................

A simple example, getting all bookings in a range.

.. code-block:: python

    from emhub.client import open_client
    with open_client() as dc:
        r = dc.request('get_bookings_range',
                       jsonData={'start': '2023-07-01', 'end': '2023-10-01'})
        for b in r.json():
            print(b)


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


Disguising the Database
.......................

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


Updating Sessions' Acquisition Info
...................................

In this example we want to update the ``Acquisition Info`` for sessions where this information is missing.
For that, we will read the acquisition from the configuration for each microscope, based on its name.
Then we will need to map the microscopes names to their ids, by reading ``resources`` from EMhub. Finally, we
will go over each session and update the acquisition if necessary.

.. code-block:: python

        from emhub.client import open_client

        with open_client() as dc:
            # Let's get the resources and create a dict mapping resourceId -> resourceName
            resources = dc.request('get_resources', jsonData=None).json()
            rDict = {r['id']: r['name'] for r in resources}

            # Let's get bookings since the resource id comes from the booking
            # associated with the session
            bookings = dc.request('get_bookings', jsonData=None).json()
            # Create a mapping from booking to the resource name: bookingId -> resourceName
            brDict = {b['id']: rDict[b['resource_id']] for b in bookings}

            # Get sessions and the config related to sessions
            sessions = dc.request('get_sessions', jsonData=None).json()
            sconfig = dc.get_config('sessions')

            for s in sessions:
                # Get the resourceName for this session, based on its corresponding booking
                rName = brDict[s['booking_id']]
                # Get pixel size from the session's acquisition
                acq = s['acquisition']
                ps = acq.get('pixel_size', None)

                # Fix the acquisition if there is no pixel_size (wrong acquisition info)
                if ps:
                    print(f"Session {s['id'] is OK"})
                else:
                    # Let's get the proper acquisition from the config and update the session
                    newAcq = sconfig['acquisition'][rName]
                    dc.update_session({'id': s['id'], 'acquisition': newAcq})


Javascript
----------

The EMhub's UI also make use the of the :ref:`REST API` from Javascript code. JQuery library is used for sending AJAX
requests and there are some helper functions in :doc:`EMhub's Javascript </developers_guide/api/javascript>` to make it
easier to request data and render html based on that.

For example, one can easily display the resulting HTML from a content-query to EMhub in a modal using the following code:

.. code-block:: javascript

    function showRegisterUser() {
        var content = get_ajax_content("register_user_form", {});
        show_modal_from_ajax('user-modal', content);
    }  // function showUser


In the previous example one make a request with the ``get_ajax_content`` function and display a modal from the
resulting html. In this case it is a dialog to register a new user. One can link an action in that modal (usually a
HTML form coming from the server) and sent another request with that action to the server. In this case that action
will be to register the user in the database. That is done in the following function:

.. code-block:: javascript

    function onRegisterUser() {
        var roles = [];
        // Update user's roles base on checkboxes
        $(".user-role:checked").each(function(){
            roles.push(this.name.replace('role-', ''));
        });
        // Create a user's data
        var user = {
            email: $('#user-email').val(),
            name: $('#user-name').val(),
            roles: roles,
            pi_id: $('#user-pi-select').selectpicker('val')
        };

        // Send a request to register that user
        send_ajax_json(Api.urls.user.register, user, handleUserAjaxDone);
    }  // function onRegisterUser





