
Entry Forms
===========

There forms will define different type of entries that can be used in a project.
Each entry needs an associated form with name ``entry_form:X``, where X is the name
of the entry. Form example, the **Screening** entry requires a form named ``entry_form:screening``.
In this form, parameters are defined in JSON format, from which the GUI will be generated and
the data will be stored.

Basic Parameters Definition
---------------------------

The following shows an example entry form that illustrate the parameters definition described previously.


.. tab:: Screening JSON params definition

    .. code-block:: json
        :caption: Form name: entry_form:screening
        :name: entry_form:screening
        :linenos:

        {
            "title": "Screening",
            "sections": [
                {
                    "label": "Grids Comments",
                    "params": [
                        {
                            "id": "grids_table",
                            "label": "Grids Table",
                            "type": "table",
                            "columns": [
                                {
                                    "id": "gridbox_label",
                                    "label": "Grid Label"
                                },
                                {
                                    "id": "sample",
                                    "label": "Sample",
                                    "type": "text"
                                },
                                {
                                    "id": "comments",
                                    "label": "Comments",
                                    "type": "text"
                                }
                            ],
                            "min_rows": 5
                        }
                    ]
                },
                {
                    "label": "Report Images",
                    "params": [
                        {
                            "id": "images_table",
                            "label": "Images Table",
                            "type": "table",
                            "columns": [
                                {
                                    "id": "image_title",
                                    "label": "Image Title"
                                },
                                {
                                    "id": "image_description",
                                    "label": "Image Description",
                                    "type": "text"
                                },
                                {
                                    "id": "image_file",
                                    "label": "Image File",
                                    "type": "file_image"
                                }
                            ],
                            "min_rows": 5
                        }
                    ]
                }
            ]
        }

Customs Param and Required Content
----------------------------------

For some type of entries, we want the GUI Form to display information
from the database or a custom widget. This can be achieved with the
*custom* type of parameter where a *template* value is required pointing
to the HTML template. Addionally, several *content* functions will be listed
to provide the data required to render this form and its custom parameters.

.. tab:: Screening JSON params definition

    .. code-block:: json
        :caption: Form name: entry_form:grids_storage
        :name: entry_form:grids_storage
        :linenos:

        {
            "title": "Grids Storage",
            "params": [
                {
                    "id": "grids_storage_table",
                    "label": "Grids Storage Table",
                    "type": "table",
                    "columns": [
                        {
                            "id": "gridbox_label",
                            "label": "GridBox Label"
                        },
                        {
                            "id": "puck_id",
                            "label": "Puck",
                            "type": "custom",
                            "template": "param_select_puck.html"
                        },
                        {
                            "id": "box_position",
                            "label": "Box Position",
                            "enum": {
                                "choices": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                                "display": "combo"
                            }
                        },
                        {
                            "id": "grid_position",
                            "label": "Grid Position",
                            "enum": {
                                "choices": [1, 2, 3, 4],
                                "display": "combo",
                                "multiple": true
                            }
                        },
                        {
                            "id": "sample",
                            "label": "Sample",
                            "type": "text"
                        },
                        {
                            "id": "sessions",
                            "label": "Session(s)"
                        },
                        {
                            "id": "atlas",
                            "label": "Atlas",
                            "type": "bool"
                        },
                        {
                            "id": "EPU",
                            "label": "EPU",
                            "type": "bool"
                        }
                    ],
                    "min_rows": 5
                }
            ],
            "content": [
                {
                    "func": "grids_storage"
                }
            ]
        }