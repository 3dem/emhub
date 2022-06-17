
========
Sessions
========

Sessions are related to the data acquisition in one of the microscopes. All sessions are related to a
booking for the given microscope. A session stores information about where the acquired image files are
stored and how the user can access them. In some cases, on-the-fly pre-processing of the data can also be
available to a session.

A new session can be created from the ``New Session`` button that is shown in the microscope (in the Dashboard page)
if there is a booking for it. After clicking the button, a new dialog will appear to confirm the session
information and its creation (see image below).

.. image:: https://github.com/3dem/emhub/wiki/images/session-new.png
   :width: 100%

After the session is created, a green box will appears with the session id. Sometimes, more than one data acquisition
can be done for the same booking, so more than one session can be created. One can click on the ``New Session`` button
again and click `Yes` to the warning dialog. After created another session, more green boxes will be shown as in the
following image.

.. image:: https://github.com/3dem/emhub/wiki/images/session-pills.png
   :width: 50%


Sessions List
=============

Facility staff can see all sessions in the ``Sessions List`` page (accessible from the ``Sessions`` link in the left
toolbar). For non-staff users, only the sessions related to them will appear in the list.

.. image:: https://github.com/3dem/emhub/wiki/images/sessions-list.png
   :width: 100%

In this list, one can easily access the related booking to the session or go the :ref:`session details <session-details>`.
Staff users can also delete sessions.


.. _session-details:

Session Details
===============

.. image:: https://github.com/3dem/emhub/wiki/images/session-details.png
   :width: 100%

This page contains two main panels. The `Overview` panels displays basic information about the session
and the associated booking. The `Data Download` panels have useful information for users about how to
access the data generated for this session. Moreover, it displays a reminder about how many days are left
before the data is deleted from the facility servers.


Session Live Pre-processing (under development)
===============================================

EMhub can receive notifications from other programs performing on-the-fly pre-processing for a given session
(via a REST API). This feature is still under development and not fully stable. The idea is that one could
use different software programs for the pre-processing (e.g Scipion, Relion, CryoSparc, etc) and then visualize
and monitor the progress via EMhub, with the information linked to the session and its user.

.. image:: https://github.com/3dem/emhub/wiki/images/session-preprocessing.png
   :width: 100%

This feature can also be used as a session "summary" archival for a better bookkeeping and future statistics
of the microscopes and processed samples.