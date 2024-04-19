
Resources and Bookings
======================

Resources
---------

Resources within EMhub can be categorized as either instruments or services the facility provides to its external users.
Examples of instruments include microscopes, vitrobots, and carbon coaters. Additionally, regularly scheduled drop-in
sessions for assisting users with their projects can be classified as services.

Resources are central to the booking system or time allocation for applications.
Each resource can have different booking rules and exceptions tailored to specific applications.


Resource List
.............

The list of resources can be accessed from the `Resources` link in the left sidebar.
The following page displays the resources in a table listing the main properties.
The *Actions* column requires users to have admin or manager roles. Other users cannot change resource properties.

.. image:: https://github.com/3dem/emhub/wiki/images/resources-list.png
   :width: 100%

From this page, a new resource can be created. Additionally, existing resources can be
modified, as shown in the following image. A new resource can be created as a copy of an
existing one if it shares some properties and only some need to be modified.

.. image:: https://github.com/3dem/emhub/wiki/images/resources-edit.png
   :width: 100%

Resource Properties
...................

Basic Properties
~~~~~~~~~~~~~~~~

.. csv-table:: **Basic Resource Parameters**
   :widths: 10, 50

   "**Name**", "Name of the resource that will be mainly used for display."
   "**Status**", "*active* or *inactive*, in which case that resource cannot be booked or used."
   "**Tags**", "Free list of tag names that allows to group resources by categories. "
   "**Icon image**", "Image file used as icon for the resource."
   "**Color**", "Color to display the bookings related to this resource."


Booking Related Properties
~~~~~~~~~~~~~~~~~~~~~~~~~~

There are a few properties of each resource that are related to the Bookings.

.. csv-table:: **Booking related Parameters**
   :widths: 10, 50

   "**Latest cancellation**", "The number of hours in advance that users can cancel a booking for this resource.
   For example, a value of 48 means that bookings of these resources can be canceled just two days (48 hours) in advance.
   A value of 0 means no restriction."
   "**Minimum Booking time**", "Minimum number of hours for bookings of these resources. Value 0 means no minimum. "
   "**Maximum Booking time**", "Maximum number of hours for bookings of these resources. Value 0 means no maximum. "
   "**Daily cost**", "Cost of using this resource in a one-day booking. This value is used for invoicing."
   "**Requires Slot**", "If *Yes* all bookings of this resource should be within allowed ``Slots``."
   "**Requires Application**", "If *Yes* the user that is the ``Owner`` of the booking should have a valid ``Application``."


Bookings
--------

Bookings organize access to each resource (e.g., instruments, services).
After some applications have been approved, users belonging to each active application
can book time slots for using different instruments. Some instruments and applications
must be booked only in specific time slots enabled by the facility staff.

Other bookings can be made by the facility personnel to define instrument downtime or
to reserve days for instrument calibration or testing. It is also possible to define
repeating events that will occur with a specific frequency. For example, slots for some
users can be defined every other week.


Booking Calendar
................

The central page to manage all bookings is the "Booking Calendar." This page
displays all bookings for all resources. It is possible to filter which resources
to display by selecting one or several resources in the "Display" dropdown list
at the top right corner.


.. image:: https://github.com/3dem/emhub/wiki/images/calendar-all.png
   :width: 100%

From this page it is possible to operate with bookings in two main ways:

* **Creating a new booking**
    Users need to click in a space on a given day in the calendar
    or drag over several days if the booking will use more than one day.
    Then a new dialog will appear for :ref:`creating a new booking <Booking Dialog>`.

* **Modifying an existing booking**
    The user should click on the specific booking. The title, description, and other information
    will be hidden if the user cannot access the booking (it is not a manager, or the bookings do not belong to its lab).
    In that case, all other entries should be Read-Only. If the user has permission, it can
    :ref:`modify the booking <Booking Dialog>`.


Booking Dialog
..............

Basic parameters
~~~~~~~~~~~~~~~~

Booking can be created or modified from several pages (e.g., Booking Calendar, Dashboard, etc).
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
~~~~~~~~~~~~~

If the logged user is a manager, then the Admin section will be available with
some extra options.

.. csv-table:: **Manager options for a Booking**
   :widths: 20, 50

   "**Operator**", "This will be changed by facility staff to assign an operator that will
   be in charge of the booking/session (usually related to data collection)."
   "**Booking Type**", "Select the booking type, options are: ``booking``, ``slot``, ``downtime``,  or ``maintenance``."
   "**Slot Authorization**", "If the booking is a ``slot``, select which application
   can book in this slot."
   "**Repeat**", "If this booking is a repeating event. (e.g. drop-ins every other week)."
   "**Stop Date**", "If repeating event, when to stop the series of bookings."
   "**Modify repeating**", "If changes are applied to only this booking or all repeating ones
   (only applicable to repeating events)."


Booking Types
.............

* **booking**

    Regular bookings for using a given resource during the selected time frame.

* **slots**

    These are particular types of bookings used by managers. Their purpose is to block some days
    and give booking access only to specific users. The permission is granted via the :ref:`Applications` access
    in the *Slots* parameter in the Admin panel. One or more Applications can be allowed for a given Slot.

    For example, if a slot is created for ``Resource 1`` and authorization is set to applications ``A`` and ``B``,
    users belonging to application ``C``cannot book ``Resource 1`` in that slot.

* **downtime/maintenance**

    This type of booking serves to prevent the usage of resources that are not available. It also serves to keep information
    about instrument performance and availability during a period.

* **special**

    Free category for marking some bookings as special events, for example, training sessions that are not
    going to be invoiced but are not downtime or maintenance.

