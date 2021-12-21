

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

    if (pi.status == "creator")
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
    if (pi.status == "creator")
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

/* Show the Application Form, either for a new booking or an existing one */
function showApplication(applicationId) {

    ajaxContent = get_ajax_content("application_form", {application_id: applicationId});

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

if (error)
    showError(error);
else {
    application_config.modal_status = "update";

    $('#application-modal').on('hidden.bs.modal', function () {

        if (application_config.on_update != null && application_config.modal_status == "update") {
            application_config.on_update();
            application_config.modal_status = "done";
        }
    });

    // $('#application-modal').on('hidden.bs.modal', function () {
    // var params = {};
    // alert("loading main content");
    // load_main_content("applications", params);
    // });

    $('#application-modal').modal('hide');
}
}

/** This function will be called when the OK button in the Application form
* is clicked. It can be either Create or Update action.
*/
function onApplicationOkButtonClick() {
// Update template values
var application = {
    id: parseInt($('#application-id').val()),
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
    pi_to_add: [],
    pi_to_remove: []
};

$( ".noslot" ).each( function( i, el ) {
    var elem = $( el );
    if (elem.prop("checked"))
        application.resource_allocation.noslot.push(parseInt(elem.val()));
    //alert("checked: " + elem.prop('checked') + " value: " + elem.val());
});

// Update list of PI users to add or remove to the Application
for (var pi of pi_list)
    if (pi.status == "to add")
        application.pi_to_add.push(pi.id);
    else if (pi.status == "to remove")
        application.pi_to_remove.push(pi.id);

var endpoint = null;

if (application.id != null) {
    endpoint = api_urls.update_application;
}
else {
    endpoint = api_urls.create_application;
}

var ajaxContent = $.ajax({
    url: endpoint,
    type: "POST",
    contentType: 'application/json; charset=utf-8',
    data: JSON.stringify({attrs: application}),
    dataType: "json"
});

ajaxContent.done(handleApplicationAjaxDone);
ajaxContent.fail(function(jqXHR, textStatus) {
    showError( "Request failed: " + textStatus );
});
}  // function onTemplateOkButtonClick
