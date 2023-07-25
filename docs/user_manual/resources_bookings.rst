======================
Resources and Bookings
======================

Resources
=========

Resources are either instruments or services provided by the facility to its external users.
Examples of instruments are microscopes, vitrobots, and carbon coater, among others. Regularly
scheduled drop-in sessions for helping users with their projects can be one of such services.

Resources are a central part of the Bookings or time allocation for Applications. Each resource
can have different booking rules and also exceptions for specific applications.


Resource List
-------------

The list of resources can be reached from the `Resources` link in the left sidebar. The following
page shows the resources in a table where the main properties are listed. This *Actions* column requires
to have admin or manager roles. Resource properties can not be changed by other users.

.. image:: https://github.com/3dem/emhub/wiki/images/resources-list.png
   :width: 100%

From this page a new resource can be created. Also existing resources can be modified as shown in
the next image. A new resource can be created as a copy of an existing one if they share some
properties and only some need to be modified.

.. image:: https://github.com/3dem/emhub/wiki/images/resources-edit.png
   :width: 100%

Resource Properties
-------------------

Basic Properties
................

.. csv-table:: **Basic Resource Parameters**
   :widths: 10, 50

   "**Name**", "Name of the resource that will be mainly used for display."
   "**Status**", "*active* or *inactive*, in which case that resource can not be booked or used."
   "**Tags**", "Free list of tag names that allows to group resources by categories. "
   "**Icon image**", "Image file used as icon for the resource."
   "**Color**", "Color to display the bookings related to this resource."


Booking Related Properties
..........................

There are some properties of each resources that are related to the Bookings.

.. csv-table:: **Booking related Parameters**
   :widths: 10, 50

   "**Latest cancellation**", "Number of hours in advance that allows users to cancel a booking for this resource.
   For example, a value of 48, means that bookings of this resources can be cancel just two days (48h) in advance.
   A value of 0 means no restriction."
   "**Minimum Booking time**", "Minimum amount of hours for bookings of this resources. Value 0 means no minimum. "
   "**Maximum Booking time**", "Maximum amount of hours for bookings of this resources. Value 0 means no maximum. "
   "**Daily cost**", "Cost of the usage of this resource in a one-day booking. This value is used for invoicing."
   "**Requires Slot**", "If *Yes* all bookings of this resource should within an allowed ``Slots``."
   "**Requires Application**", "If *Yes* the user that is the ``Owner`` of the booking should have a valid ``Application``."


Bookings
========

Bookings are used to organize access to each resource (e.g instruments, services). After some application have been approved,
users belonging to each active application can book time slots for using different instruments. Some
instruments and applications are required to book only in specific time *slots* enabled by the facility
staff.

Other bookings can be made by the facility personnel to define instruments downtime
or to reserve days for instrument calibration or testing. It is also possible to define repeating
events that will occur with a certain frequency. For example, slots for some group of users can
be defined every other week.


Booking Calendar
----------------

The central page to manage all bookings is the ``Booking Calendar``.
This page shows all bookings for all resources. It is possible to filter what resources
to display by selecting one or several resources in the ``Display`` dropdown list at
the top right corner.


.. image:: https://github.com/3dem/emhub/wiki/images/calendar-all.png
   :width: 100%

From this page it is possible to operate with bookings in two main ways:

* **Creating a new booking**
    User need to click in an empty space in a given day in the calendar
    or drag over several days if the booking will use more than one day.
    Then a new dialog will appear for :ref:`creating a new booking <Booking Dialog>`.

* **Modifying an existing booking**
    User should clink on the specific booking. If the user has not access to the booking (it is not a manager
    or the bookings does not belong to its lab), the title, description and any other information will be hidden.
    In that case, all other entries should be Read-Only. If the user has permission, then it can
    :ref:`modify the booking <Booking Dialog>`.


Booking Dialog
--------------

Basic parameters
................

Booking can be created or modified from several pages (e.g Booking Calendar, Dashboard, etc).
The following image shows the dialog displaying a Booking information.

.. image:: https://github.com/3dem/emhub/wiki/images/202306/booking_dialog.jpg
   :width: 100%

.. csv-table:: **Main input parameters for a Booking**
   :widths: 10, 50

   "**Resource**", "Select the resource that one wants to book."
   "**Owner**", "This is the user to whom the booking belongs to. If the logged user is a manager,
   the owner can be assigned to another user."

   "**Project ID**", "(Optional) Select a project to associate this booking with.
   If not empty, the booking will appear in the Project's history. "
   "**Start/End**", "Start and end date/time for your booking. "
   "**Title**", "(Optional) Provide a title for your booking."
   "**Description**", "(Optional) Extra information related to your booking. Very useful for work planning
   for the facility staff."

Admin options
.............

If the logged user is a manager, then the Admin section will be available with
some extra options.

.. csv-table:: **Manager options for a Booking**
   :widths: 20, 50

   "**Operator**", "This will be changed by facility staff to assign an operator that will
   be in charge of the booking/session (usually related to a data collection)."
   "**Booking Type**", "Select the booking type, options are: ``booking``, ``slot``, ``downtime``,  or ``maintenance``."
   "**Slot Authorization**", "If the booking is a ``slot``, select which application
   have access to book in this slot."
   "**Repeat**", "If this booking is a repeating event. (e.g drop-ins every other week)"
   "**Stop Date**", "If repeating event, when to stop the series of bookings."
   "**Modify repeating**", "If changes are applied to only this booking or all repeating ones
   (only applicable to repeating events)."


Booking Types
-------------

* **booking**

    Normal bookings for using a given resource during the selected time frame.

* **slots**

    These are special type of bookings used by managers. Their purpose is to block some days
    and give booking access only to certain users. The permission is granted via the :ref:`Applications` access
    in the *Slots* parameter in the Admin panel. One or more Applications can be allowed for a given Slot.

    For example, if a slot is created for ``Resource 1`` and authorization is set to applications ``A`` and ``B``,
    users belonging to application ``C`` will not be able to book ``Resource 1`` in that slot.

* **downtime/maintenance**

    This type of bookings serve to prevent usage of resources that are not available. It also serve to keep information
    about instruments performance and availability during a period.

* **special**

    Free category for marking some bookings as special events, for example training sessions that are not
    going to be invoiced but are not downtime or maintenance.

