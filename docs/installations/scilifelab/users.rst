
.. _scilifelab-users:

==================
ScilifeLab - Users
==================

Most users of EMhub at SciLifeLab must first be registered in the
`CryoEM Portal <https://cryoem.scilifelab.se/>`_. After the users are registered
and their account are enabled, then it can be imported into EMhub.


Registering new users
=====================

First of all, users need to register in the Application Portal as stated in `Booking Guideline
<https://emhub.cryoem.se/pages/?page_id=guidelines>`_.

Then, we (CryoEM-Sweden staff) should do:

In the Portal:
--------------

1. Check if it is PI, in which case it should mark **Yes** in the corresponding
checkbox and provided a non-empty **Invoice Reference** field.
1. If the user is not a PI, then provide the PI's email in the **Invoice Reference** field.

In EMhub:
---------

Import users page can be reached from the left panel in:

ADMIN > Import from Portal > Import Users

.. image:: https://github.com/delarosatrevin/scipion-session/wiki/images/import_users.png
   :width: 100%


If the is an error **error: Missing PI**, it means that the field for the **Invoice Reference**
of this user is not properly set to a valid email of an existing PI in EMhub. This needs to be
fixed in the Application Portal by editing the user information before importing the user.

After there are some users for whom their PI has been detected, the "Show Ready Users" button
can be clicked. Then it will show only the list of ready users and the button will change to
"Import Users (X ready)".


Adding PIs to an Application
============================

For PI users, one must also check that they belong to an exiting Application and if not, add them.
For adding a PI to an Application, one must open the application and add the PI using its ID in the
system.

.. image:: https://github.com/delarosatrevin/scipion-session/wiki/images/adding_pi_application.png
   :width: 100%


