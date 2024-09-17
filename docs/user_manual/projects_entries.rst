
Projects and Entries
====================

A ``Project`` is an advantageous entity in EMhub that allows grouping and
documenting several types of events (e.g., bookings and sessions) related to a research project.
The complete timeline of a project can be visualized, and from there, one can access
any data collection or other information relevant to the project.

``Entries`` can be added to a project for various purposes. Entries can be customized to
store flexible information and can be used to implement different operations and
associated reporting. Read the following sections for more concrete examples.


Projects
--------

Projects List
.............

An overview of all projects can be seen on the ``Projects`` Page. This list shows helpful information about a
project, such as the number of sessions, images, and data storage used by the project.

.. image:: https://github.com/3dem/emhub/wiki/images/202306/project_list.jpg
   :width: 100%

New Project
...........

It is also possible to create new projects from that page by clicking on the ``Create Project`` button. The following
dialog should appear to provide information about the project:

.. image:: https://github.com/3dem/emhub/wiki/images/202306/project_create.jpg
   :width: 100%

Facility staff can create and assign projects to other users, but regular users can only create projects themselves.
In both cases, collaborators can be added to a project, and basic information, such as title and description, can be specified.

Project's Timeline
..................

The project timeline shows all operations done over time.

.. image:: https://github.com/3dem/emhub/wiki/images/202306/project_timeline.jpg
   :width: 100%

Entries
-------

Entries can be defined as "cards" that can be used within a project. They will serve to annotate what is happening in a project.
Input parameters (scalar values, images, tables) for each type of entry can be defined with a JSON config and the GUI form will
be generated automatically. Entries enable the implementation of different policies or workflows for project management across various centers.
For example, in the CryoEM center at St.Jude, the **Microscope Request** entry type allows users to request microscope time.
Then, this information is fetched from the customized Dashboard to show active requests and facilitate the distribution of sessions
during the staff weekly meeting. At SciLifeLab, several types of entries are related to the grids tracking workflow used
in the facility. The following sections provide some additional information about these entry examples.


Microscope Request
..................

Users use this type of entry at St. Jude to request access to microscopes. This entry defines
several tabs with parameters that the user will provide depending on the microscope and the type of experiment.
The user can upload several images in some tabs to document previous experiment results.

.. tab:: Tab: General

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/entry_microscope_request1.jpg
       :width: 100%

.. tab:: Tab: Support for Krios Access

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/entry_microscope_request2.jpg
       :width: 100%


Grids Tracking and Pucks Storage
................................

Although its usage is not mandatory, EMhub provides a table in its internal database to store
information about pucks. One can define puck properties such as: label, color, and location
in a dewar and cane.

In the CryoEM center at SciLifeLab in Solna, several types of entries are used to document
the grids tracking process. For example, the **Grids Preparation** entry allows to record the parameters used for
grid preparation.

.. tab:: Grids Preparation entry parameters

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/entry_grids_preparation.png
       :width: 100%

Usually, after a Grids Preparation entry, it follows a **Grids Storage** entry.
This one is special since it inputs the puck location from the database and marks
the positions of the grids. It also allows us to make additional annotations.

.. tab:: Grids Storage entry parameters

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/entry_grids_storage.jpg
       :width: 100%

The information collected from these types of entries is then used to track
the locations of stored grids in the pucks over time. This allows to replace
the paper notebook that is common in many CryoEM facilities by a page that shows
a map with all dewars, canes and pucks. In each position, the last entry information
will be displayed related to the stored sample.

.. tab:: Grids Storage map showing all positions that have annotated sample information

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/grids_storage.jpg
       :width: 100%

At SciLifeLab, there are two additional type of entries related to the tracking
and annotation of grids within a project: **Screening** and **Data Acquisition**.
In both cases, there is a *Report Images* tab where images can be uploaded with comments.
This can be used to generate a report related to that entry.

.. tab:: Screening

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/entry_screening.png
       :width: 100%

.. tab:: Data Acquisition

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/entry_data_acquisition.jpg
       :width: 100%


