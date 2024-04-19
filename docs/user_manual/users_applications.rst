
Users and Applications
======================

User Types
----------

In EMhub, there are four main types of users:

* **Principal investigators**

    Principal investigator users are independent researchers that run a lab.

    * Their PI field should be **None** (no one else is their PI)
    * Their accounts have some sort of admin rights for the bookings of their labs

    .. tip::
        For example, in SciLifeLab the users are linked to the OrderPortal and
        PI should also have the following properties:

        * Have a non-empty **Invoice reference** field in the portal
        * Belong to an existing Application in the Portal/EMhub (also called Bags)


* **Lab members**

    Lab members should basically be associated with a given PI. Then, they will
    inherit the booking rights that their PI has (i.e associated Applications,
    booking slots, resources allocation quota, etc)


* **Facility staff**

    These users are **managers** or **admin** in the application and have the rights to
    do administrative tasks (eg. create or modify users, make special bookings,
    handle applications, etc)


* **Admin/Developers**

    These type of users are more used for internal application maintenance on top
    of usual management task as **managers**. The users could have some extra pages/options
    in the application that deal more with setup and configuration.


.. note::
    Below are general properties common to all user types:

    .. csv-table::
       :widths: 10, 50

       "**Username and email**", "Should be unique for each user in the system."
       "**Status**", "Possible values: *active* or *inactive*. Inactive users can not access the system and are not shown in most cases."
       "**Password**", "Password for authentication."
       "**Roles**", "Different roles that can be used for set the kind of user (PI, admin, manager, etc) and also extra permissions (e.g. independent)."


Users Pages
-----------

There are several pages in EMhub that display users' information and allow admins
to modify it.

List All
........

This page provides access to all users in the system. Like many other tables,
it features a *search* box where it is possible to filter by name or any other text.
From this page, one can edit existing user information or :ref:`register a new user <New users>`.

.. image:: https://github.com/3dem/emhub/wiki/images/202306/users_list.jpg
   :width: 100%

The *actions* column is only shown to Admins. It allows to modify or delete given users
and even log in the system as that user (for development/debugging purposes).

Groups
......

It is also possible to list users grouped by their PI.

.. image:: https://github.com/3dem/emhub/wiki/images/202306/users_groups.jpg
   :width: 100%

New users
.........

From the users list page one can register new users by clicking in the **Register New User**
button. This will open the following dialog for entering basic information about the new user.

.. image:: https://github.com/3dem/emhub/wiki/images/user-register.png
   :width: 100%

After the user is registered, a new entry will be stored in the database for that user.
The registration process might vary from one place to another.

.. note::
    At SciLifeLab, after a new user is registered, an email is sent with a confirmation link.
    Then the user can follow the link to complete the registration process by setting a
    password and filling in any missing information.

    Additionally, uses can be imported from the Application Portal:
    :ref:`Importing Users at SciLifeLab <scilifelab-users>`.

.. note::
    At St.Jude, users are just registered to enable them in the local database.
    After that, they use the institutional authentication (via LDAP config in EMHub).


Applications
------------

Applications in EMhub serve as a way to group PIs (and users under their labs) with
some logical organization. Rules defined for an application will be shared by all users
belonging to that application. For example, applications could represent different
universities accessing the facility, different departments within the same university,
or simply different projects.

.. note::
    At SciLifeLab, applications are used to request access to the facility instruments. Usually there is one application
    per university and there is a revision done by an external committee. Once an application is approved, there is a number
    of days assigned for each microscope for the valid period. Applications are also used there for reporting and invoicing.

    Applications are originally created in the Application Portal and :ref:`Imported into EMhub <scilifelab-applications>`.


Templates
.........

Facility staff users (roles **admin** or **manager**) can create application *Templates*,
which are essentially forms with input fields required for a certain type of Application.
Before opening an application period, managers can create new templates and disable old ones
(which will still be linked to previous applications). (*WORK IN PROGRESS*)

