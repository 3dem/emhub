
=========
Resources
=========

Resources are either instruments or services provided by the facility to its external users.
Examples of instruments are microscopes, vitrobots, and carbon coater, among others. Regularly
scheduled drop-in sessions for helping users with their projects can be one of such services.

Resources are a central part of the Bookings or time allocation for Applications. Each resource
can have different booking rules and also exceptions for specific applications.



Resources in EMhub define "bookable items" with different properties and rules.
Resources can represent instruments that are available and which use is coordinated via bookings.
Different rules can be configured for different instruments. Resources can also be services
that are offered to the facility users in some defined time slots.

Resource List
=============

The list of resources can be reached from the ``Resources`` link in the left sidebar. The following
table shows the resources in a table where the main properties are listed. This page requires
to have admin or manager roles. Resource properties can not be changed by other users.

.. image:: https://github.com/3dem/emhub/wiki/images/resources-list.png
   :width: 100%

From this page a new resource can be created. Also existing resources can be modified as shown in
the next image. A new resource can be created as a copy of an existing one if they share some
properties and only some need to be modified.

.. image:: https://github.com/3dem/emhub/wiki/images/resources-edit.png
   :width: 100%

Basic Properties
================

.. csv-table:: **Basic Resource Parameters**
   :widths: 10, 50

   "**Name**", "Name of the resource that will be mainly used for display."
   "**Status**", "*active* or *inactive*, in which case that resource can not be booked or used."
   "**Tags**", "Free list of tag names that allows to group resources by categories. "
   "**Icon image**", "Image file used as icon for the resource."
   "**Color**", "Color to display the bookings related to this resource."


Booking properties
==================

.. csv-table:: **Booking related Parameters**
   :widths: 10, 50

   "**Latest cancellation**", "Number of hours in advance that allows users to cancel a booking for this resource.
   For example, a value of 48, means that bookings of this resources can be cancel just two days (48h) in advance.
   A value of 0 means no restriction."
   "**Minimum Booking time**", "Minimum amount of hours for bookings of this resources. Value 0 means no minimum. "
   "**Maximum Booking time**", "Maximum amount of hours for bookings of this resources. Value 0 means no maximum. "
   "**Daily cost**", "Cost of the usage of this resource in a one-day booking. This value is used for invoicing."
   "**Requires Slot**", "If *Yes* all bookings of this resource should within an allowed `Slots`."
   "**Requires Application**", "If *Yes* the user that is the `Owner` of the booking should have a valid `Application`."
