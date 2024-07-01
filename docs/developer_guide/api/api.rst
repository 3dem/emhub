
REST API
--------

.. automodule:: emhub.blueprints.api

Authentication
..............

.. autofunction:: emhub.blueprints.api.login

.. autofunction:: emhub.blueprints.api.logout


Users
.....

Parameters for the following methods are expected from ``request.form`` or ``request.json``.

.. autofunction:: emhub.blueprints.api.create_user

.. autofunction:: emhub.blueprints.api.register_user

.. autofunction:: emhub.blueprints.api.update_user

.. autofunction:: emhub.blueprints.api.delete_user


Templates
.........

Parameters for the following methods are expected from ``request.form`` or ``request.json``.

.. autofunction:: emhub.blueprints.api.create_template

.. autofunction:: emhub.blueprints.api.get_templates

.. autofunction:: emhub.blueprints.api.update_template

.. autofunction:: emhub.blueprints.api.delete_template


Applications
............

Parameters for the following methods are expected from ``request.form`` or ``request.json``.

.. autofunction:: emhub.blueprints.api.create_application

.. autofunction:: emhub.blueprints.api.get_applications

.. autofunction:: emhub.blueprints.api.update_application

.. autofunction:: emhub.blueprints.api.delete_application


Resources
.........

Parameters for the following methods are expected from ``request.form`` or ``request.json``.

.. autofunction:: emhub.blueprints.api.create_resource

.. autofunction:: emhub.blueprints.api.get_resources

.. autofunction:: emhub.blueprints.api.update_resource

.. autofunction:: emhub.blueprints.api.delete_resource


Bookings
........

Parameters for the following methods are expected from ``request.form`` or ``request.json``.

.. autofunction:: emhub.blueprints.api.create_booking

.. autofunction:: emhub.blueprints.api.get_bookings

.. autofunction:: emhub.blueprints.api.get_bookings_range

.. autofunction:: emhub.blueprints.api.update_booking

.. autofunction:: emhub.blueprints.api.delete_booking