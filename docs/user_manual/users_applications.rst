
Users and Applications
======================

User Types
----------

In EMhub, there are four main types of users:

* **Principal investigators**

    Principal investigator users are independent researchers who run a lab.

    * Their PI field should be **None** (no one else is their PI)
    * Their accounts have some admin rights for the bookings of their labs

    .. tip::
        For example, in SciLifeLab the users are linked to the OrderPortal and
        PI should also have the following properties:

        * Have a non-empty **Invoice reference** field in the portal
        * Belong to an existing Application in the Portal/EMhub (also called Bags)


* **Lab members**

    Lab members should be associated with a given PI. Then, they will
    inherit the booking rights that their PI has (i.e, associated Applications,
    booking slots, resources allocation quota, etc)


* **Facility staff**

    These users are **managers** or **admin** in the application and have the rights to
    do administrative tasks (e.g. create or modify users, make special bookings,
    handle applications, etc.)


* **Admin/Developers**

    These users are more used for internal application maintenance on top of usual
    management tasks as **managers**. The users could have some extra pages/options
    in the application that deal more with setup and configuration.


.. note::
    Below are general properties common to all user types:

    .. csv-table::
       :widths: 10, 50

       "**Username and email**", "Should be unique for each user in the system."
       "**Status**", "Possible values: *active* or *inactive*. Inactive users can not access the system and are often not shown."
       "**Password**", "Password for authentication."
       "**Roles**", "Different roles that can be used to set the kind of user (PI, admin, manager, etc.) and also extra permissions (e.g., independent)."


Users Pages
-----------

Several pages in EMhub display users' information and allow admins
to modify it.

List All
........

This page provides access to all users in the system. Like many other tables,
it features a *search* box where filtering by name or any other text is possible.
From this page, one can edit existing user information or :ref:`register a new user <New users>`.

.. image:: https://github.com/3dem/emhub/wiki/images/202306/users_list.jpg
   :width: 100%

The *actions* column is only shown to Admins. It allows to modify or delete given users
and even log in to the system as that user (for development/debugging purposes).

Groups
......

It is also possible to list users grouped by their PI.

.. image:: https://github.com/3dem/emhub/wiki/images/202306/users_groups.jpg
   :width: 100%

New users
.........

From the users list page, one can register new users by clicking on the **Register New User**
button. This will open the following dialog for entering basic information about the new user.

.. image:: https://github.com/3dem/emhub/wiki/images/user-register.png
   :width: 100%

After the user is registered, a new entry will be stored in the database for that user.
The registration process might vary from one place to another.

.. note::
    At SciLifeLab, an email with a confirmation link is sent after a new user is registered.
    Then, the user can follow the link to complete the registration process by setting a
    password and filling in any missing information.

    Additionally, users can be imported from the Application Portal:
    :ref:`Importing Users at SciLifeLab <scilifelab-users>`.

.. note::
    At St. Jude, users are registered to enable them in the local database.
    After that, they use the institutional authentication (via LDAP config in EMHub).


Applications
------------

Applications in EMhub serve as a way to group PIs (and users under their labs) with
some logical organization. Rules defined for an application will be shared by all users
belonging to that application. For example, applications could represent different
universities accessing the facility, different departments within the same university,
or simply different projects.

.. note::
    At SciLifeLab, applications are used to request access to the facility instruments. Usually, there is one application
    per university, and an external committee reviews it. Once an application is approved, a number of days are assigned for each microscope for the valid period. Applications are also used there for reporting and invoicing.

    Applications are created in the Application Portal and imported into EMhub.


Templates
.........

Facility staff users (roles **admin** or **manager**) can create application *Templates*,
essentially forms with input fields required for a certain type of Application.
Managers can create new application templates and disable old ones before opening a new application period.
(which will still be linked to previous applications). (*WORK IN PROGRESS*)

