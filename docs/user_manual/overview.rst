
Overview
========

Summary
-------

EMhub is a web application designed to handle the daily operations and data management of
a medium-sized CryoEM facility. The system allows the creation of users with different roles:
site admins, facility staff, principal investigators (PI), etc. Users are typically grouped by
their PI as a lab and can be associated with applications (e.g., from different grants,
departments, or universities).

Staff users or site admins can define resources that users can book, and there may be an
associated cost per session. Resources can be instruments such as microscopes or services.
Users access the resources through the Booking Calendar, using rules defined by the facility.
Booking rules can be configured by resources and defined for different groups of users in a
lab or an application.

Sessions are conducted for a user with an instrument booking and usually involve data collection
for a given sample. Depending on the user experience, a facility manager
might be assigned to handle the operation of that session. EMhub has an application programming interface
(API) that allows external programs to communicate with the system. This enables the development
of workers to handle data management tasks such as folder creation, account and permission
management, data transfer, and on-the-fly processing.

All sessions and other research experiments can be linked together via Projects. One user is the project owner,
but others can be added as collaborators. Within each project, different entries can be created to annotate
different events and provide full traceability and accountability for the research. Some types of entries
allow for the generation of PDF reports of the tasks performed.


Basic Concepts
--------------

* :doc:`Users </user_manual/users_applications>`
    User accounts in the system. They can be admin, staff, PI, or lab members.
    Several roles can be associated with each user. PI users can also be grouped in Applications.
* :ref:`Resources`
    Mostly, instruments that users can book.
    Costs can be defined for each resource and different booking rules.
* :ref:`Bookings`
    Time slot for a given user on a given resource. Facility managers can be assigned to supervise a booking/session.
    Particular booking types include slots, downtime, maintenance, and repeating events.
* :ref:`Sessions`:
    Usually related to data collection by a user on an instrument (via a Booking).
    Sessions can be associated with a Project for reporting/invoicing.
* :ref:`Projects`:
    Place to group all bookings, sessions, and events related to a research project.
    Different types of entries can be used to annotate a Project.
* :ref:`Reports`:
    Different reports are available to the Facility staff and site admins.
    Some reports are generated for project entries, and others are based on sessions and resource usage.
