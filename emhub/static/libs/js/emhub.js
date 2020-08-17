/**
 * Created by josem on 6/3/20.
 */

/* Helper function to print object properties */
function printObject(obj, label) {
    var propValue;
    console.log("object: ", label);
    for (var propName in obj) {
        propValue = obj[propName]
        console.log('   ', propName, ': ', propValue);
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
    return pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + '/' +  pad(date.getFullYear());
}

function dateIsoFromValue(dateId, timeId) {
    var dateVal = $(dateId).val();
    var dateParts = dateVal.split('/');
    var dateIsoVal = dateParts[2] + '-' + dateParts[1] + '-' + dateParts[0];
    if (timeId)
        dateIsoVal += 'T' + $(timeId).val();
    return new Date(dateIsoVal).toISOString();
}

/* Get hour:minutes string HH:00 format */
function timeStr(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function datetimeStr(date) {
    //return dateStr(date) + ' - ' + timeStr(date);
    return date.toUTCString();
}

/* Date in range */
function dateInRange(date, range) {
    return (date >= range.start && date <= range.end);
}

/* Check if two events overlap (if have same resource) */
function rangesOverlap(event1, event2) {
    // console.log(">>> rangeOverlap");
    // console.log("          event1:", {start: dateStr(event1.start), end: dateStr(event1.end)});
    // console.log("            resource:", selected_resource.id)
    // console.log("          event2:", {start: dateStr(event2.start), end: dateStr(event2.end)});
    // console.log("            resource:", event2.extendedProps.resource.id);
    // console.log("          result: ", (dateInRange(event1.start, event2) || dateInRange(event1.end, event2)))
    return (dateInRange(event1.start, event2) || dateInRange(event1.end, event2));
}

/* Return True if event1 is contained in event2 */
function rangeInside(event1, event2) {
    // console.log(">>> rangeInside");
    // console.log("          event1:", {start: dateStr(event1.start), end: dateStr(event1.end)});
    // console.log("          event2:", {start: dateStr(event2.start), end: dateStr(event2.end)});
    // console.log("          result: ", (event1.start >= event2.start && event1.end <= event2.end));
    return (event1.start >= event2.start && event1.end <= event2.end);
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
          '        <button type="button" class="btn"  data-dismiss="modal">' + cancelButtonTxt + '</button>\n' +
          '        <button type="button" class="btn btn-primary" id="okButton" data-dismiss="modal">' + okButtonTxt + '</button>\n' +
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