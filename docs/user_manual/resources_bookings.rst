
Invoices and Reports
====================

This section contains information relevant to facility staff or site admins.


Invoices
--------

Invoice Periods
...............

In EMhub, it is possible to define ``Invoice Periods`` with defined start and end dates
for accountability and invoicing purposes. All the bookings
within that date range will count toward the invoicing for that period. Additionally, it is
possible to define additional ``transactions`` reflecting other costs, such as sample shipping
or payments made by PIs in advance.

.. image:: https://github.com/3dem/emhub/wiki/images/202306/invoice_periods.jpg
   :width: 100%


TODO: Document more about Invoices and check about related screenshots from SciLifelab.


Reports
-------

Instruments Usage Report
........................

Monitoring the usage of the instruments, especially microscopes, is very important
for a CryoEM facility. EMhub provides an easy way to quickly examine the usage, either
based on the number of booking days or by the amount of images/data collected.

For this report, one or several instruments and a range of time can be selected.
After clicking the ``Update`` button, the report is generated. It shows an overall
distribution of the bookings for the period chosen, and it is also possible to view
the detailed list of bookings for each PI that contributed to the report.

The metric for the report can be ``days``, as shown in the following image:

.. image:: https://github.com/3dem/emhub/wiki/images/202306/report_usage_days.jpg
   :width: 100%

Or by ``data``:

.. image:: https://github.com/3dem/emhub/wiki/images/202306/report_usage_data.jpg
   :width: 100%

