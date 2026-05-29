

/* ---------------------- PROJECTS ------------------------------------ */

/* Show the Project Form */
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
function showEntryForm(entry_id, project_id, entry_type, copy_entry, read_only, data) {
    var params = {entry_id: entry_id,
                  entry_type: entry_type,
                  entry_project_id: project_id,
                  copy_entry: copy_entry,
                  read_only: read_only || 0
                 };
    if (data)
        params.data = JSON.stringify(data);

    show_modal_from_ajax('entry-modal', get_ajax_content("entry_form", params));
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
    if (window.inventoryHistoryContext) {
        inventoryHistoryEntryAjaxDone(jsonResponse);
        return;
    }
    if (typeof updateEntries === 'function' && document.getElementById('logbooks-entries-content')) {
        logbookEntryAjaxDone(jsonResponse);
        return;
    }
    ajax_request_done(jsonResponse, 'entry');
}

function logbookEntryAjaxDone(jsonResponse) {
    var error = null;

    if ('entry' in jsonResponse) {
    } else if ('error' in jsonResponse) {
        error = jsonResponse.error;
    } else {
        error = 'Unexpected response from server.';
    }

    if (error) {
        showError(error);
    } else {
        $('#entry-modal').modal('hide');
        updateEntries();
    }
}

function inventoryHistoryEntryAjaxDone(jsonResponse) {
    var error = null;

    if ('entry' in jsonResponse) {
    } else if ('error' in jsonResponse) {
        error = jsonResponse.error;
    } else {
        error = 'Unexpected response from server.';
    }

    if (error) {
        showError(error);
    } else {
        $('#entry-modal').modal('hide');
        var params = {item_id: window.inventoryHistoryContext.item_id};
        if (window.inventoryHistoryContext.inventory_id) {
            params.inventory = window.inventoryHistoryContext.inventory_id;
        }
        load_main_content('inventory_item_history', params);
    }
}

function showEntryReport(entry_id) {
    show_modal_from_ajax('entry-modal',
        get_ajax_content("entry_report", {entry_id: entry_id}));
}  // function showEntryReport

function showEntryHistory(item_id, inventory_id) {
    window.inventoryHistoryContext = {item_id: item_id, inventory_id: inventory_id};
    load_main_content('inventory_item_history', {item_id: item_id});
}  // function showEntryHistory

function editInventoryHistoryEntry(entry_id, project_id, item_id) {
    window.inventoryHistoryContext = {item_id: item_id, inventory_id: project_id};
    showEntryForm(entry_id, project_id);
}  // function editInventoryHistoryEntry


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
    if (totalSessions === 0)
        showCreateSession(bookingId, create_session_func);
    else
        confirm("Create Session", "There are already created sessions, " +
                "Do you want to create another one?", 'No', 'Yes', function () {
                showCreateSession(bookingId, create_session_func);
        });

}  // function showResource

function showSessionForm(bookingId, sessionId){

    var content = get_ajax_content('session_form', {
        booking_id: bookingId,
        session_id: sessionId
    });
    show_modal_from_ajax("session-modal", content);
}


function createOrUpdateSession(session_params){
    let url = nonEmpty(session_params.id) ? Api.urls.session.update : Api.urls.session.create;
    send_ajax_json(url, session_params, sessionAjaxDone)
}


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
         return (param.name in values) ? values[param.name] : getObjectValue(param, 'default', '');
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
        var paramName = getObjectValue(param, "name", null);

        // Special empty objects (no label or no name) are treated as separators
        // Other special entries without name, will serve as grouping entities: LineParam, GroupParam
        var base_id = null;
        if (nonEmpty(paramName)) {
            base_id = paramName;
        } else if (nonEmpty(param.label)) {
            base_id = sanitizeAndStripAccents(param.label);
        }
        var param_value = get_param_value(param);
        let paramClass = getObjectValue(param, "paramClass", "StringParam");
        let expertLevel = getObjectValue(param, "expertLevel", 0);

        var row = document.createElement('div');
        row.className = 'row form-group';
        parent.appendChild(row);

        if (base_id == null){
            // Empty param is a separator
            row.className += ' mt-1 mb-1';
        }
        else if (paramClass === "Group") {  // Groups are special and don't have labels
            var div = document.createElement('div');
            div.className = "formgroup col-12"
            div.innerHTML = "<h1><label class='col-1 text-sm-right mr-3'>" + param.label + "</label></h1></br>"
            row.appendChild(div);
            form_addRows(div, param.params, values);
        }
        else {

            if (expertLevel == 1) {  // FIXME: Properly handle expertLevel
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

            if (paramClass === "LabelParam"){
                label.classList.replace('col-4', 'col-12');
                // label.classList.add('text-left');
                label.classList.replace('text-sm-right', 'text-left')
                // row.className = 'row text-left';
                row.style.backgroundColor = "#F5F5F5";
            }
            else if (paramClass === "Line") {
                var div = document.createElement('div');
                div.className = 'row col-8 form-group';
                //div.style.backgroundColor = 'red';
                for (var j = 0;  j < param.params.length; j++) {
                    let p = param.params[j];
                    div.appendChild(create_label('ml-0 pl-0 col-2', p.label))
                    div.appendChild(create_input('col-3', p.name, get_param_value(p)));
                }
                row.appendChild(div);
            }
            else if (paramClass === "EnumParam") {
                let display = getObjectValue(param, "display", "combo");
                let choices = param.choices;
                let labels = [];
                let values = [];

                if (Array.isArray(choices)) {
                    labels = values = choices;
                } else {  // we assume it should be a dict
                    for (const key in choices) {
                      if (choices.hasOwnProperty(key)) {
                          labels.push(choices[key]);
                          values.push(key);
                      }
                    }
                }

                var div = document.createElement('div');
                div.className = 'col-8 form-group';

                if (display == "radio") {
                    div.className = 'row col-8 ml-1';
                    for (var j = 0; j < labels.length; j++) {
                        let v = values[j];
                        let selected = (param_value == v);
                        form_addRadio(div, base_id + '-' + j, base_id, v, labels[j], selected);
                    }
                }
                else { // Combo is the default display option
                    var select = document.createElement('select');
                    select.dataset.key = param.name;
                    select.className = 'form-control form-control-sm';
                    select.style.backgroundColor = "#fff";
                    select.style.color = "black";

                    for (var j = 0; j < labels.length; j++) {
                        var opt = document.createElement('option');
                        let v = values[j];
                        opt.textContent = labels[j];
                        opt.selected = param_value == v;
                        opt.value = v;
                        select.appendChild(opt);
                    }
                    div.appendChild(select);
                }
                row.appendChild(div);
            }
            else if (paramName != null) {

                function _bool(v){
                    return (v === true || v === 1 || v === '1' || v === 'Yes' || v === 'True' || v === 'true')
                }

                if (paramClass === "BooleanParam") {
                    var div = document.createElement('div');
                    div.className = 'row col-8 ml-1';
                    let b = _bool(param_value);
                    form_addRadio(div, base_id + '-yes', base_id, true, 'Yes', b);
                    form_addRadio(div, base_id + '-no', base_id, false, 'No', !b);
                    row.appendChild(div);
                }
                else {  // Default: StringParam
                    row.appendChild(create_input('col-8', param.name, param_value ));
                }
            }
        }

    }
 } // function form_addRows


/** Create a dynamic form based on the JSON definition of sections and params
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
         div.style = "height: 440px";
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

/* --------------- Network/flowchart related functions ---------------*/

var network_colors = {
  saved: '#CBF6F8',  // water
  launched: '#A8E4EF',  // Blizzard Blue
  //'#0CC078',  // Crayola's Green
  //finished: '#79DE79',  // Pastel Green
  finished: '#BBEC7B',
  interactive: '#FCFC99',  // Pastel Yellow
  running: '#FFC634',  // Sunglow (African heart palette)
  aborted: '#DD9789', //'#ABABC3',
  scheduled: '#F0D17A',
  failed: '#FB6962',  // Pastel Red
};


class Flowchart {
    constructor(container, workflow) {
        let data = this.getData(workflow);
        let options = this.getOptions();
        this.network = new vis.Network(container, data, options);
    }

    update(workflow){
        let data = this.getData(workflow);

        // Save current view
        const view = this.network.getViewPosition();
        const scale = this.network.getScale();

        this.network.setData(data);

        // Restore view
        this.network.moveTo({
          position: view,
          scale: scale,
          animation: false
        });
    }

    getData(workflow) {
        var nodes = new vis.DataSet();

        for (var i = 0;  i < workflow.length; i++){
            var prot = workflow[i];
            var c = network_colors[prot['status']];
            var label = prot['label'];
            if (label !== prot['id'])
                label += " (id=" + prot['id'] + ")";

            nodes.add({
                id: prot['id'],
                label: label,
                widthConstraint: { minimum: 120, maximum: 180 },
                labelHighlightBold: false,
                color: {
                  background: c,
                  highlight: {
                    border: 'black',
                    background: c
                  },
                  hover: {
                    border: 'black',
                    background: c
                  },
                }
              });
        }

        var edges = new vis.DataSet();

        for (var i = 0;  i < workflow.length; i++){
            var prot = workflow[i];
            for (var j = 0; j < prot.links.length; j++){
                edges.add({from: prot.id, to: prot.links[j]});
            }
        }

        return {
            nodes: nodes,
            edges: edges,
        };

    } // getData function

    getOptions() {
         return {
            edges: {
              font: {
                size: 12,
              },
              widthConstraint: {
                maximum: 90,
              },
              arrows: {
              from: {
                  enabled: true,
                  type: "circle",
                },
                to: {
                  enabled: true,
                  type: "arrow",
                },
              },
            },
            nodes: {
              shape: "box",
              margin: 10,
              widthConstraint: {
                maximum: 200,
              },
            },
            physics: {
              enabled: false,
            },
            layout: {
              hierarchical: {
                direction: "UD",
                sortMethod: "directed", // "directed"
                  shakeTowards: "roots",
                  nodeSpacing: 200,
                  parentCentralization: true,
                  edgeMinimization: true,
                  blockShifting: true
              }
            },
            interaction: {
                hover: true,
                multiselect: true,
            }
        };
    } // function getOptions
}

/**
 * Class containing the network and the forms
 */
class ProcessingDashboard {
    constructor(workflow, get_project_args, flowchartContainerId) {

        this.workflow = workflow;
        // Project arguments to retrieve runs or project info
        // args should contain 'sessionId' or 'entry_id' keys
        this.get_project_args = get_project_args;

        this.selected_node = {id: null, type: ''};
        this.display_expert = 'none';
        this.forms = {};
        this.runDict = null;
        this.statuses_values = [
            {id: 'run_', status: 1},
            {id: 'summary_', status: 1}
        ];

        this.status_classes = ['badge-light', 'badge-dark'];
        this.status_display = ['none', 'block'];

        let container = document.getElementById(flowchartContainerId);
        this.flowchart = new Flowchart(container, workflow);
        let self = this;
        this.flowchart.network.on("click", function (params) {
            self.clickOnCanvas(params);
        });

        // Create stdoutEditor
        this.stdoutEditor = ace.edit("stdout-editor");
        this.stdoutEditor.setTheme("ace/theme/monokai");

        this.stderrEditor = ace.edit("stderr-editor");
        this.stderrEditor.setTheme("ace/theme/monokai");

        this.jsonEditor = ace.edit("json-editor")
        this.jsonEditor.session.setMode("ace/mode/json");

        setInterval(() => this.reloadWorkflow(), 30000);
    } // constructor

    initialize(flowchat_containerId) {

    } // initialize

    getSelectedNodeId() {
        return this.selected_node.id;
    }

    getArgs(extraArgs){
        var args = {
            run_id: this.getSelectedNodeId(),
            job_type: this.selected_node.type
        };
        jQuery.extend(args, this.get_project_args);
        if (extraArgs)
            jQuery.extend(args, extraArgs);
        return args;
    } // getArgs

    displayButtons(value) {
        let element = document.getElementById('processing_buttons_toolbar')
        element.style.display = value ? 'inline-block' : 'none'; // show or hide
    }

    selectJob(jobId) {
        let selected_node = {id: null, type: ''};
        // find node with  that id
          for (var i = 0;  i < this.workflow.length; i++){
              var prot = this.workflow[i];
              if (prot.id == jobId) {
                  selected_node = prot;
                  break;
              }
          }

          if (selected_node.id != null) {
              this.selected_node = selected_node;
              this.clearRunInfo();

              if (this.selected_node.type in this.forms)
                this.loadRun(['json']);
              else
                  this.loadRun(['form', 'json']);

              this.loadRun(['stdout']);
              this.loadRun(['stderr']);

              load_html_from_ajax('summary_row',
                  get_ajax_content('processing_run_summary', this.getArgs()));
          }
          else {
              this.clearRunInfo(false);
          }
    }

    clickOnCanvas(params){
        this.selectJob(params.nodes[0]);
    }

    clearRunInfo(loading=true){
        this.stdoutEditor.setValue('');
        this.stderrEditor.setValue('');
        this.jsonEditor.setValue('');

        this.displayButtons(false);
        if (loading) {
            setLoading('run_form_container');
            setLoading('summary_row');
        }
        else {
            $('#run_form_container').html('');
            $('#summary_row').html('');
        }
    }

    newRun(jobType) {
        this.selected_node = {
            id: null,
            type: jobType
        };
        this.clearRunInfo();
        this.loadRun('form');
    }

    request(url, args){
        return $.ajax({
            url: url,
            type: "POST",
            contentType: 'application/json; charset=utf-8',
            data: JSON.stringify({attrs: args}),
            dataType: "json"
        });
    }

    reloadWorkflow(){
        let self = this;
        console.log("Reloading workflow.")

        var reqRun = self.request(
            Api.urls.get_session_workflow,
            self.getArgs()
        );
        reqRun.done(function(data) {
            if ('workflow' in data) {
                // showMessage('Operation completed', `Deleted job ${jobId}.`);
                self.flowchart.update(data['workflow']);
                let jobId = self.getSelectedNodeId();
                if (jobId != null) {
                    console.log("Selecting job id: " + jobId);
                    self.flowchart.network.selectNodes([jobId]);
                }
            }
            else if ('error' in data) {
                showError(data['error'])
            }
        });
    }

    jobRequestDone(data, operationLabel) {
        if ('job' in data && 'id' in data.job) {
                let job = data.job;
                showMessage('Operation completed', `${operationLabel} job ${job.id}.`);
                this.workflow = job.workflow;
                this.flowchart.update(job.workflow);
                this.flowchart.network.selectNodes([job.id]);
                this.selectJob(job.id);
            }
            else if ('error' in data) {
                showError(data.error)
            }
    }

    saveJob(){
        let self = this;

        var reqRun = this.request(
            Api.urls.save_job,
            this.getArgs({params: getFormAsJson('processing_form', true)})
        );
        reqRun.done(function(data) {
            self.jobRequestDone(data, 'Saved');
        });
    } // function saveJob


    launchJob(clean=false){
        let self= this;

        var reqRun = this.request(
            Api.urls.launch_job,
            this.getArgs({params: getFormAsJson('processing_form', true), clean: clean})
        );
        reqRun.done(function(data) {
            self.jobRequestDone(data, 'Launched');
        });
    } // function launchJob

    duplicateJob(){
        this.selected_node.id = null;
        this.saveJob();
    } // function duplicateJobs

    deleteJob() {

        let self = this;
        let jobId = this.selected_node.id;

        if (jobId == null)
            showError("Can't delete unsaved job.");
        else
            confirm(
                "Delete Operation",
                `Do you want to <label style="color: red">DELETE</label> run <strong>${jobId}</strong> and ALL its content?`,
                'Cancel', 'Delete',
                function () {
                    var reqRun = self.request(
                        Api.urls.delete_job,
                        self.getArgs()
                    );
                    reqRun.done(function(data) {
                        if ('id' in data) {
                            self.workflow = data.workflow;
                            this.selected_node.id = null;
                            self.flowchart.update(self.workflow);
                        }
                        else if ('error' in data) {
                            showError(data['error'])
                        }
                    });
                });
    }

    loadRun(output){
        var reqRun = this.request(
            Api.urls.get_session_run,
            this.getArgs({output: output})
        );

        let self = this;
        let jobType = self.selected_node.type;

        reqRun.done(function(data) {
            var run_data = data['run'];
            var form_data = null;

            self.runDict = {
                info: {name: jobType},
                values: {}
            };

            if ('form' in run_data) {
                form_data = run_data['form'];
                self.forms[jobType] = form_data;
                //jsonEditor.setValue(JSON.stringify(form_data, null, 4), 1);
            }

            //alert(JSON.stringify(data));
            if ('json' in run_data) {
                self.runDict = run_data['json']
                //jsonEditor.setValue(JSON.stringify(run_data, null, 4), 1);
                form_data = self.forms[jobType]
            }

            if (form_data) {
                let info = self.runDict.info;
                $('#logo-label').text(form_data.name);
                $('#logo-label-extra').text('(' + info.name + ')');
                $('#logo-img').attr('src', 'data:image/png;base64,' + form_data.logo);
                $('#logo-img').css('display', form_data.logo ? 'flex': 'none');

                let values = self.runDict.values;
                form_create(form_data, values, 'run_form_container');
                self.displayButtons(true);
                self.loadJsonValues();
            }

            if ('stdout' in run_data)
                self.stdoutEditor.setValue(run_data['stdout'], 1)

            if ('stderr' in run_data)
                self.stderrEditor.setValue(run_data['stderr'], 1)
        });

        reqRun.fail(function(jqXHR, textStatus) {
          alert( "Run request failed: " + textStatus );
        });
    }

    loadJsonValues(){
        let values = getFormAsJson('processing_form', true);
        this.jsonEditor.setValue(JSON.stringify(values, null, 4));
    }

    loadRunOverview(title){
        load_overview(title, get_ajax_content('processing_run_overview', this.getArgs()));
    }

    loadRunFileInfo(path) {
        load_overview(path, get_ajax_content('processing_run_overview', this.getArgs({file_path: path})));
    }

    clickOnExpert() {
        this.display_expert = $('#switch-expert').prop('checked') ? 'flex' : 'none';
        $('.scn-expert-param').css('display', this.display_expert);
    }


    // FIXME: Check if in use
    splitPanels(col1, col2) {
        console.log('Splitting ', 'col-' + col1, 'col-' + col2);
        $('#run_col').removeClass().addClass('col-' + col1);
        $('#summary_col').removeClass().addClass('col-' + col2);
    }

    // FIXME: Check if in use
    switchStatus(index) {
        let item = this.statuses_values[index];
        console.log('Switching status: ', item);
        let otherStatus = 1 - item.status;
        console.log($('#' + item.id + 'row').css('display'));

        $('#' + item.id + 'span').removeClass(this.status_classes[item.status]).addClass(this.status_classes[otherStatus]);
        $('#' + item.id + 'row').css('display', this.status_display[otherStatus]);
        item.status = otherStatus;

        // Make arrangements depending on the other panel status
        let otherItem = this.statuses_values[1 - index];

        if (item.status > 0) { // showing current index
            if (otherItem.status > 0)
                this.splitPanels(3, 3);
            else
                this.splitPanels(5, 1);
        }
        else { // hiding current index
            if (otherItem.status > 0)
                this.splitPanels(1, 5);
            else
                this.switchStatus(1 - index);
        }

    }
}