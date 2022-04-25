/**
 * Created by josem on 6/3/20.
 */

/** Singleton class to manage the application URL for the data model.
 * It will automatically select 'create' or 'update' based on the provided id.
 */
class Api {
    static urls = null;

    static get(key, id) {
        const url = Api.urls[key];
        return id != null && !Number.isNaN(id) ? url.update : url.create;
    }
}

/* Helper function to print object properties */
function printObject(obj, label) {
    var propValue;
    console.log("object: ", label);
    for (var propName in obj) {
        propValue = obj[propName]
        console.log('   ', propName, ': ', propValue);
    }
}


function printArray(array, label){
    console.log("Array: ", label);
    var i = 0;
    for (var i = 0; i < array.length; ++i) {
        console.log(i + ": " + array[i]);
    }
}

function printList(objList, label) {
    console.log("List: ", label);
    var i = 0;
    for (var obj of objList) {
        i = i + 1;
        printObject(obj, "item " + i);
    }
}

function printDict(objDict, label) {
    for(var key in objDict) {
      var value = objDict[key];
      printObject(value, "key: " + key);
    }
}

function removeObjectFromList(obj, objList) {
    var newList = [];
    for (var o of objList)
        if (o.id != obj.id)
            newList.push(o);
    return newList;
}

/* Helper function to pad dates */
function pad(n) {
    return n < 10 ? '0' + n : n;
}

/* Get date string in YYYY-MM-DD format */
function dateStr(date) {
    return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate());
}

function dateFromValue(dateId, timeId) {
    var dateVal = $(dateId).val();

    if (timeId)
        dateVal += ' ' + $(timeId).val().replace('.000', ' GMT');

    var date = new Date(dateVal);

    // If the parsing fails with date separator /, let's try with spaces
    if (isNaN(date)){
        dateVal = dateVal.replace(/\//g, ' ');
        date = new Date(dateVal);
    }
    return date;
}

function dateIsoFromValue(dateId, timeId) {
    return dateFromValue(dateId, timeId).toISOString();
}

/* Get hour:minutes string HH:00 format */
function timeStr(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function datetimeStr(date) {
    return dateStr(date) + ' - ' + timeStr(date);
    //return date.toUTCString();
}

/** Return the part of the date without any time */
function dateNoTime(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
    return  d;
}

/* Date in range */
function dateInRange(date, range, useTime) {
    var d = date;
    var start = range.start;
    var end = range.end;

    if (!useTime) {
        d = dateNoTime(d);
        start = dateNoTime(start);
        end = dateNoTime(end);
    }

    return (d >= start && d <= end);
}

/* Check if two events overlap (if have same resource) */
function rangesOverlap(event1, event2, useTime) {
    return (dateInRange(event1.start, event2, useTime) ||
            dateInRange(event1.end, event2, useTime));
}

/* Return True if event1 is contained in event2 */
function rangeInside(event1, event2, useTime) {
    return (dateInRange(event1.start, event2, useTime) &&
            dateInRange(event1.end, event2, useTime));
}

/* Get all selected values from a 'select' */
function getSelectedValues(sel) {
    var opt;
    var values = new Array();

    for ( var i = 0, len = sel.options.length; i < len; i++ ) {
        opt = sel.options[i];
        if ( opt.selected === true ) {
            values.push(opt.value);
        }
    }
    return values;
}

/* Function to show the modal */
function showMessage(title, msg) {
    var confirmModal =
    $('<div class="modal" id="msg-modal" tabindex="-1" role="dialog" aria-labelledby="msgModal" aria-hidden="true">\n' +
      '  <div class="modal-dialog modal-dialog-centered modal-lg" role="document">\n' +
      '    <div class="modal-content" style="background-color: #f5f5f5">\n' +
      '      <div class="modal-header">\n' +
      '           <h4 class="modal-title" id="message-title">' + title + '</h4>\n' +
      '      </div>' +
      '      <div class="modal-body" id="yesno-body">' + msg +
      '      </div>\n' +
      '      <div class="modal-footer">\n' +
      '        <button type="button" class="btn btn-primary" id="okButton" data-dismiss="modal">Ok</button>\n' +
      '      </div>\n' +
      '    </div>\n' +
      '  </div>\n' +
      '</div>');

    confirmModal.modal('show');
}

/* Shortcut to show error messages */
function showError(msg) {
    showMessage('ERROR', msg);
}

/* Generic Confirm func */
function confirm(heading, question, cancelButtonTxt, okButtonTxt, callback) {
    var confirmModal =
        $('<div class="modal" id="yesno-modal" tabindex="-1" role="dialog" aria-labelledby="yesnoModal" aria-hidden="true">\n' +
          '  <div class="modal-dialog modal-dialog-centered modal-lg" role="document">\n' +
          '    <div class="modal-content" style="background-color: #f5f5f5">\n' +
          '      <div class="modal-header">\n' +
          '           <h4 class="modal-title" id="message-title">' + heading + '</h4>\n' +
          '      </div>' +
          '      <div class="modal-body" id="yesno-body">' + question +
          '      </div>\n' +
          '      <div class="modal-footer">\n' +
          '        <button type="button" class="btn btn-outline-secondary"  data-dismiss="modal">' + cancelButtonTxt + '</button>\n' +
          '        <button type="button" class="btn btn-outline-dark" id="okButton" data-dismiss="modal">' + okButtonTxt + '</button>\n' +
          '      </div>\n' +
          '    </div>\n' +
          '  </div>\n' +
          '</div>');

    confirmModal.find('#okButton').click(function(event) {
      callback();
      confirmModal.modal('hide');
    });

    confirmModal.modal('show');
};
/* END Generic Confirm func */

function notImplemented(msg) {
    showMessage("NOT IMPLEMENTED", msg);
}


function getInputValue(element) {
    var type = $(element).prop('type');
    var value = null;

    if (type == 'checkbox')
        value = $(element).prop('checked');
    else if (type == 'radio')
        value = $('input[name="' + element.name + '"]:checked').val();
    else
        value = $(element).val();

    return value;
}


function setInputValue(element, value) {
    var type = $(element).prop('type');

    if (type == 'checkbox')
        value = $(element).prop('checked', Boolean(value));
    else if (type == 'radio')
        value = $('input[name="' + element.name + '"]:checked').val();
    else if ($(element).hasClass('selectpicker'))
        $(element).selectpicker('val', value);
    else
        value = $(element).val(value);

    return value;
}


function nonEmpty(value) {
    var type = typeof value;

    if (type === 'string')
        return value.trim().length > 0;

    if (type === 'number')
        return true;

    if (Array.isArray(value))
        return value.length > 0;

    if (type === 'object')
        return Object.keys(value).length > 0;

    return Boolean(value);
}


function row_setValues(row, values){
    $(row).find(':input').each(function () {
        var col = $(this).data('key');
        if (col in values) {
            var value = values[col];

            if (nonEmpty(value))
                setInputValue(this, value);
        }
    });
}


function row_getValues(row, includeEmpty){
    var values = {};
    $(row).find(':input').each(function () {
        var value = getInputValue(this);
        if (includeEmpty || nonEmpty(value)) {
            var col = $(this).data('key');
            if (col)
                values[col] = value;
        }
    });
    return values;
}


function getFormAsJson(formId, includeEmpty){
    var json = {};

    $('#' + formId + ' *').filter(':input').each(function(){
        var key = $(this).data('key');
        if (key)
            json[key] = getInputValue(this);
    });

    $('#' + formId + " table").each(function () {
        var row_list = [];

        $(this).find('.data-row').each(function () {
            var values = row_getValues(this, includeEmpty);
            if (nonEmpty(values))
                row_list.push(values);
        });
        json[this.id] = row_list;
    });

    if (includeEmpty)
        return json;

    var newJson = {};
    for (var propName in json) {
        propValue = json[propName]
        if (propValue)
            newJson[propName] = propValue;
    }
    return newJson;
} // function onFormOk



function getFilesFromForm(formId) {
    var json = {};

    $('#' + formId + ' *').filter(':input').each(function(){
        var key = this.id.replace('--file', '');
        if (key && $(this).prop('type') === 'file')
           if (this.files && this.files[0])
                json[key] = this.files[0];
    });

    return json;
}


function create_sparkline(id, values, args) {
    const new_args = Object.assign({
        type: 'line',
        width: '99.5%',
        height: '50',
        lineColor: '#5969ff',
        fillColor: '#dbdeff',
        lineWidth: 2,
        spotColor: undefined,
        minSpotColor: undefined,
        maxSpotColor: undefined,
        highlightSpotColor: undefined,
        highlightLineColor: undefined,
        resize: true
    }, args);

    $(id).sparkline(values, new_args);
}

function get_ajax_html(url, params) {
    return $.ajax({
        url: url,
        type: "POST",
        data: params,
        dataType: "html"
    });
}

/**
 * Make an AJAX request to the server and render the html result in a container.
 * @param container_id The HTML container id where the result content will be placed.
 * @param content_id contend id that will be requested to the server
 * @param params dictionary with extra parameters to retrieve the content.
 */
function get_ajax_content(content_id, params) {

    if (params == null)
        params = {content_id: content_id};
    else
        params.content_id = content_id;

    return get_ajax_html(content_url, params);
}

/**
 * Make an AJAX request to retrieve some content and set it as html of the container
 * @param container_id: Container that Will receive the content
 * @param content_id: id of the content to be retrieved
 * @param params: params passed to retrieving the content
 */
function load_html_from_ajax(container_id, ajaxContent) {
    ajaxContent.done(function(html) {
        $('#' + container_id).html(html);
    });

    ajaxContent.fail(ajax_request_failed);
}

function show_modal_from_ajax(container_id, ajaxContent) {
    ajaxContent.done(function(html) {
        $('#' + container_id).html(html);
        $('#' + container_id).modal('show');
    });

    ajaxContent.fail(function(jqXHR, textStatus) {
        showError( "Request failed: " + textStatus );
    });
}

/**
 * Make an AJAX request sending json data to some url in the server
 * @param url: URL to send the ajax request
 * @param attrs: json data to send
 * @param done: callback when the request is done
 * @param fail: callback when the request failed
 */
function send_ajax_json(url, attrs, done, fail){
    var ajaxContent = $.ajax({
        url: url,
        type: "POST",
        data: JSON.stringify({attrs: attrs}),
        contentType: 'application/json; charset=utf-8',
        dataType: "json"
    });

    ajaxContent.done(done);
    if (!fail)
        fail = ajax_request_failed;
    ajaxContent.fail(fail);
}

function send_ajax_form(url, formData, done, fail){
    var ajaxContent = $.ajax({
        url: url,
        type: "POST",
        data: formData,
        processData: false,
        contentType: false,
        dataType: "json"
    });

    ajaxContent.done(done);
    if (!fail)
        fail = ajax_request_failed;
    ajaxContent.fail(fail);
}

function ajax_request_done(jsonResponse, expectedKey){
    var error = null;

    if (expectedKey in jsonResponse) {
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
        location.reload();
    }
}

function ajax_request_failed(jqXHR, textStatus) {
    showError("Ajax Request FAILED: " + textStatus );
}

function savePdf(contentId) {

    var elementHTML = $('#' + contentId).html();

    var opt = {
        margin:       10,
        filename:     'myfile.pdf',
        //pagebreak:  { mode: '', before: '.before', after: '.after', avoid: '.avoid' },
        pagebreak: {mode: 'legacy'},
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            dpi: 192,
            scale:4,
            letterRendering: true,
            useCORS: true
        },
    };

    html2pdf(elementHTML, opt);
}

//----------------------------- Table related functions --------------------------
function table_getTemplateRow(table_id){
    return document.getElementById(table_id + '-ROW-TEMPLATE');
}

function table_createNewRow(table_id){
    var rowElement = table_getTemplateRow(table_id);

    var newRow = rowElement.cloneNode(true);
    var nextid = rowElement.parentNode.dataset.nextid;
    newRow.id = table_id + "-row-" + nextid;
    newRow.className = "data-row";
    newRow.style.display = "table-row";
    $(newRow).find('*').each(function () {
        if (this.id) {
            this.id = this.id.replace(table_id + '-ROW-TEMPLATE', newRow.id);
        }
    });
    rowElement.parentNode.dataset.nextid = parseInt(nextid) + 1;
    return newRow;
}

function table_addRow(table_id){
    var rowTemplate = table_getTemplateRow(table_id);
    var newRow = table_createNewRow(table_id);
    rowTemplate.parentNode.appendChild(newRow);
    $('.data-row select').selectpicker('refresh');
    return newRow;
}

function table_getSelectedRows(table_id){
    var rows = []
    $('#' + table_id).find('.row-checkbox').each(function () {
        if ($(this).prop('checked'))  // get row id
            rows.push(this.parentElement.parentElement.parentElement);
    });
    return rows;
}

function table_getEmptyRows(table_id){
    var rows = []
    $('#' + table_id).find('.data-row').each(function () {
        var values = row_getValues(this, false);

        if (jQuery.isEmptyObject(values))
            rows.push(this);
    });
    return rows;
}

function table_deleteRows(table_id){
    var rows = table_getSelectedRows(table_id);
    if (rows.length > 0) {
        for (var row of rows)
            row.remove();
    }
    else
        showError("Select rows to Remove");
}

function table_copyRows(table_id){
    var rows = table_getSelectedRows(table_id);
    if (rows.length > 0) {

        var lastPosition = null;
        for (var row of rows)
            lastPosition = row.nextSibling;

        for (var row of rows){
            var newRow = table_createNewRow(table_id);
            var values = row_getValues(row);
            row.parentElement.insertBefore(newRow, lastPosition);
            $('#' + table_id).find('.data-row select').each(function () {
                $(this).addClass('selectpicker');
            });
            row_setValues(newRow, values);
        }

        $('.selectpicker').selectpicker('render');
    }
    else
        showError("Select rows to Clone");
}

function table_rowsToClipboard(table_id) {
    if (navigator.clipboard){
        var rows = table_getSelectedRows(table_id);
        if (rows.length > 0) {
            var data = [];
            for (var row of rows)
                data.push(row_getValues(row));
            var text = JSON.stringify(data);
            navigator.clipboard.writeText(text);
        }
        else
            showError("Select rows to Copy values");
    }
    else {
        showError("Clipboard API not supported to copy row values.")
    }
}

function table_clipboardToRows(table_id) {
    if (navigator.clipboard){
            //var text = navigator.clipboard.readText();
            navigator.clipboard.readText().then(
                clipText => {
                    var rowValues = JSON.parse(clipText);
                    var emptyRows = table_getEmptyRows(table_id);

                    for (var i = 0; i < rowValues.length; ++i){
                        var values = rowValues[i];

                        var row = i < emptyRows.length ? emptyRows[i] : table_addRow(table_id);
                        row_setValues(row, values);
                    }

            }).catch(err => {
                showError('Something went wrong' + err);
            });
            //var rows = JSON.parse(text);
    }
    else {
        showError("Clipboard API is not supported.")
    }
}

//----------------------------- FileBrowser related functions --------------------------

function filebrowser_onBrowse(element){
    var fileId = element.id.replace('--browse', '--file');
    $('#' + fileId).change(function(){
    filebrowser_updateFilePath( this );
});
    $('#' + fileId).click();
}

function filebrowser_onClear(element){
    var textId = element.id.replace('--clear', '--text');
    $('#' + textId).val('');
}

function filebrowser_updateFilePath(fileUpload) {
    if ( fileUpload.files && fileUpload.files[0] ){
        var textId = fileUpload.id.replace("--file", "--text");
        $('#' + textId).val(fileUpload.files[0].name);
    }
}