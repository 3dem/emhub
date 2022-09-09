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

    /** Helper functions to handle AJAX response or failure */
    function handleBookingAjaxDone(jsonResponse) {
        let error = null;

        if ('bookings_created' in jsonResponse) {
            if (has_calendar)
                add_bookings(jsonResponse.bookings_created);
        }
        else if ('bookings_updated' in jsonResponse) {
            if (has_calendar) {
                remove_bookings(jsonResponse.bookings_updated);
                add_bookings(jsonResponse.bookings_updated);
            }
        }
        else if ('bookings_deleted' in jsonResponse) {
            if (has_calendar)
                remove_bookings(jsonResponse.bookings_deleted);
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
            if (has_calendar)
                calendar.render();
        }
    }


    function handleAjaxFail(jqXHR, textStatus) {
        showError("Request failed: " + textStatus );
    }

    /* Show the Booking Form from a given id */
    function showBookingFromId(booking_id, modalId)
    {
        if (!modalId)
            modalId = 'booking-modal-new';
        show_modal_from_ajax(modalId, get_ajax_content("booking_form_new",
                                                        {booking_id: booking_id}));
    }

    /* Show the Booking Form, either for a new booking or an existing one */
    function showBookingForm(booking) {
        booking_type = booking.type;
        repeat_value = booking.repeat_value;

        var titlePrefix = null;
        if (booking.id == null) {  // New booking
            titlePrefix = 'Create ';
            booking.user_can_modify = true;
            $('#booking-btn-ok').show();
            $('#booking-btn-delete').hide();
            $('#application-label').html('Not set');
        }
        else {
            titlePrefix = 'Update ';
            if (booking.user_can_modify) {
                $('#booking-btn-delete').show();
                $('#booking-btn-ok').show();
            }
            else {
                $('#booking-btn-delete').hide();
                $('#booking-btn-ok').hide();
            }
            $('#application-label').html(booking.application_label);
        }

        let htmlStr = titlePrefix + ' Booking - ' + booking.resource.name;
        if (is_devel)
            htmlStr += ' (id=' + booking.id + ')';

        $('#booking-modal-title').html(htmlStr);
        $('#booking-btn-ok').html(titlePrefix);

        if (possible_owners.length) {
            $('#booking-owner-select').selectpicker('val', booking.owner.id);
        }
        else {
            $('#booking-owner-text').val(booking.owner.name);
            $('#booking-owner-text').prop('readonly', true);
        }

        if (possible_operators.length) {
            if (booking.operator)
                $('#booking-operator-select').selectpicker('val', booking.operator.id);
        }
        else {
            if (booking.operator)
                $('#booking-operator-select').val(booking.operator.name);
            $('#booking-operator-select').prop('readonly', true);
        }

        if  (booking.type == 'booking' &&
             booking.resource.is_microscope &&
             booking.user_can_modify)
            $('#div-describe-experiment').show();
        else
            $('#div-describe-experiment').hide();

        $('#booking-start-date').val(dateStr(booking.start));
        $('#booking-start-time').val(timeStr(booking.start));
        $('#booking-end-date').val(dateStr(booking.end));
        $('#booking-end-time').val(timeStr(booking.end));
        $('#booking-slot-auth').selectpicker('val', booking.slot_auth.applications);

        $('#booking-title').val(booking.title);
        $('#booking-description').val(booking.description);
        $("input[name=booking-type-radio][value=" + booking.type + "]").prop('checked', true);
        $("input[name=booking-repeat-radio][value=" + booking.repeat_value + "]").prop('checked', true);
        modify_all = null;
        $('input[type=radio][name=booking-modify-radio]').val([]);
        //$("input[name=booking-repeat-radio][value='no']").prop('checked', true);
        $('#booking-title').focus();
        $('#booking-modal').modal('show');
    }

    /** This function will be called when the OK button in the Booking form
     * is clicked. It can be either Create or Update action.
     */
    function onOkButtonClick() {
        // Create Event object info from
        // confirm("Create Booking", "do you really want to create the booking?",
        //         "No", "Yes", function () { alert('clicked yes')})
        // //showMessage("Testing", "Testing");
        // return;
        var owner_id = last_booking.owner.id;
        var operator_id = last_booking.operator ? last_booking.operator.id : null;

        if (possible_owners.length)
            owner_id = $('#booking-owner-select').selectpicker('val');

        if (possible_operators.length) {
            operator_id = $('#booking-operator-select').selectpicker('val');
        }

        var start = dateFromValue('#booking-start-date', '#booking-start-time');
        var end = dateFromValue('#booking-end-date', '#booking-end-time');
        var resource = getResource(last_booking.resource.id);

        var booking = {
            id: last_booking.id,
            title: $('#booking-title').val(),
            start: start,
            end: end,
            type: booking_type,
            description: $('#booking-description').val(),
            owner_id: owner_id,
            operator_id: operator_id,
            resource_id: last_booking.resource.id,
            modify_all: modify_all,
            repeat_value: repeat_value,
            resource: resource,
            experiment: last_booking.experiment,
            application_label: last_booking.application_label,
            costs: last_booking.costs
        };

        if (booking_type == 'slot') {
            booking.slot_auth = {
                applications: $('#booking-slot-auth').selectpicker('val'),
                users: []
            }
        }
        else if (booking_type == 'booking') {
            if (resource.is_microscope && jQuery.isEmptyObject(booking.experiment)) {
                showError("<p>Please describe your experiment!!! <br> " +
                          "At least the fields in the <b>Basic</b> input tab.<p>");
                return
            }
        }

        let endpoint = null;

        if (booking.id) {
            endpoint = Api.urls.booking.update;
            if (booking.repeat_value != 'no' && modify_all === null) {
                showError("<p>Please select a value for input <b>Modify repeating</b>: " +
                          "<i>Only this</i> or <i>All upcoming</i>.")
                return
            }
        }
        else {
            // Only take into account repeat value when creating a new booking
            if (repeat_value != 'no') {
                try {
                    booking.repeat_stop = dateIsoFromValue('#booking-repeat-stopdate');
                }
                catch(err) {
                    showError("<p>Please provide a valid <b>Stop date</b> for the repeating event.")
                    return
                }
            }
            endpoint = Api.urls.booking.create;
        }

        if (has_calendar) {
            var error = validateBooking(booking, true);

            if (error != '') {
                showError(error);
                return;
            }
        }

        delete booking.resource;  // resource_id is enough
        // Set dates to ISO string
        booking.start = start.toISOString();
        booking.end = end.toISOString();

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
     * is clicked. It can be either Create or Update action.
     */
    function onDeleteButtonClick() {

        //if (last_booking.repeat_id && modify_all === null) {
        if (last_booking.repeat_value != 'no' && modify_all === null) {
                showError("<p>Please select a value for input <b>Modify repeating</b>: " +
                          "<i>Only this</i> or <i>All upcoming</i>.")
                return
        }

        let deleteInfo = {
            id: last_booking.id,
            modify_all: modify_all,
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
    }

    /** This function will be called when the Delete button in the Booking form
     * is clicked. It can be either Create or Update action.
     */
    function onCancelButtonClick() {
        let range = last_booking.original_range;

        if (range != null) {
            var event = calendar.getEventById( last_booking.id );
            event.setDates(range.start, range.end);
            calendar.render();
        }
    }

    function showExperimentForm() {
        var params = {form_id: 2};
        if (last_booking.experiment)
            params.form_values = JSON.stringify(last_booking.experiment);

        ajaxContent = get_ajax_content("experiment_form", params);

        ajaxContent.done(function(html) {
            $("#experiment-modal").html(html);
            $("#dynamic-btn-ok" ).click(function() {
                last_booking.experiment = getFormAsJson('dynamic-form');
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