/* ---------------- BOOKING functions ------------------ */
/** Return how many days this booking expands.
 * (Used to calculate costs based on daily costs of the
 * used resource.)
 **/
function getBookingDays(booking) {
     var time_difference = dateNoTime(booking.end).getTime() - dateNoTime(booking.start).getTime();
     //calculate days difference by dividing total milliseconds in a day
     var days_difference = time_difference / (1000 * 60 * 60 * 24);
     return days_difference + 1;
}

function setDateAndTime(idPrefix, dateIso){
    const dateId = '#' + idPrefix + '-date';
    const timeId = '#' + idPrefix + '-time';
    var d = new Date(Date.parse(dateIso));
    $(dateId).datetimepicker({format: 'YYYY/MM/DD'});
    $(dateId).val(dateStr(d));
    $(timeId).val(timeStr(d));
}

function getDateAndTime(idPrefix) {
   return  dateFromValue('#' + idPrefix + '-date',
                        '#' + idPrefix + '-time').toISOString();
}

/** Return True if there is a calendar variable defined.
 * This is used to update the calendar after modification of the bookings.
 */
function hasCalendar() {
    return calendar !== null;
}

/** Helper functions to handle AJAX response or failure */
function handleBookingAjaxDone(jsonResponse) {
    let error = null;
    const has_calendar = hasCalendar();

    if ('bookings_created' in jsonResponse) {
        on_bookings_created(jsonResponse);
    }
    else if ('bookings_updated' in jsonResponse) {
        on_bookings_updated(jsonResponse);
    }
    else if ('bookings_deleted' in jsonResponse) {
        on_bookings_deleted(jsonResponse);

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
        $('#booking-modal').modal('hide');
        if (has_calendar) {
            last_event = null;
            calendar.render();
        }

    }
}

function handleAjaxFail(jqXHR, textStatus) {
    showError("Request failed: " + textStatus );
}

/* Show the Booking Form from a given id */
function showBookingForm(booking_params, modalId)
{
    last_experiment = null;
    if (!modalId)
        modalId = 'booking-modal';
    show_modal_from_ajax(modalId, get_ajax_content("booking_form",
                                                    booking_params));
}

/**
 * Retrieve the booking parameters from the Form
 */
function getBookingParams(includeEmpty) {
    booking = getFormAsJson('booking-form', includeEmpty);
    jQuery.extend(booking, getFormAsJson('booking-form-admin', includeEmpty));

    booking.start = getDateAndTime('booking-start');
    booking.end = getDateAndTime('booking-end');
    booking.experiment = last_experiment;

    if (booking.type == 'slot') {
        booking.slot_auth = {
            applications: $('#booking-slot-auth').selectpicker('val'),
            users: []
        }
    }
    return booking;
}

function doRepeat(booking) {
    const repeat = booking.repeat_value;
    return nonEmpty(repeat) && repeat !== 'no';
}

function invalidRepeatParams(booking) {
    if (doRepeat(booking) && booking.modify_all === null) {
            showError("<p>Please select a value for input <b>Modify repeating</b>: " +
                      "<i>Only this</i> or <i>All upcoming</i>.")
            return true;
        }
    return false;
}

/** This function will be called when the OK button in the Booking form
 * is clicked. It can be either Create or Update action.
 */
function onOkButtonClick(is_new) {

    let endpoint = null;
    var booking = null;

    try {
        booking = getBookingParams(!is_new);
    }
    catch (err) {
        showError("Error: " + err.toString());
    }

    if (booking.id) {
        endpoint = Api.urls.booking.update;
        if (invalidRepeatParams(booking))
            return;
    }
    else {
        endpoint = Api.urls.booking.create;
        // Only take into account repeat value when creating a new booking
        if (doRepeat(booking)) {
            try {
                booking.repeat_stop = dateFromValue('#booking-repeat-stop-date').toISOString();
            }
            catch(err) {
                showError("<p>Please provide a valid <b>Stop date</b> for the repeating event.")
                return
            }
        }
    }

    // User later for delete actions and updating the calendar if necessary
    last_booking = booking;

    var ajaxContent = $.ajax({
        url: endpoint,
        type: "POST",
        contentType: 'application/json; charset=utf-8',
        data: JSON.stringify({attrs: booking}),
        dataType: "json"
    });

    ajaxContent.done(handleBookingAjaxDone);
    ajaxContent.fail(handleAjaxFail);
}  // function onOkButtonClick

    /** This function will be called when the Delete button in the Booking form
 * is clicked.
 */
function onDeleteButtonClick() {
    const booking = getBookingParams(false);

    confirm("Delete Booking",
        "Are you sure to DELETE this Booking?",
         "Cancel", "Delete",
        function () {
            if (invalidRepeatParams(booking))
            return;

            let deleteInfo = {
                id: booking.id,
                modify_all: booking.modify_all,
            };

            var ajaxContent = $.ajax({
                url: Api.urls.booking.delete,
                type: "POST",
                contentType: 'application/json; charset=utf-8',
                data: JSON.stringify({attrs: deleteInfo}),
                dataType: "json"
            });

            ajaxContent.done(handleBookingAjaxDone);
            ajaxContent.fail(handleAjaxFail);
    });
}

/** This function will be called when the Delete button in the Booking form
 * is clicked. It can be either Create or Update action.
 */
function onCancelButtonClick() {
    if (nonEmpty(last_event)) {
        var event = calendar.getEventById( last_event.id );
        event.setDates(last_event.start, last_event.end);
        last_event = null;
        calendar.render();
    }
}

function showExperimentForm(booking_id) {
    var params = {booking_id: booking_id};
    if (last_experiment)
        params.form_values = JSON.stringify(last_experiment);

    ajaxContent = get_ajax_content("experiment_form", params);

    ajaxContent.done(function(html) {
        $("#experiment-modal").html(html);
        $("#dynamic-btn-ok" ).click(function() {
            last_experiment = getFormAsJson('dynamic-form');
            $('#experiment-modal').modal('hide');
        });
        // Show the form after setting html content
        $('#experiment-modal').modal('show');
    });

    ajaxContent.fail(function(jqXHR, textStatus) {
        alert( "Request failed: " + textStatus );
    });

}  // function showExperimentForm

function showBookingCosts() {
    var params = {booking_id: last_booking.id};

    ajaxContent = get_ajax_content("booking_costs_table", params);

    ajaxContent.done(function(html) {
        $("#experiment-modal").html(html);
        addBookingCosts(last_booking);

        $("#costs-btn-update" ).click(function() {
            last_booking.costs = getAllCosts();
            $('#experiment-modal').modal('hide');
        });
        // Show the form after setting html content
        $('#experiment-modal').modal('show');
    });

    ajaxContent.fail(function(jqXHR, textStatus) {
        alert( "Request failed: " + textStatus );
    });

}  // function showBookingCosts


/*------------  Calendar related functions --------------- */

function createCalender() {
    var Calendar = FullCalendar.Calendar;
    var calendarEl = document.getElementById('booking_calendar');

    return new Calendar(calendarEl, {
        plugins: [ 'interaction', 'dayGrid', 'timeGrid' ],
        header: {
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        editable: true,
        droppable: true, // this allows things to be dropped onto the calendar
        selectable: true, // allows to select dates
        eventSources: [
            {
              url: Api.urls.booking.range,
              method: 'POST',
                format: 'json'
            }
        ],
        eventSourceSuccess: function(all_events, xhr) {
            var sel = document.getElementById("selectpicker-resource-display");

            var visibleResourcesId = getSelectedValues(sel);

            hidden_events = [];
            var visible_events = [];
            var i;
            var e;

            var all_ids = [];
            for (i = 0; i < all_events.length; i++) {
                e = all_events[i];
                if (all_ids.indexOf(e.id) == -1){
                    all_ids.push(e.id);
                    if (hasVisibleResource(visibleResourcesId,
                                       e.resource.id))
                        visible_events.push(e);
                    else {
                        e.extendedProps = {resource: e.resource};
                        hidden_events.push(e);
                    }
                }
            }

            return visible_events;
        },
        eventReceive: function(info) {
       },
        eventAllow: function(info, draggedEvent) {
            last_event = {
                id: draggedEvent.id,
                start: new Date(draggedEvent.start),
                end: new Date(draggedEvent.end)
            };
            return true;
        },
        // Return True if the selection of dates is allowed
        selectAllow: function(info) {
            return true;
        },
        select: function(info) {

            showBookingForm(paramsFromSelection(info));
        },
        eventClick: function(info) {
            showBookingForm({booking_id: info.event.id});
        },
        eventDrop: function(info) {
            const e = info.event;
            showBookingForm({
                booking_id: e.id,
                start: e.start.toISOString(),
                end: e.end.toISOString()
            });
        },
        viewRender: function (view, element) {
            alert('The new title of the view is ' + view.title);
        }
  });
} // function createCalendar

/** Function called when new dates are selected for a given Resource.
 * It creates a new booking and shows the Booking Form. **/
function paramsFromSelection(info) {
    if (info.allDay) {
        info.end.setDate(info.end.getDate() - 1);
        info.start.setHours(9);
        info.start.setMinutes(0);
        info.end.setHours(23);
        info.end.setMinutes(59);
    }

    return {
        start: info.start.toISOString(),
        end: info.end.toISOString()
    };
}

function hasVisibleResource(visibleResourcesId, erid) {
    if (visibleResourcesId.length == 0)
        return true;

    for (const rid of visibleResourcesId)
            if (erid == rid)
                return true;
        return false;
}

function filterBookingsByResources(){
    var sel = document.getElementById("selectpicker-resource-display");
    var visibleResourcesId = getSelectedValues(sel);
    var all_events = hidden_events.concat(calendar.getEvents());
    hidden_events = [];

    calendar.batchRendering(function(){
        calendar.removeAllEvents();
        var all_ids = [];
        for (e of all_events) {
            if (all_ids.indexOf(e.id) == -1) {
                all_ids.push(e.id);
                if (hasVisibleResource(visibleResourcesId,
                        e.extendedProps.resource.id))
                    calendar.addEvent(e);
                else
                    hidden_events.push(e);
            }
        }
    });
}

/** Remove bookings events from calendar and from booking list */
function remove_bookings(deleted) {
    // Remove events from Calendar
    var event;
    for (var booking of deleted) {
       event = calendar.getEventById(booking.id);
       if (event)
           event.remove();
    }
}

/** Add new bookings to the calendar and to the list */
function add_bookings(added) {
    for (var booking of added) {
        event = calendar.addEvent(booking);
    }
}
