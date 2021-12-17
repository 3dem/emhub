

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
            send_ajax_json(api_urls.delete_project,
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

    var url = project.id != null && !Number.isNaN(project.id) ?
              api_urls.update_project : api_urls.create_project;

    send_ajax_json(url, project, projectAjaxDone);
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
            send_ajax_json("{{ url_for('api.delete_entry') }}",
                     {id: entry_id}, entryAjaxDone);
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

    var url = entry.id != null && !Number.isNaN(entry.id) ?
              api_urls.update_entry : api_urls.create_entry;
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
        get_ajax_content("entry_report", {entry_id: entry_id})
    );
}  // function showEntryReport

