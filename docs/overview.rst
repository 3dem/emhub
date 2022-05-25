
emhub
=====

A web application for CryoEM facility management:
users,  applications, resource bookings, data collection sessions, monitoring, and reporting.

The application logic is organized around the following modules:


Administration
--------------

Users
.....

Existing users in the system might have one or more roles depending if they are facility staff
or if there are external users.

**User roles**:

* *admin*: have special privileges such as database access and are intended for the application maintenance tasks.
* *managers*: facility staff that is in charge of applications and daily operations.
* *reviewers*: external users that will evaluate incoming applications for a certain period.
* *pi*: external users that are principal investigators (PI) of a lab with other users.
* *users*: if an external user does not have any of the previous roles, then it should select an existing PI.

The first time a user registers an account, it should select its role. The new account should be approved
by the facility staff.

Read more information about `Users <https://github.com/3dem/emhub/wiki/Users>`_.

Resources
.........

Resources are either instruments or services provided by the facility to its external users.
Examples of instruments are microscopes, vitrobots, and carbon coater, among others. Regularly
scheduled drop-in sessions for helping users with their projects can be one of such services.

Resources are a central part of the Bookings or time allocation for Applications. Each resource
can have different booking rules and also exceptions for specific applications.

Read more information about `Resources <https://github.com/3dem/emhub/wiki/Resources>`_.


Applications
------------

Applications are created by external users in order to get access time to the facility instruments.
Different types of applications are enabled by the facility staff by creating application *Templates*.

Templates
.........

Facility staff users (role **admin** or **manager**) can create application *Templates*, which are
basically a form with input fields required for a certain type of Application. Before opening an application
period, managers can create new templates and disabled old ones (that will still be linked to previous
applications).

Read more information about `Templates <https://github.com/3dem/emhub/wiki/Templates>`_.

Applications
............

During an application period, PIs can create an application from one of the available templates.
Then, other PI users can be added to the application and the required information should be provided.
The application can be in "preparation" mode and can be modified as much as needed. Once the application
is ready, it can be submitted for inspection of the facility staff for feasibility and also for
a scientific evaluation by an external committee.

Read more information about `Applications <https://github.com/3dem/emhub/wiki/Applications>`_.

Reviews
.......

Submitted applications go through a two phases revision. First, the facility staff check that all the
necessary information is provided, and the proposed project is feasible for CryoEM experiments. Then,
there is a scientific evaluation by an external committee. Members of this committee should also be
registered as users in the application what the **reviewer** role. Reviewers will provide feedback on
the application and give some relevance ratings. Based on this feedback, applications will be selected
for approval, and instruments time will be allocated to each.

Read more information about `Reviews <https://github.com/3dem/emhub/wiki/Reviews>`_.

Bookings
--------

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

Read more information about `Bookings <https://github.com/3dem/emhub/wiki/Bookings>`_.


Sessions
--------

Sessions start with the usage of the instruments (usually data collection in the microscopes)
for some users. Sessions are usually dedicated to either do some screening of the sample quality
or to collect images from the desired specimen. Both types of sessions usually require configuration
of the microscopes.

In the sessions that data is being acquired, it is usually desired to perform some on-the-fly
data processing to further evaluate the quality of the data.

Read more information about `Sessions <https://github.com/3dem/emhub/wiki/Sessions>`_.

Setup (previously Wizard)
.....

Preprocessing
.............

Monitoring
..........


Reports
-------

Statistics
..........





