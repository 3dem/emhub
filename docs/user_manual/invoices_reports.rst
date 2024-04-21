

Invoices and Reports
====================

This section contains information relevant to facility staff or site admins.


Invoices
--------

Invoice Periods
...............

In EMhub, it is possible to define ``Invoice Periods`` with defined start and end dates for accountability and invoicing purposes. All the bookings
within that period will count toward the invoicing for that period. Moreover, it is
possible to define additional ``transactions`` reflecting other costs, such as sample shipping or payments made by PIs in advance.

.. image:: https://github.com/3dem/emhub/wiki/images/202306/invoice_periods.jpg
   :width: 100%


TODO: Document more about Invoices and check about related screenshots from SciLifelab.


Reports
-------

Instruments Usage Report
........................

Monitoring the usage of the instruments, especially microscopes, is very important
for a CryoEM facility. EMhub provides an easy way to quickly examine its usage
based on the number of booking days or the amount of images/data collected.

For this report, one can select one or several instruments and a time range.
After clicking the ``Update`` button, a report showing the distribution of the bookings for the selected period is generated.
Viewing the detailed list of bookings for each PI contributing to the report is also possible.

The metric for the report can be ``days``, as shown in the following image:

.. image:: https://github.com/3dem/emhub/wiki/images/202306/report_usage_days.jpg
   :width: 100%

Or ``data``:

.. image:: https://github.com/3dem/emhub/wiki/images/202306/report_usage_data.jpg
   :width: 100%

