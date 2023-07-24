
====================
Invoices and Reports
====================

This section contains information relevant to facility staff or site admins.


Invoices
========

Invoice Periods
---------------

In EMhub it is possible to define ``Invoice Periods`` that are basically a period
with start and end date for accountability and invoicing purposes. All the bookings
in that period will count toward the invoicing of this period. It is also possible
to define addionatal "transactions", reflecting other costs (e.g. sample shipping)
or even some payments made by PIs in advance.

.. image:: https://github.com/3dem/emhub/wiki/images/202306/invoice_periods.jpg
   :width: 100%


TODO: Document more about Invoices and check about related screenshots from SciLifelab.


Reports
=======

Instruments Usage Report
------------------------
Monitoring the usage of the instruments, specially the microscope is very important
for a CryoEM facility. EMhub provides an easy way to quickly look at the usage, either
based on the number of booking days or by the amount of images/data collected.

For this report, one can select one or several instruments and also a range
of time. After clicking the ``Update`` button, the report is generated. It
shows an overall distribution of the bookings for the selected period and
it is also possible to view the detailed list of bookings for each PI that
contributed to the report.

The metric for the report can be ``days``, as shown in the following image:

.. image:: https://github.com/3dem/emhub/wiki/images/202306/report_usage_days.jpg
   :width: 100%

Or by data:

.. image:: https://github.com/3dem/emhub/wiki/images/202306/report_usage_data.jpg
   :width: 100%

