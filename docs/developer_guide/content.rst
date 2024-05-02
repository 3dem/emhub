
Customizing EMhub
=================

This section explains how one can modify EMHub pages or add new ones, and
how to extend the REST API.
In general, EMHub pages require corresponding "content" functions that prepare the data
to be presentedi, so these may need to be created or modified in support. Pages are implemented
as Jinja templates, so it will be necessary to learn at least `some of the basics
<https://jinja.palletsprojects.com/en/3.1.x/templates/>`_.

In this section, we will use the customization of EMhub for the Single Molecule Imaging
Center (EMhub-SMIC) at St. Jude as an example.


Changing Existing Templates
---------------------------

Builtin templates in EMhub are stored in the ``emhub/templates`` directory.
To modify existing templates, the recommended procedure is to create an ``extra/templates``
folder inside the ``$EMHUB_INSTANCE`` directory and put the modified template file there.
Some existing templates that are likely to need redefining are:

.. csv-table::
   :widths: 10, 50

   "**TEMPLATE**", "**DESCRIPTION**"
   "``main.html``", "This is the application's main template. By changing this template, one can use a new icon or define a different header."
   "``main_left_sidebar.html``", "Left panel with sections and links to other pages."
   "``main_topbar.html``", "Logo and header definition."
   "``main_left_sidebar.html``", "Left panel with sections and links to other pages. "
   "``dashboard_right.html``", "Right content of the Dashboard page."

Templates require underlying ``content`` functions that provide the data source for the templates. New templates require the definition
of new content functions in the file ``$EMHUB_INSTANCE/extra/data_content.py``. It is also possible to extend the existing REST API by defining
new endpoints in ``$EMHUB_INSTANCE/extra/api.py``.

Read more about :any:`Customizing EMhub`.

For example, if we want to use a different logo, we should make a copy of the
``main_topbar.html`` template and place it under ``$EMHUB_INSTANCE/extra/templates``.
In that copy, we can replace the default logo URL with a new one. The following block shows
the differences between the default file and the modified one.

.. code-block:: diff

    <             <img src="{{ url_for('static', filename='images/emhub-text-default.png') }}" height="45px" style="margin-left: 15px;">
    ---
    >             <img src="{{ url_for('static', filename='images/emhub-stjude.png') }}" height="45px" style="margin-left: 15px;">
    >             <h3 class="mt-3">Single-Molecule Imaging Center</h3>


Any template in the ``$EMHUB_INSTANCE/extra/templates`` folder will take precedence over the ones in ``emhub/templates``.
One needs to be careful not use an existing filename that is not intended to be replaced.

Adding New Templates
--------------------

New templates can be added into the ``$EMHUB_INSTANCE/extra/templates`` folder.
Usually, new templates should define an associated "content" function with the same name,
which will provide the data required for rendering the template.

For example, for the EMhub-SMIC, we added a ``Plates`` page. For that, we created a new
file: ``$EMHUB_INSTANCE/extra/templates/plates.html``.

This template is composed of two main parts: the HTML template and some JavaScript code.
The following HTML part defines a ``<div>`` with the "content" that will be rendered inside
the main layout. It uses the ``current_user`` variable to render different content depending
on the user's permissions. In this case, the ``Add Plate`` button link is only rendered if
the logged-in user is a manager.


.. tab:: HTML

    .. code-block:: html

        <div class="container-fluid dashboard-content">
            <!-- Header -->
            {% set title = "Plates" %}
            {% include 'include_header.html' %}
            {% set is_manager = current_user.is_manager %}
            {% set is_admin = current_user.is_admin %}

            <!-- table row -->
            <div class="row">

                {% if is_manager %}
                <div class="col-12 mb-3">
                    <a href="javascript:addPlate()" class="btn btn-primary"><i class="fas fa-plus-circle"></i> Add Plate</a>
                </div>
                {% endif %}

                <div class="col-1">
                    <div class="row">
                        <div class="col-12">
                            <div class="card">
                                <div class="card-header">
                                    <h5 class="mb-0">Batches</h5>
                                </div>
                                <div class="card-body">
                                    <div class="row">
                                        {% for batch in batches %}
                                            <div class="col-12 mb-2">
                                                <a href="javascript:loadBatch({{ batch }})" class="badge badge-dark mr-1">B{{ batch }}</a>
                                            </div>
                                        {% endfor %}
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

                <div id="batch-content" class="col-11 p-0 m-0">

                   {% include "batch_content.html" %}

                </div>
            </div>
            <!-- end table row -->
        </div>

.. tab:: Javascript

    .. code-block:: javascript

        function loadBatch(batch) {
            var ajaxContent = get_ajax_content('batch_content', {batch_id: batch});
            ajaxContent.done(function(html) {
                $('#batch-content').html(html);
            });
            ajaxContent.fail(ajax_request_failed);
        }

        function addPlate(plate_id) {
            var params = {
                plate_id: plate_id
            };
            show_modal_from_ajax('plate-modal',
                                 get_ajax_content("plate_form", params));
        }  // function showResource

        function onPlateOkButtonClick() {
            var values = getFormAsJson('dynamic-form');
            // Send json data to create the puck
            var create_plate_url = "{{ url_for('api.create_plate') }}";

            send_ajax_json(create_plate_url, values,
                function (jsonResponse) {
                    if ('error' in jsonResponse)
                        showError(jsonResponse.error);
                    else {
                        // Reload with current batch selected
                        const base_url = "{{ url_for_content('plates') | safe }}";
                        window.location.href = base_url + "&batch_id=" + values.batch;
                    }
                }, // on success reload page
                function (jqXHR, textStatus) {   // on fail show error message
                    showError("Add Plate Request failed: " + textStatus);
                });
        }


.. tab:: View

    .. image:: https://github.com/3dem/emhub/wiki/images/202306/plates.jpg
        :width: 100%

The template also uses the ``batches`` variable that is a list of batches. This data should be provided by the
corresponding "content" function. For adding more content, one needs to define the ``$EMHUB_INSTANCE/extra/data_content.py``
file with a ``register_content`` function. In our example it looks like the following:


.. code-block:: python
    :caption: $EMHUB_INSTANCE/extra/data_content.py

    def register_content(dc):

        @dc.content
        def plates(**kwargs):
            plates = dc.app.dm.get_pucks()
            batches = []

            for p in plates:
                batch = p.dewar
                plate = p.cane
                if batch not in batches:
                    batches.append(batch)

            batches.reverse()  # more recent first
            data = {'batches': batches}
            if batches:
                batch_id = kwargs.get('batch_id', batches[0])
                data.update(batch_content(batch_id=batch_id))

            return data



The Javascript part of the ``plates.html`` template shows how to use client functions to
interact with the server. Following is a description of the three functions there:

.. csv-table::
   :widths: 10, 50

   "**FUNCTION**", "**DESCRIPTION**"
   "``loadBatch(batch)``", "Request the content of the ``batch_content.html`` and load it as the content of the ``batch-content`` div."
   "``addPlate()``", "Request the content of ``plate_form`` and display a dialog to add a new plate."
   "``onPlateOkButtonClick()``", "If the 'OK' button is clicked to create a new plate, then get the input parameters for the plate and make a request to create a new one in the database."


Extending the REST API
----------------------

In the JavaScript code of this example, the function ``onPlateOkButtonClick`` sends a
request to the REST API endpoint ``api.create_plate``. This was not part of the built-in
EMhub API but was an extension. To achieve this, one can provide a ``$EMHUB_INSTANCE/extra/api.py``
file that will take the API Flask Blueprint object and define a function ``extend_api`` to define
more endpoints. In this case, it looks like this:


.. code-block:: python
    :caption: $EMHUB_INSTANCE/extra/api.py

    def extend_api(api_bp):

        import flask_login
        from flask import current_app as app

        from emhub.blueprints.api import handle_puck

        @api_bp.route('/create_plate', methods=['POST'])
        @flask_login.login_required
        def create_plate():
            def _create_plate(**args):
                """ Translate from Plate to Puck. """
                try:
                    batch = int(args['batch'])
                    plate = int(args['plate'])
                    code = "B%03d_%02d" % (batch, plate)
                except:
                    raise Exception("Provide valid 'batch' and 'plate' numbers.")

                print("args: ", args)

                newArgs = {
                    'code': code,
                    'label': code,
                    'dewar': batch,
                    'cane': plate,
                    'extra': {'comments': args.get('comments', '')},
                    'position': 0
                }
                return app.dm.create_puck(**newArgs)

            return handle_puck(_create_plate)


Summary
-------

.. important::

    Regarding templates and their corresponding "content", one needs to keep in mind:

    * Templates in ``$EMHUB_INSTANCE/extra/templates/`` will take precedence over built-in ones.
    * Every template must have a corresponding "content" function with the **same name**.
    * New content functions can be defined in: ``$EMHUB_INSTANCE/extra/data_content.py``
    * A content function must return a dictionary with keys for each variable used in the template.
