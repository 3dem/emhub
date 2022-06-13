
=====
Users
=====

Users List
==========

This page gives access to all users in the system. As many other tables, it has a *search*
box where it is possible to filter by name or any other text. From this page one can
edit existing user's information or :ref:`register a new user <register-user>`.

.. image:: https://github.com/3dem/emhub/wiki/images/users-list.png
   :width: 100%

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

Principal investigator users are independent researchers that run a lab.
In the system they have the following properties:

* Their PI field should be **None** (no one else is their PI)
* Have a non-empty **Invoice reference** field in the portal
* Belong to an existing Application in the Portal/EMhub (also called Bags)
* Have some sort of admin rights for the bookings of their labs

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

.. _register-user:

Registering new users
=====================

From the users list page one can register new users by clicking in the **Register New User**
button. This will open the following dialog for entering basic information about the new user.

.. image:: https://github.com/3dem/emhub/wiki/images/user-register.png
   :width: 100%

After the user is registered, an email is sent to the user with a confirmation link. Then the user
can follow the link to complete the registration process by setting a password and filling in any
missing information.

Different sites using EMhub might also implement other ways of importing users from other
systems that might be in place. For example, in SciLifeLab, users can be imported from
the Application Portal: :ref:`Importing Users at SciLifeLab <scilifelab-users>`.



