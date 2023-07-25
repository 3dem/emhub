
============
Config Forms
============

For configuration, we have used (or abused) the Form data type from EMhub. Forms
provide a convenient way to set an attribute that is a JSON string. This has been
used to store some needed configurations for EMhub. All configuration forms has the
name **config:ConfigName**.


Bookings Config Form
====================

Basic configuration about Bookings' Display

.. code-block:: json
    :caption: Form name: config:bookings
    :name: config:bookings
    :linenos:

    {
        "display": {
            "show_operator": true,
            "show_application": false,
            "show_experiment": false
        },
        "local_tag": "stjude"
    }

.. csv-table:: **Parameters**
   :widths: 10, 10, 50

   "``display``", "", "Displaying options for Bookings."
   "", "``show_operator``", "Show or not the Operator's Name when displaying booking info. (TODO: document better where it is used)"
   "", "``show_application``", "Show or not the Application's Name when displaying booking info. (TODO: document better where it is used)"
   "", "``show_experiment``", "If true, there is an ``Experiment`` form associated to each booking. "
   "``local_tag``", "", "In the case that there are register instruments from many facilities in EMhub, you can specify with this what is the *local* one and only instruments with this tag will be displayed in some cases."


Project Config Form
===================

Configuration form to customize the projects and available entries.

.. code-block:: json
    :caption: Form name: config:projects
    :name: config:projects
    :linenos:
    :emphasize-lines: 2, 12, 47

    {
        "entries_menu": [
            [
                "access_microscopes",
                "Request Microscope Access"
            ],
            [
                "note",
                "Note"
            ]
        ],
        "entries": {
            "grids_storage": {
                "label": "Grids Storage",
                "group": 1,
                "iconClass": "fas fa-box fa-inverse",
                "imageClass": "img--picture",
                "report": "report_grids_storage.html"
            },
            "data_acquisition": {
                "label": "Data Acquisition",
                "group": 2,
                "iconClass": "far fa-image fa-inverse",
                "imageClass": "img--location",
                "report": "sj_report_data_acquisition.html"
            },
            "note": {
                "label": "Note",
                "group": 3,
                "iconClass": "fas fa-sticky-note fa-inverse",
                "imageClass": "img--picture"
            },
            "access_microscopes": {
                "label": "Microscope Request",
                "group": 2,
                "iconClass": "fas fa-search fa-inverse",
                "imageClass": "img--location",
                "report": "sj_report_access_microscopes.html"
            },
            "booking": {
                "label": "Booking",
                "group": 3,
                "iconClass": "far fa-calendar",
                "imageClass": "img--location"
            }
        },
        "permissions": {
            "user_can_create_projects": "all",
            "user_can_see_projects": [
                {
                    "key": "mine",
                    "label": "My Projects"
                },
                {
                    "key": "lab",
                    "label": "Lab's Projects"
                },
                {
                    "key": "all",
                    "label": "All Projects"
                }
            ]
        }
    }

.. csv-table:: **Parameters**
   :widths: 10, 10, 50

   "``entries_menu``", "", "List of entries that will appear in the Projects ``Add Entry`` menu. Each item should be of the following:"
   "", "``[entry_key, ENTRY_LABEL]``", "``entry_key`` should be from ``entries`` dict. Moreover, it should be another config form with the name ``entry_form::entry_key`` defining that entry parameters. For example, for ``access_microscopes`` entry, there is a form ``entry_form::access_microscopes``."
   "", "``[]``", "Adding a empty list will add a separator in the menu."
   "``entries``", "", "Specify the list of entry's configurations that can be used in the project's menu. Each entry config should have the following options:"
   "", "``label``", "Label to be displayed."
   "", "``group``", "Legacy param, not in use."
   "", "``iconClass``", "Icon to be used for this entry. See Font Awesome (version xxx) for possible options."
   "", "``imageClass``", "Class from Concept template, possible options are: ``img--picture``, ``img--location``"
   "", "``report``", "Report HTML template associated with this type of entry (TODO add reference to Developer Guide)"
   "``permissions``", "", "Options related to the on-the-fly processing."
   "", "``user_can_create_projects``", "What type of users can create projects. Possible values: ``all``, ``manager``, ``admin``"
   "", "``user_can_see_projects``", "Visibility groups of existing projects. "


Sessions Config Form
====================

The following form is used to customize some options related to sessions.

.. code-block:: json
    :caption: Form name: config:sessions
    :name: config:sessions
    :linenos:
    :emphasize-lines: 2, 18, 23, 31

    {
        "acquisition": {
            "Krios01": {
                "voltage": 300,
                "magnification": 130000,
                "pixel_size": 0.6485,
                "dose": 1.09,
                "cs": 2.7
            },
            "Arctica01": {
                "voltage": 200,
                "magnification": 79000,
                "pixel_size": 1.044,
                "dose": 1.063,
                "cs": 2.7
            }
        },
        "data": {
            "gain": "/jude/facility/data/gains/*{microscope}*gain*.mrc",
            "cryolo_models": "/jude/facility/data/cryolo_models/*/*.h5",
            "images": ""
        },
        "raw": {
            "root_frames": "/mnt/EPU_frames",
            "root": "/research/cryo_core_raw",
            "hosts": {
                "Krios01": "workstation01.emhub.org",
                "Arctica01": "workstation02.emhub.org"
            }
        },
        "otf": {
            "root": "/jude/facility/appdpcryoem",
            "relion": {
                "command": "/software/emhub-otf/scripts/relion-otf.sh {session_id} {otf_path}",
                "options": {
                    "do_prep": "True",
                    "do_proc": "False",
                    "prep__do_at_most": "32",
                    "prep__importmovies__angpix": "{pixel_size}",
                    "prep__importmovies__kV": "{voltage}",
                    "prep__importmovies__Cs": "{cs}",
                    "prep__importmovies__fn_in_raw": "data/Images-Disc1/GridSquare_*/Data/FoilHole_*_fractions.tiff",
                    "prep__importmovies__is_multiframe": "True",
                    "prep__motioncorr__do_own_motioncor": "False",
                    "prep__motioncorr__fn_motioncor2_exe": "/software/scipion/EM/motioncor2-1.5.0/bin/motioncor2",
                    "prep__motioncorr__dose_per_frame": "1.00",
                    "prep__motioncorr__do_save_noDW": "False",
                    "prep__motioncorr__do_save_ps": "False",
                    "prep__motioncorr__do_float16": "False",
                    "prep__motioncorr__fn_gain_ref": "./gain.mrc",
                    "prep__motioncorr__bin_factor": "1",
                    "prep__motioncorr__gpu_ids": "0:1:3:4",
                    "prep__motioncorr__nr_mpi": "4",
                    "prep__motioncorr__nr_threads": "1",
                    "prep__motioncorr__patch_x": "7",
                    "prep__motioncorr__patch_y": "5",
                    "prep__motioncorr__other_args": "--skip_logfile --do_at_most 32",
                    "prep__ctffind__fn_ctffind_exe": "/software/scipion/EM/ctffind4-4.1.13/bin/ctffind",
                    "prep__ctffind__nr_mpi": "8",
                    "prep__ctffind__use_given_ps": "False",
                    "prep__ctffind__use_noDW": "False"
                }
            },
            "scipion": {
                "command": "/software/emhub-otf/scripts/scipion-otf.sh {session_id} {otf_path}",
                "options": {}
            },
            "hosts": [
                "default",
                "workstation01.emhub.org",
                "workstation02.emhub.org"
            ],
            "hosts_default": {
                "Krios01": "workstation01.emhub.org",
                "Arctica01": "workstation02.emhub.org"
            },
            "workflow": {
                "default": "scipion"
            }
        }
    }

.. csv-table:: **Parameters**
   :widths: 10, 10, 50

   "``acquisition``", "", "Specify acquisition parameters for each of the Microscopes. The key should be the Resource's Name of the Microscope."
   "``data``", "", "Specify some data locations. For example, data['gain'] should point to the pattern of where the gain references are. The newest one will be used for the OTF."
   "``raw``", "", "Configuration of raw data locations and workers."
   "", "``root_frames``", "Where raw frames will be written from the camera PC."
   "", "``root``", "Root of offloading server where frames might be moved."
   "", "``hosts``", "Hosts that will take care of the transfer for each microscope."
   "``otf``", "", "Options related to the on-the-fly processing."
   "", "``root``", "Where OTF folder for each session will be created."
   "", "``relion``", "Options for the Relion pipeline. "
   "", "``scipion``", "Options for the Scipion pipeline. "
   "", "``hosts``", "Host options to launch the OTF (usually available only to managers)."
   "", "``hosts_defaults``", "What is the default option for each microscope."
   "", "``workflow``", "Workflow options to choose from."


Permissions Config Form
=======================

The following form defines what user's roles have permissions to perform a given action.
Each key will be an action and the options are specified for tags. In the following example
there are two groups of permissions, one for tag ``microscope`` and the other for tag ``prep``.
In this case, only ``admin`` or ``manager`` can create bookings for microscopes but any
``user`` can create bookings for ``prep`` tagged instruments.

.. code-block:: json
    :caption: Form name: config:permissions
    :name: config:permissions
    :linenos:

    {
        "create_booking": {
            "microscope": ["manager", "admin"],
            "prep": ["user"]
        },
        "delete_booking": {
            "microscope": ["manager", "admin"],
            "prep": ["user"]
        },
        "create_session": ["manager", "admin"],
        "content": {
            "usage_report": ["manager", "admin"],
            "raw": ["admin"]
        }
    }

.. csv-table:: **Parameters**
   :widths: 10, 50

   "``create_booking``", "Define what user roles can create bookings, based on resource tags."
   "``delete_booking``", "Define what user roles can delete bookings, based on resource tags."
   "``create_session``", "Define permissions for session creation."


Hosts Config Form
=================

This form is used to define a list of worker hosts that are allowed to connect with EMhub.
An alias should be defined for each hosts. After a worker hosts is connected, it can
notify the host hardware. See below the initial configuration and after workers have
connected and sent some info.

.. tab:: Initial

    .. code-block:: json
        :caption: Form name: config:hosts
        :name: config:hosts:before
        :linenos:

        {
            "workstation01.emhub.org": {
                "alias": "l1",
            },
            "workstation02.emhub.org": {
                "alias": "l2",
            }
        }

.. tab:: After workers report

    .. code-block:: json
        :caption: Form name: config:hosts
        :name: config:hosts:after
        :linenos:

        {
            "workstation01.emhub.org": {
                "alias": "l1",
                "updated": "2023-07-24 12:09:29",
                "specs": {
                    "CPUs": 72,
                    "GPUs": {
                        "NVIDIA GeForce GTX 1080 Ti": {
                            "count": 4,
                            "memory": "11178 MiB"
                        }
                    }
                }
            },
            "workstation02.emhub.org": {
                "alias": "l2",
                "updated": "2023-07-24 12:09:23",
                "specs": {
                    "CPUs": 72,
                    "GPUs": {
                        "NVIDIA GeForce GTX 1080 Ti": {
                            "count": 4,
                            "memory": "11264 MiB"
                        }
                    }
                }
            }
        }