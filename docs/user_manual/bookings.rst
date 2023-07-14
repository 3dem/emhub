
========
Bookings
========

Bookings are used to organize access to each instrument. After some application have been approved,
users belonging to each active application can book time slots for using different instruments. Some
instruments and applications are required to book only in specific time *slots* enabled by the facility
staff. External users are basically divided into national and local users. The main difference is that
national users will book in these pre-allocated slots, while local users have more freedom to select
available days.

Other bookings can be made by the facility personnel to define instruments downtime
or to reserve days for instrument calibration or testing. It is also possible to define recurrent
events that will repeat with a certain frequency. For example, slots for national users can
be defined every other week.

Bookings are one of the central pieces of the entire EMhub application. Users can create bookings
to use a given :doc:`resource <resources>` (e.g instruments, services) in a certain date and time. Managers can also
bookings to mark maintenance or downtime for instruments. Bookings can be marked as "slots"
(by managers) to give exclusive access to a specific group of users
(e.g belonging to :doc:`application <applications>` A or B).


Dashboard
=========

.. image:: https://github.com/3dem/emhub/wiki/images/dashboard.png
   :width: 100%


The dashboard is the entry page for every user. On the left panel, there is information about the
current logged user:

#. Username and :ref:`Roles <user-roles>`.
#. Contact Information
#. Group (either a PI lab or a Facility Unit)
#. Active Applications

At the right, there is a panel for each available resource with a calendar icon as shortcut to
:ref:`create bookings <create-booking>` for this resource. Another option to make bookings is to
go to the :ref:`Booking Calendar <booking-calendar>` page. In some cases, one can see that there
are :doc:`sessions` running for some instruments, that will be displayed as green pills inside
the instrument card.

The bottom panel shows the list of upcoming bookings (today, this week, this month). If the user
is a ``manager``, all bookings will be shown. If it is not, then only bookings related to the
user's lab.


.. _booking-calendar:

Booking Calendar
================

.. image:: https://github.com/3dem/emhub/wiki/images/calendar-all.png
   :width: 100%

This page shows all bookings for all resources. It is possible to filter what resources
to display by selecting one or several resources in the ``Display`` dropdown list at
the top right corner.

When clicking on an existing booking, a modal dialog is shown with more information
about that booking. If the user has not access to the booking (it is not a manager
or the bookings does not belong to its lab), the title, description and any other
information will be hidden.

If clicking in an empty space, then a dialog is show that allows to
:ref:`create a new booking <create-booking>`.

.. _create-booking:

Creating a new Booking
======================

Basic parameters
----------------

New bookings can be created from the :ref:`Booking Calendar <booking-calendar>`. First,
the desired resource to book should be selected from the left top dropdown list as shown
in the following image.

.. image:: https://github.com/3dem/emhub/wiki/images/calendar-book.png
   :width: 100%

Then, one should click on an empty space of a free day to popup the new booking dialog
(draging after click allows to spawn the booking for more days).

.. image:: https://github.com/3dem/emhub/wiki/images/booking.png
   :width: 100%

.. csv-table:: **Main input parameters for a Booking**
   :widths: 10, 50

   "**Owner**", "This is the user to whom the booking belongs to. If the logged user is a manager,
   the owner can be assigned to any user."
   "**Operator**", "This will be changed by facility staff to assign an operator that will
   be doing the data collection."
   "**Application**", "This will be set after the booking is created taking into account
   user's active applications."
   "**Title**", "Provide a title for your booking (can be left empty)"
   "**Start/End**", "Start and end date/time for your booking"
   "**Description**", "Extra information related to your booking. Very useful for work planning
   for the facility staff"

Manager options
---------------

If the logged user is a manager, then some extra options are available as shown in the
following image.

.. image:: https://github.com/3dem/emhub/wiki/images/booking-admin.png
   :width: 100%

.. csv-table:: **Manager options for a Booking**
   :widths: 20, 50

   "**Booking Type**", "Select the booking type: `Booking`, Slot, Downtime or Maintenance."
   "**Slot Authorization**", "If the booking is a ``Slot``, select which :doc:`applications`
   have access to book."
   "**Repeat**", "If this booking is a repeating event. (e.g drop-ins every other week)"
   "**Modify repeating**", "If changes are applied to only this booking or all repeating ones."


.. topic:: **Booking Slots**

    There are special type of bookings used by managers. Their purpose is to block some days
    and give booking access to certain users. The access is granted via :doc:`applications` access
    in the **Slot Authorization** parameter. For example, if a slot is created for `Resource 1` and
    authorization is set to `applications A and B`, users belonging to `application C` will not be
    able to book `Resource 1` in that slot.


.. topic:: **Maintenance/Downtime**

    This type of bookings serve to block usage of resources that are not available.


First of all, users need to register in the Application Portal as stated in `Booking Guideline
<https://emhub.cryoem.se/pages/?page_id=guidelines>`_.


Modifying/Canceling a Booking
=============================

For PI users, one must also check that they belong to an exiting Application and if not, add them.
For adding a PI to an Application, one must open the application and add the PI using its ID in the
system.

.. image:: https://github.com/delarosatrevin/scipion-session/wiki/images/adding_pi_application.png
   :width: 100%


