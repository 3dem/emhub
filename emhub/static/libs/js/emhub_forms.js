

/* ---------------------- PROJECTS ------------------------------------ */

/* Show the Application Form, either for a new booking or an existing one */
function showProjectForm(project_id, modalId) {
    if (!modalId)
        modalId = 'project-modal';
    show_modal_from_ajax(modalId, get_ajax_content("project_form", {project_id: project_id}));
}  // function showProjectForm

function deleteProject(project_id) {
    confirm("Delete Project",
            "Do you want to DELETE Project with id=" + project_id + "?",
             "Cancel", "Delete", function () {
            send_ajax_json(Api.urls.project.delete,
                           {id: project_id}, projectAjaxDone);
        });
} // function deleteProject

    /** This function will be called when the OK button in the Application form
 * is clicked. It can be either Create or Update action.
 */
function onProjectOkButtonClick() {
    // If this variable exists, it means that the creation user is not manager
    var user_id = null;
    var user_can_edit = null;

    var userIdElem = document.getElementById("project-user-id");
    if (userIdElem) {
         user_id = userIdElem.value;
         user_can_edit = true;
    }
    else {
        user_id = $('#project-user-select').selectpicker('val');
        var checkBox = document.getElementById("user_can_edit-checkbox");
        user_can_edit = checkBox.checked;
    }

    var project = {
        id: parseInt($('#project-id').val()),
        status: $('#project-status').val(),
        user_id: user_id,
        user_can_edit: user_can_edit,
        title: $('#project-title').val(),
        description: $('#project-description').val(),
        date: dateIsoFromValue('#project-date', '#hour_id'),
    };

    send_ajax_json(Api.get('project', project.id), project, projectAjaxDone);
}  // function onTemplateOkButtonClick


/** Helper functions to handle Template AJAX response or failure */
function projectAjaxDone(jsonResponse) {
    ajax_request_done(jsonResponse, 'project');
}

/* --------------------- ENTRIES ------------------------------ */
function showEntryForm(entry_id, project_id, entry_type, copy_entry) {
    show_modal_from_ajax('entry-modal',
                         get_ajax_content("entry_form",
                                   {entry_id: entry_id,
                                    entry_type: entry_type,
                                    entry_project_id: project_id,
                                    copy_entry: copy_entry
                                   }));
}  // function showEntryForm

function deleteEntry(entry_id, entry_title) {
    confirm("Delete Entry",
            "Do you want to DELETE Entry '" + entry_title + "' ?",
             "Cancel", "Delete", function () {
            send_ajax_json(Api.urls.entry.delete, {id: entry_id}, entryAjaxDone);
        });
} // function deleteEntry

    /** This function will be called when the OK button in the Application form
 * is clicked. It can be either Create or Update action.
 */
function onEntryOkButtonClick() {
    // Update template values
    var entry = {
        id: parseInt($('#entry-id').val()),
        type: $('#entry-type').val(),
        project_id: $('#entry-project-id').val(),
        title: $('#entry-title').val(),
        description: $('#entry-description').val(),
        date: dateIsoFromValue('#entry-date', '#hour_id'),
        extra: {data: getFormAsJson('dynamic-form')}
    };

    var url = Api.get('entry', entry.id);
    var formData = new FormData();
    formData.append('attrs', JSON.stringify(entry));

     var files = getFilesFromForm('dynamic-form');
     Object.keys(files).forEach(function(key) {
        formData.append(key, files[key]);
     });

     send_ajax_form(url, formData, entryAjaxDone);
}  // function onTemplateOkButtonClick

/** Helper functions to handle Template AJAX response or failure */
function entryAjaxDone(jsonResponse) {
    ajax_request_done(jsonResponse, 'entry');
}

function showEntryReport(entry_id) {
    show_modal_from_ajax('entry-modal',
        get_ajax_content("entry_report", {entry_id: entry_id}));
}  // function showEntryReport


/* --------------------- RESOURCES ------------------------------ */

/* Show the Resource Form, either for a new booking or an existing one */
function showResource(resourceId, copyResource) {
    var params = {
        resource_id: resourceId,
        copy_resource: Boolean(copyResource)
    };
    show_modal_from_ajax('resource-modal',
                         get_ajax_content("resource_form", params));
}  // function showResource

/** This function will be called when the OK button in the Application form
 * is clicked. It can be either Create or Update action.
 */
function onResourceOkButtonClick() {
    // Update template values
    var resource = getFormAsJson('resource-form', true);
    resource.id = parseInt($('#resource-id').val());

    var url = Api.get('resource', resource.id)
    var formData = new FormData();
    formData.append('attrs', JSON.stringify(resource));

     var files = getFilesFromForm('resource-form');
     Object.keys(files).forEach(function(key) {
        formData.append(key, files[key]);
     });

     send_ajax_form(url, formData, resourceAjaxDone);
}  // function onTemplateOkButtonClick

function resourceAjaxDone(jsonResponse) {
    ajax_request_done(jsonResponse, 'resource');
}

function deleteResource(resource_id) {
    confirm("Delete Project",
            "Do you want to DELETE Resource with id=" + resource_id + "?",
             "Cancel", "Delete", function () {
            send_ajax_json(Api.urls.resource.delete,
                           {id: resource_id}, resourceAjaxDone);
        });
} // function deleteProject


/* --------------------- USERS ------------------------------ */
/** Helper functions to handle User AJAX response or failure */
function handleUserAjaxDone(jsonResponse) {
    var error = null;

    if ('user' in jsonResponse) {
    }
    else if ('error' in jsonResponse) {
        error = jsonResponse.error;
    }
    else {
        error = 'Unexpected response from server.'
    }

    if (error)
        showMessage('ERROR', error);
    else {
        showMessage('SUCCESS', 'User registered successfully.');
        $('#user-modal').modal('hide');
    }
}


function showResource(resourceId, copyResource) {
    var params = {
        resource_id: resourceId,
        copy_resource: Boolean(copyResource)
    };
    show_modal_from_ajax('resource-modal',
                         get_ajax_content("resource_form", params));
}  // function showResource


/* Show the User Form */
function showUser(userId) {
    var content = get_ajax_content("user_form", {user_id: userId});
    show_modal_from_ajax('user-modal', content);
}  // function showUser

/* Show the User Form */
function showRegisterUser() {
    var content = get_ajax_content("register_user_form", {});
    show_modal_from_ajax('user-modal', content);
}  // function showUser

function onRegisterUser() {
    var roles = [];
    $(".user-role:checked").each(function(){
        roles.push(this.name.replace('role-', ''));
    });
    var user = {
        email: $('#user-email').val(),
        name: $('#user-name').val(),
        roles: roles,
        pi_id: null
    };

    send_ajax_json(Api.urls.user.register, user, handleUserAjaxDone);
    //alert(JSON.stringify(user, null, 4));
}  // function onRegisterUser