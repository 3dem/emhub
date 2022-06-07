
=====
Users
=====

User Types
==========

.. _user-roles:

In EMhub there are four main types of users:

#. Principal investigators
#. Lab members
#. Facility staff
#. Admin/developers

Principal investigators
-----------------------

Principal investigator users are independent researchers that run a lab. In the system they should:

* Have the **admin** role
* Their PI field should be **None** (no one else is their PI)
* Have a non-empty **Invoice reference** field in the portal
* Belong to an existing Application in the Portal/EMhub (also called Bags)

Lab members
-----------

Lab members should basically be associated with a given PI. Then, they will
inherit the booking rights that their PI has (i.e associated Applications,
booking slots, resources allocation quota, etc)

Facility staff
--------------

These users are **managers** or **admin** in the application and have the rights to
do administrative tasks (eg. create or modify users, make special bookings,
handle applications, etc)

Admin/Developers
----------------

These users are **managers** or **admin** in the application and have the rights to
do administrative tasks (eg. create or modify users, make special bookings,
handle applications, etc)


Registering new users
=====================

First of all, users need to register in the Application Portal as stated in `Booking Guideline
<https://emhub.cryoem.se/pages/?page_id=guidelines>`_.

Then, we (CryoEM-Sweden staff) should do: