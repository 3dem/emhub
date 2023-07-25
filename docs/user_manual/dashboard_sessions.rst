
======================
Dashboard and Sessions
======================

Sessions usually represent a user's usage of an instrument (e.g. data collection in a microscope).
For CryoEM, microscope sessions are mainly used for screening of the sample quality
or for collecting images from the desired specimen. In most cases, it is convenient to some type of on-the-fly
data processing to further evaluate the quality of the data.

Dashboards in EMhub serve to launch a new session or to manage on-going sessions.

Dashboards
==========

Dashboards are pages designed as the entry point for the facility daily operations.
This is one of the templates that can be customized via the :any:`Instance Configuration`.
Usually, they provide ways to manage the existing bookings or create new ones.

The following are two example of Dashboards, one used at SciLifeLab and the other at St.Jude.

.. tab:: SciLifeLab

    At SciLifeLab, the Dashboard allows to create session for booking in the current day and
    shows upcoming bookings are shown as a list.

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/dashboard_sll.jpg
       :width: 100%

.. tab:: St.Jude

    At St.Jude, the Dashboard displays the bookings for the current week and
    the access request for the next one. It also allows to create sessions
    for bookings on the current day.

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/dashboard_sj.jpg
       :width: 100%


Sessions
========

New Session
-----------

A new session can be created from the ``New Session`` button that is shown in the microscope (in the Dashboard page)
if there is a booking for it. After clicking the button, a new dialog will appear to confirm the session
information and its creation (see images below). This dialog is another template that can be customized via
the :any:`Instance Configuration`.

.. tab:: SciLifeLab

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/new_session_sll.jpg
       :width: 100%

.. tab:: St.Jude

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/new_session_sj.jpg
       :width: 100%


After the session is created, a green box will appears with the session name Sometimes, more than one data acquisition
can be done for the same booking, so more than one session can be created. After created another session, more green
boxes will be shown as in the following image.

.. image:: https://github.com/3dem/emhub/wiki/images/session-pills.png
   :width: 50%

The creation of a new session is commonly link with some actions from ``Workers`` machines. Workers will notice
the new session and might perform some required tasks (e.g. folders creation, data transfer, etc). Workers can update
back the status of a sesions that it is being monitored. More information about workers can be found here: :ref:`Developing Workers`.

Session Details
---------------

This page serve to show information for a given session and it is another template that can be customized via
the :any:`Instance Configuration`.

.. tab:: SciLifeLab

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/session_details_sll.jpg
       :width: 100%

.. tab:: St.Jude

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/session_details_sj.jpg
       :width: 100%


Sessions List
-------------

Facility staff can see all sessions in the ``Sessions List`` page (accessible from the ``Sessions`` link in the left
toolbar). For non-staff users, only the sessions related to them will appear in the list. From this list one can easily
access the booking to a session or go the session details. Staff users can also delete sessions.

.. image:: https://github.com/3dem/emhub/wiki/images/sessions-list.png
   :width: 100%



On-the-fly Data Processing
--------------------------

EMhub has a REST API that allows external programs to communicate with the system. A usage of this feature is the
implementation of workers that perform On-The-Fly (OTF) data processing. The progress of the processing can be
updated back to the associated session. Currently, we have implemented OTF using Relion and Scipion as the underlying
pipelines.


.. image:: https://github.com/3dem/emhub/wiki/images/202306/session_otf_overview.jpg
   :width: 100%

From that page, it is possible to show information per grid square or display several micrographs together (with their
CTF information and particles picked)

Map showing CTF and particles statistics per Grid Square:

.. image:: https://github.com/3dem/emhub/wiki/images/202306/session_otf_gridsquares.jpg
   :width: 100%


Map with some Micrographs and their particles:

.. image:: https://github.com/3dem/emhub/wiki/images/202306/session_otf_micrographs.jpg
   :width: 100%





