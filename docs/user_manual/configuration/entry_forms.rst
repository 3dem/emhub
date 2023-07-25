
===========
Entry Forms
===========

Entry forms define entries that can be used in projects. Each entry needs a parameters definition in JSON format
from which the GUI will be generated and the data will be stored.


Parameters Definition
=====================

Example Entry Forms
===================

The following sections show some example entry forms that illustrate the usage of the parameters definition
described previously.

Screening Entry Form
--------------------

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

