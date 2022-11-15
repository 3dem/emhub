

function addPis() {
    var body = document.getElementById('application-pi-list-body');

    for (var v of $('#application-pi-list-select').selectpicker('val')) {
        var pi = pi_dict[parseInt(v)];
        if (!pi.in_app){
            pi.status = "to add";
            pi.in_app = true;
            addPiRow(body, pi);
        }
    }
    $('#application-pi-list-select').selectpicker('val', "");
}

function removePi(pi_id){
    var pi = pi_dict[pi_id];
    pi.status = "to remove";
    setPiRowHtml(getPiRow(pi), pi);
}

function undoPi(pi_id){
    var pi = pi_dict[pi_id];
    var row = getPiRow(pi);

    if (pi.status == "to remove") {
        pi.status = "";
        setPiRowHtml(row, pi);
    }
    else if (pi.status == "to add") {
        pi.status = "";
        pi.in_app = false;
        getPiRow(pi).remove();
    }
}

function setPiRowHtml(row, pi){
    var html = '<td>' + pi.name + '</td><td>' + pi.email + '</td>';
    var statusHtml = '';
    var actionsHtml = '';
    var body = document.getElementById('application-pi-list-body');

    if (pi.status == "representative")
        statusHtml = "representative";
    else if (pi.status == "to add") {
        statusHtml = "to add";
        actionsHtml = '<button class="btn btn-sm btn-outline-light" onclick="javascript:undoPi(' + pi.id + ')"><i class="fas fa-history"></i></button>';
    }
    else if (pi.status == "to remove") {
        statusHtml = "to remove";
        actionsHtml = '<button class="btn btn-sm btn-outline-light" onclick="javascript:undoPi(' + pi.id + ')"><i class="fas fa-history"></i></button>';
    }
    else {
        if (body.dataset.editable === 'true')
            actionsHtml = '<button class="btn btn-sm btn-outline-light" onclick="javascript:removePi(' + pi.id + ')"><i class="far fa-trash-alt"></i></button>';
    }

    html += '<td>' + statusHtml + '</td>';
    html += '<td>' + actionsHtml + '</td>';

    row.innerHTML = html;

}

function getPiRow(pi) {
    return document.getElementById('application-pi-list-tr-' + pi.id);
}

function addPiRow(body, pi) {
    var row = document.createElement('tr');
    row.id = "application-pi-list-tr-" + pi.id;
    setPiRowHtml(row, pi);
    if (pi.status == "representative")
        body.insertBefore(row, body.firstChild);
    else
        body.appendChild(row);
}

function createPiRows() {
    var body = document.getElementById('application-pi-list-body');
    for (var pi of pi_list){
        if (pi.in_app)
            addPiRow(body, pi);
    }
}

function createApplication(templateId) {
    showApplication(null, templateId);
}

/* Show the Application Form, either for a new booking or an existing one */
function showApplication(applicationId, templateId) {
    var params = (applicationId != null) ? {application_id: applicationId} : {template_id: templateId};

    ajaxContent = get_ajax_content("application_form", params);

    ajaxContent.done(function(html) {
        $("#application-modal").html(html);
        application_config.modal_status = "new";
        // Show the form after setting html content
        $('#application-modal').modal('show');
    });

    ajaxContent.fail(function(jqXHR, textStatus) {
        alert( "Request failed: " + textStatus );
    });

}  // function showApplication

function deleteApplication(application_id, application_code) {
    confirm("Delete Application",
            "Do you want to DELETE Application '" + application_code + "' ?",
             "Cancel", "Delete", function () {
            send_ajax_json(Api.urls.application.delete,
                     {id: application_id}, handleApplicationAjaxDone);
        });
} // function deleteEntry

/** Helper functions to handle Application AJAX response or failure */
function handleApplicationAjaxDone(jsonResponse) {
    var error = null;

    if ('application' in jsonResponse || 'OK' in jsonResponse) {
    }
    else if ('error' in jsonResponse) {
        error = jsonResponse.error;
    }
    else {
        error = 'Unexpected response from server.'
    }

    if (error) {
        showError(error);
    }
    else {
        application_config.modal_status = "update";

        $('#application-modal').on('hidden.bs.modal', function () {

            if (application_config.on_update != null && application_config.modal_status == "update") {
                application_config.on_update();
                application_config.modal_status = "done";
            }
        });

        $('#application-modal').modal('hide');
    }
}

/** This function will be called when the OK button in the Application form
* is clicked. It can be either Create or Update action.
*/
function onApplicationOkButtonClick() {
    // Update application values
    var application_id = parseInt($('#application-id').val());

    var access = [];
    for (var user_id of $('#application-user-access').selectpicker('val'))
        access.push({user_id: parseInt(user_id)});

    var application = {
        status: $('#application-status-select').selectpicker('val'),
        title: $('#application-title').val(),
        alias: $('#application-alias').val(),
        description: $('#application-description').val(),
        resource_allocation: {
            quota: {
                krios: parseInt($('#quota-krios').val()),
                talos: parseInt($('#quota-talos').val())
            },
            noslot: []  // FIXME: Create the proper list
        },
        extra: {
            confidential: $('#application-confidential').prop('checked'),
            access: access
        },
        pi_to_add: [],
        pi_to_remove: []
    };

    if ($('#application-representative-select').length)
        application.extra.representative_id = parseInt($('#application-representative-select').selectpicker('val'));

    $( ".noslot" ).each( function( i, el ) {
        var elem = $( el );
        if (elem.prop("checked"))
            application.resource_allocation.noslot.push(parseInt(elem.val()));
    });

    // Update list of PI users to add or remove to the Application
    for (var pi of pi_list)
        if (pi.status == "to add")
            application.pi_to_add.push(pi.id);
        else if (pi.status == "to remove")
            application.pi_to_remove.push(pi.id);

    if (!isNaN(application_id)) {
        application.id = application_id;
    }
    else {
        application.code = $('#application-code').val();
        application.template_id = $('#application-template_id').val();
    }

    var ajaxContent = $.ajax({
        url: Api.get('application', application_id),
        type: "POST",
        contentType: 'application/json; charset=utf-8',
        data: JSON.stringify({attrs: application}),
        dataType: "json"
    });

    ajaxContent.done(handleApplicationAjaxDone);
    ajaxContent.fail(function(jqXHR, textStatus) {
        showError( "Request failed: " + textStatus );
    });
}  // function onApplicationOkButtonClick


function createTemplate() {
    showTemplate({id: null, status: 'preparation'});
}

/* Show the Template Form, either for a new booking or an existing one */
function showTemplate(template) {
    if (template == null) {
        showError("Invalid Template, received null");
        return
    }

    // Setup fields with template values
    $('#template-id').val(template.id);
    $('#template-title').val(template.title);
    $('#template-description').val(template.description);
    $('#template-code_prefix').val(template.code_prefix);

    // Set possible status options depending on the current status
    $('#template-status-select').selectpicker('val', template.status);
    $('#template-status-select').find("[value='closed']").prop('disabled', false);
    $('#template-status-select').find("[value='preparation']").prop('disabled', false);

    if (template.status == 'preparation')
        $('#template-status-select').find("[value='closed']").prop('disabled', true);
    else
        $('#template-status-select').find("[value='preparation']").prop('disabled', true);

    $('#template-status-select').selectpicker('refresh');

    // Show the form
    $('#template-modal').modal('show');
}  // function showTemplate


/** Helper functions to handle Template AJAX response or failure */
function templateAjaxDone(jsonResponse) {
    var error = null;

    if ('template' in jsonResponse) {
    }
    else if ('error' in jsonResponse) {
        error = jsonResponse.error;
    }
    else {
        error = 'Unexpected response from server.'
    }

    if (error)
        showError(error);
    else {
        $('#template-modal').on('hidden.bs.modal', function () {
            var params = {template_selected_status: 'active'};
            load_main_content("applications", params);
        });
        $('#template-modal').modal('hide');
    }
}

/** This function will be called when the OK button in the Template form
 * is clicked. It can be either Create or Update action.
 */
function onTemplateOkButtonClick() {
    // Update template values
    var template_id = $('#template-id').val();

    var template = {
        title : $('#template-title').val(),
        description : $('#template-description').val(),
        status : $('#template-status-select').selectpicker('val'),
        extra: {code_prefix : $('#template-code_prefix').val()}
    };

    if (template_id)
        template.id = parseInt(template_id);

    var ajaxContent = $.ajax({
        url: Api.get('template', template.id),
        type: "POST",
        contentType: 'application/json; charset=utf-8',
        data: JSON.stringify({attrs: template}),
        dataType: "json"
    });

    ajaxContent.done(templateAjaxDone);
    ajaxContent.fail(function(jqXHR, textStatus) {
        showError( "Request failed: " + textStatus );
    });
}  // function onTemplateOkButtonClick


function deleteTemplate(template_id, template_title) {
    confirm("Delete Template",
            "Do you want to DELETE Template '" + template_title + "' ?",
             "Cancel", "Delete", function () {
            send_ajax_json(Api.urls.template.delete,
                     {id: template_id}, templateAjaxDone);
        });
} // function deleteEntry