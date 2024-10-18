

/* ---------------------- PROJECTS ------------------------------------ */

/* Show the Application Form, either for a new booking or an existing one */
function showProjectForm(project_id, modalId) {
    if (!modalId)
        modalId = 'project-modal';
    show_modal_from_ajax(modalId, get_ajax_content("project_form",
                                                    {project_id: project_id}));
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

    var confidentialCheckbox = document.getElementById("project_confidential-checkbox");

    var project = {
        id: parseInt($('#project-id').val()),
        status: $('#project-status').val(),
        user_id: user_id,
        user_can_edit: user_can_edit,
        is_confidential: confidentialCheckbox.checked,
        collaborators_ids: $('#project-collaborators-select').selectpicker('val'),
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


function userAjaxDone(jsonResponse) {
    ajax_request_done(jsonResponse, 'user');
}

/* Show the User Form */
function showUser(userId) {
    var content = get_ajax_content("user_form", {user_id: userId});
    show_modal_from_ajax('user-modal', content);
}  // function showUser

function showUserProfile(userId) {
    var content = get_ajax_content("user_profile", {user_id: userId});
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
        pi_id: $('#user-pi-select').selectpicker('val')
    };

    send_ajax_json(Api.urls.user.register, user, handleUserAjaxDone);
    //alert(JSON.stringify(user, null, 4));
}  // function onRegisterUser

function deleteUser(user_id) {
    confirm("Delete Project",
            "Do you want to DELETE User with id=" + user_id + "?",
             "Cancel", "Delete", function () {
            send_ajax_json(Api.urls.user.delete,
                           {id: user_id}, userAjaxDone);
        });
} // function deleteProject


/*-------------------------- Sessions ------------------------------------ */
function showSession(session_id){
    var content = get_ajax_content("session_form", {session_id: session_id});
    show_modal_from_ajax("session-modal", content);
} // function showSession

function sessionAjaxDone(jsonResponse) {
    ajax_request_done(jsonResponse, 'session');
}

function deleteSession(session_id) {
    confirm("Delete Session",
            "Do you want to DELETE Session with id=" + session_id + "?",
             "Cancel", "Delete", function () {
            send_ajax_json(Api.urls.session.delete,
                           {id: session_id}, sessionAjaxDone);
        });
} // function deleteProject

function updateSession(session) {
    send_ajax_json(Api.urls.session.update, session, sessionAjaxDone)
}

function showCreateSession(bookingId, create_session_func) {
        var content = get_ajax_content(create_session_func, {booking_id: bookingId});
        show_modal_from_ajax("session-modal", content);
} // function showCreateSession

/* Show the Resource Form, either for a new booking or an existing one */
function createSession(bookingId, totalSessions, create_session_func) {
    console.log("createSession, func: " + create_session_func);

    if (totalSessions === 0)
        showCreateSession(bookingId, create_session_func);
    else
        confirm("Create Session", "There are already created sessions, " +
                "Do you want to create another one?", 'No', 'Yes', function () {
                showCreateSession(bookingId, create_session_func);
        });

}  // function showResource


// ---------------------- Run Form related Functions ---------------------------
 /* Create a Radiobutton with its label */
 function form_addRadio(parent, id, name, value, labelText, checked) {
     var label = document.createElement('label');
     label.className = "custom-control custom-radio custom-control-inline";
     //label.for = id;

     var input = document.createElement('input');
     input.type = 'radio';
     input.className = 'custom-control-input scn-radio';
     input.id = id;
     input.name = name;
     input.checked = checked;
     input.dataset.key = name;
     input.value = value;
     label.appendChild(input);

     var span = document.createElement('span');
     span.className = "custom-control-label mt-1";
     span.textContent = labelText;
     label.appendChild(span);

     parent.appendChild(label);
     return label;
 }

 /* Create row with new elements under this parent */
 function form_addRows(parent, params, values){

     function get_param_value(param){
         return (param.name in values) ? values[param.name] : '';
     }
     function create_label(col, labelText){
        var label = document.createElement('label');
        label.className = col + ' col-form-label text-sm-right text-wrap';
        label.textContent = labelText;
        return label;
     }
    function create_input(col, key, value) {
        var div = document.createElement('div');
        div.className = col;
        var input = document.createElement('input');
        input.className = 'form-control form-control-sm';
        input.value = value;
        input.dataset.key = key;
        div.appendChild(input)
        return div;
    }


    for (var i = 0;  i < params.length; i++) {
        var param = params[i];
        var base_id = param.name;
        var param_value = get_param_value(param);

        var row = document.createElement('div');
        row.className = 'row form-group';
        parent.appendChild(row);

        if (!nonEmpty(base_id)){
            // Empty param is a separator
            row.className += ' mt-1 mb-1';
        }
        else if (param.paramClass === "Group") {  // Groups are special and don't have labels
                var div = document.createElement('div');
                div.className = "formgroup col-12"
                div.innerHTML = "<h1><label class='col-1 text-sm-right mr-3'>" + param.label + "</label></h1></br>"
                row.appendChild(div);
                form_addRows(div, param.params, values);

                // <fieldset>
                //     <legend>Legend</legend> Fieldset
                // </fieldset>
                //
                // <div className="fieldset">
                //     <h1><span>Legend</span></h1> Fieldset
                // </div>
        }
        else if (param.label) {

            if (param.expert == 1) {
                row.style.backgroundColor = "#E6E6E6";
                row.className += ' scn-expert-param';
                row.style.display = display_expert;
            }

            row.id = base_id + '-row';
            var label = create_label('col-4', param.label);
            label.dataset.toggle = "tooltip";
            label.dataset.placement = "top";
            label.title = param.help;
            row.appendChild(label);

            if (param.paramClass === "LabelParam"){
                label.classList.replace('col-4', 'col-12');
            }
            else if (param.paramClass === "Line") {
                var div = document.createElement('div');
                div.className = 'row col-8 form-group';
                //div.style.backgroundColor = 'red';
                for (var j = 0;  j < param.params.length; j++) {
                    let p = param.params[j];
                    div.appendChild(create_label('ml-0 pl-0 col-2', p.label))
                    div.appendChild(create_input('col-2', p.name, get_param_value(p)));
                }
                row.appendChild(div);
            }
            else if (param.paramClass === "EnumParam") {
                var div = document.createElement('div');
                div.className = 'col-8 form-group';

                if (param.display == 1) { // Combo
                    var select = document.createElement('select');
                    select.dataset.key = param.name;
                    select.className = 'form-control form-control-sm';
                    select.style.backgroundColor = "#fff";
                    select.style.color = "black";

                    for (var j = 0; j < param.choices.length; j++) {
                        var opt = document.createElement('option');
                        opt.textContent = param.choices[j];
                        opt.selected = param_value == j; // Let JS compare string integer values with indexes
                        opt.value = j;
                        select.appendChild(opt);
                    }
                    div.appendChild(select);
                }
                row.appendChild(div);
            }
            else if ('valueClass' in param) {

                if (param.paramClass === "BooleanParam") {
                    var div = document.createElement('div');
                    div.className = 'row col-8 ml-1';
                    form_addRadio(div, base_id + '-yes', base_id, true, 'Yes', param_value === '1');
                    form_addRadio(div, base_id + '-no', base_id, false, 'No', param_value === '0');
                    row.appendChild(div);
                }
                else {
                    row.appendChild(create_input('col-8', param.name, param_value ));
                }
            }
        }
        else {  // Empty space separator

        }

    }
 } // function form_addRows


/** Create a dynamic form based on teh JSON definition of sections and params
 * */
 function form_create(form, values, elementId, protocol) {
     var formElement = document.getElementById(elementId);
     formElement.innerHTML = '';
     //formElement.style.backgroundColor = 'red';

     var card = document.createElement('div');
     card.className = "card card-primary card-tabs";
     card.style.borderWidth = "0px";

     // Card header
     var cardh = document.createElement('div');
     cardh.className = "card-header p-0 pt-1";
     cardh.style.borderWidth = "0px";
     var ul = document.createElement('ul');
     ul.id = "dynamic-tab";
     ul.role = "tablist";
     ul.className = "nav nav-tabs";
     cardh.appendChild(ul);
     card.appendChild(cardh);

     // Card body
     var cardb = document.createElement('div');
     cardb.className = "card-body p-0";
     cardb.style.borderWidth = "0px";
     var content = document.createElement('div');
     content.id = "dynamic-tabContent";
     content.className = "tab-content overflow-auto";
     content.style.maxHeight = "980px";
     cardb.appendChild(content);
     card.appendChild(cardb);

     formElement.appendChild(card);
     var counter = 0;

     for (var i = 0;  i < form.sections.length; i++) {
         // Header elements
         var section = form.sections[i];

         var section_label = replaceAll(section.label, ' ', '_');
         section_label = replaceAll(section_label, '.', '_');
         section_label = replaceAll(section_label, '/', '_');

         // FIXME: this is Scipion-specific
         if (section.label === "General" || section.label === "Parallelization")
             continue;

         counter += 1;
         var base_id = ul.id + "-" + section_label;
         var li = document.createElement('li');
         li.className = "nav-item";
         var a = document.createElement('a');
         a.className = "nav-link";
         a.setAttribute('aria-selected', counter == 1);
         a.id = base_id + '-tab';
         a.setAttribute("data-toggle", "pill");
         a.setAttribute("aria-controls", base_id);
         a.role = "tab";
         a.href = "#" + base_id;
         a.textContent = section.label;
         li.appendChild(a);

         ul.appendChild(li);

         // Content elements
         var div = document.createElement('div');
         div.id = base_id;
         div.className = "tab-pane fade ";
         if (counter == 1) {
             a.className += " active";
             div.className += "show active";
         }
         div.role = "tabpanel";
         div.setAttribute('aria-labelledby', a.id);
         content.appendChild(div);

         form_addRows(div, section.params, values);
     }

    //  function update() {
    //      updateFormVisibility(form, elementId, protocol);
    //  }
    //
    // $(formElement).on('change', '.scn-radio', update);
    //
    //  update();

     return card;
 } // function createForm

