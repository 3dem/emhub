
========
Overview
========

Summary
=======

EMhub is a web application designed to handle daily operations and data management of a medium-sized
CryoEM facility. The system allows the creation of users with different kind of roles: site admins,
facility staff, principal investigators (PI), etc. Users are usually grouped by their PI as a lab,
and can also associated using applications (e.g. from different grants, departments or universities).

Staff users or site admins can define Resources that can be booked by users and might have an
associated cost per session. Resources can be instruments such as microscopes or services.
Users will access the resources through the Booking's Calendar, using rules defined by the facility.
Booking rules can be configured by resources and defined for different group of users in a lab or in
an application.

Sessions are carried out for a user with an instrument booking and usually involve some type of
data collection for a given sample. Depending on the user experience, a facility manager might
be assigned to handle the operation of that session. EMhub has a programming interface (API)
that allows to write external programs to communicate with the system. This allows to develop
workers to handle data management task such as: folders creation, accounts and permissions,
data transfer and on-the-fly processing.

All sessions and other research experiments can be linked together via Projects.
There is one user that is the project owner but others can be added as collaborators.
In each project different Entries can be created that allows
to annotate different events and provide full traceability and accountability of the research done.
Some type of entries allow to generate PDF reports of the task performed.


Basic Concepts
==============
* :doc:`Users </user_manual/users_applications>`
    User accounts in the system. They can be: admin, staff, PI or lab members.
    Several roles can be associated to each user (e.g ). PI users can also be grouped in Applications.
* :ref:`Resources`
    Usually instruments that can be booked by users (e.g ).
    Costs can be defined for each resource and different booking rules.
* :ref:`Bookings`
    Time slot for a given users in a given resource. Facility managers can be assigned to supervise a booking/session.
    There are special booking types: slots, downtime, maintenance and repeating events.
* :ref:`Sessions`:
    Usually related to a data collection for a user in an instrument (via a Booking).
    Sessions can be associated to a Project from its user and used for reporting/invoicing.
* :ref:`Projects`:
    Place to group all bookings, sessions and events related to a research project.
    Different type of entries can be used to annotate a Project.
* :ref:`Reports`:
    Different reports are available to the Facility staff and site admins.
    Some reports are generated for project entries and others based on sessions and resource usage.
