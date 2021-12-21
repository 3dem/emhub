# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *              Grigory Sharov (gsharov@mrc-lmb.cam.ac.uk) [2]
# *
# * [1] SciLifeLab, Stockholm University
# * [2] MRC Laboratory of Molecular Biology (MRC-LMB)
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# * This program is distributed in the hope that it will be useful,
# * but WITHOUT ANY WARRANTY; without even the implied warranty of
# * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# * GNU General Public License for more details.
# *
# * You should have received a copy of the GNU General Public License
# * along with this program; if not, write to the Free Software
# * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA
# * 02111-1307  USA
# *
# *  All comments concerning this program package may be sent to the
# *  e-mail address 'delarosatrevin@scilifelab.se'
# *
# **************************************************************************

import os
import time
import json
from glob import glob

import flask
from flask import request
from flask import current_app as app
import flask_login

from emhub.utils import (datetime_from_isoformat, datetime_to_isoformat,
                         send_json_data, send_error)
from emhub.data import DataContent


api_bp = flask.Blueprint('api', __name__)


# ---------------------------- AUTH  ------------------------------------------
@api_bp.route('/login', methods=['POST'])
def login():
    username = request.json['username']
    password = request.json['password']

    user = app.dm.get_user_by(username=username)
    if user is None or not user.check_password(password):
        return send_error('Invalid username or password')

    flask_login.login_user(user)

    return send_json_data('OK')


@api_bp.route('/logout', methods=['POST'])
@flask_login.login_required
def logout():
    flask_login.logout_user()

    return send_json_data('OK')


# ---------------------------- USERS ------------------------------------------
@api_bp.route('/create_user', methods=['POST'])
@flask_login.login_required
def create_user():
    return create_item('user')


@api_bp.route('/update_user', methods=['POST'])
@flask_login.login_required
def update_user():
    try:
        f = request.form

        attrs = {'id': f['user-id'],
                 'name': f['user-name'],
                 'phone': f['user-phone']
                 }

        roles = [v.replace('role-', '') for v in f if v.startswith('role-')]
        if roles:
            attrs['roles'] = roles

        if 'user-pi-select' in f:
            attrs['pi_id'] = int(f['user-pi-select'])
            # TODO: Validate if a user is not longer PI
            # check that there are not other users referencing this one as pi
            # still this will not be a very common case

        password = f['user-password'].strip()
        if password:
            attrs['password'] = password

        if 'user-profile-image' in request.files:
            profile_image = request.files['user-profile-image']

            if profile_image.filename:
                _, ext = os.path.splitext(profile_image.filename)

                if ext.lstrip(".").upper() not in app.config["ALLOWED_IMAGE_EXTENSIONS"]:
                    return send_error("Image format %s is not allowed!" % ext.upper())
                else:
                    image_name = 'profile-image-%06d%s' % (int(f['user-id']), ext)
                    image_path = os.path.join(app.config['USER_IMAGES'], image_name)
                    profile_image.save(image_path)
                    attrs['profile_image'] = image_name

        app.dm.update_user(**attrs)

        return send_json_data({'user': attrs})

    except Exception as e:
        print(e)
        return send_error('ERROR from Server: %s' % e)


@api_bp.route('/get_users', methods=['POST'])
@flask_login.login_required
def get_users():
    return filter_request(app.dm.get_users)


# ---------------------------- APPLICATIONS -----------------------------------
@api_bp.route('/create_template', methods=['POST'])
@flask_login.login_required
def create_template():
    return handle_template(app.dm.create_template)


@api_bp.route('/get_templates', methods=['POST'])
@flask_login.login_required
def get_templates():
    return filter_request(app.dm.get_templates)


@api_bp.route('/update_template', methods=['POST'])
@flask_login.login_required
def update_template():
    return handle_template(app.dm.update_template)


@api_bp.route('/delete_template', methods=['POST'])
@flask_login.login_required
def delete_template():
    return handle_template(app.dm.delete_template)


@api_bp.route('/create_application', methods=['POST'])
@flask_login.login_required
def create_application():
    return send_error('create_application NOT IMPLEMENTED')


@api_bp.route('/get_applications', methods=['POST'])
@flask_login.login_required
def get_applications():
    return filter_request(app.dm.get_applications)


@api_bp.route('/update_application', methods=['POST'])
@flask_login.login_required
def update_application():
    return handle_application(app.dm.update_application)


@api_bp.route('/import_application', methods=['POST'])
@flask_login.login_required
def import_application():
    try:
        if not request.json:
            raise Exception("Expecting JSON request.")

        orderCode = request.json['code'].upper()

        dm = app.dm

        application = dm.get_application_by(code=orderCode)

        if application is not None:
            raise Exception('Application %s already exist' % orderCode)

        orderJson = app.sll_pm.fetchOrderDetailsJson(orderCode)

        if orderJson is None:
            raise Exception('Invalid application ID %s' % orderCode)

        piEmail = orderJson['owner']['email'].lower()
        # orderId = orderJson['identifier']

        pi = dm.get_user_by(email=piEmail)

        if pi is None:
            raise Exception("Order owner email (%s) not found as PI" % piEmail)

        if orderJson['status'] not in ['accepted', 'processing']:
            raise Exception("Only applications with status 'accepted' or "
                            "'processing' can be imported. ")

        fields = orderJson['fields']
        description = fields.get('project_des', None)
        invoiceRef = fields.get('project_invoice_addess', None)

        created = datetime_from_isoformat(orderJson['created'])
        pi_list = fields.get('pi_list', [])

        form = orderJson['form']
        iuid = form['iuid']

        # Check if the given form (here templates) already exist
        # or we need to create a new one
        orderTemplate = None
        templates = dm.get_templates()
        for t in templates:
            if t.extra.get('portal_iuid', None) == iuid:
                orderTemplate = t
                break

        if orderTemplate is None:
            orderTemplate = dm.create_template(
                title=form['title'],
                status='active',
                extra={'portal_iuid': iuid}
            )
            dm.commit()

        application = dm.create_application(
            code=orderCode,
            title=orderJson['title'],
            created=created,  # datetime_from_isoformat(o['created']),
            status='active',
            description=description,
            creator_id=pi.id,
            template_id=orderTemplate.id,
            invoice_reference=invoiceRef or 'MISSING_INVOICE_REF',
        )

        for piTuple in pi_list:
            piEmail = piTuple[1].lower()
            pi = dm.get_user_by(email=piEmail)
            if pi is not None:
                application.users.append(pi)

        dm.commit()

        return send_json_data({'application': application.json()})

    except Exception as e:
        print(e)
        import traceback
        traceback.print_exc()

        return send_error('ERROR from Server: %s' % e)


# ---------------------------- RESOURCES ---------------------------------------
@api_bp.route('/get_resources', methods=['POST'])
@flask_login.login_required
def get_resources():
    return filter_request(app.dm.get_resources)


@api_bp.route('/update_resource', methods=['POST'])
@flask_login.login_required
def update_resource():
    return handle_resource(app.dm.update_resource)

# ---------------------------- BOOKINGS ---------------------------------------

@api_bp.route('/create_booking', methods=['POST'])
@flask_login.login_required
def create_booking():
    def create(**attrs):
        check_min = request.json.get('check_min_booking')
        check_max = request.json.get('check_max_booking')
        return app.dm.create_booking(check_min_booking=check_min,
                                     check_max_booking=check_max,
                                     **attrs)

    return handle_booking('bookings_created', create)


@api_bp.route('/get_bookings', methods=['POST'])
@flask_login.login_required
def get_bookings():
    return filter_request(app.dm.get_bookings)


# Shortcut method to get a range of bookings, used by the Calendar
@api_bp.route('/get_bookings_range', methods=['POST'])
@flask_login.login_required
def get_bookings_range():
    d = request.json or request.form
    bookings = app.dm.get_bookings_range(
        datetime_from_isoformat(d['start']),
        datetime_from_isoformat(d['end'])
    )
    func = app.dc.booking_to_event
    return send_json_data([func(b) for b in bookings])


@api_bp.route('/update_booking', methods=['POST'])
@flask_login.login_required
def update_booking():
    return handle_booking('bookings_updated', app.dm.update_booking)


@api_bp.route('/delete_booking', methods=['POST'])
@flask_login.login_required
def delete_booking():
    # When deleting we don't need to send all info back, just ID
    def _transform(b):
        return {'id': b.id}

    return handle_booking('bookings_deleted', app.dm.delete_booking,
                          booking_transform=_transform)


# ---------------------------- SESSIONS ---------------------------------------

@api_bp.route('/get_sessions', methods=['POST'])
@flask_login.login_required
def get_sessions():
    return filter_request(app.dm.get_sessions)


@api_bp.route('/poll_sessions', methods=['POST'])
@flask_login.login_required
def poll_sessions():
    session_folders = app.dm.get_session_folders()

    def _user(u):
        if not u:
            return {}
        else:
            return {'name': u.name,
                    'email': u.email
                    }

    while True:
        sessions = app.dm.get_sessions(condition='status=="pending"')
        if sessions:
            for s in sessions:
                b = s.booking
                e = app.dc.booking_to_event(b)
                data = [{
                    'id': s.id,
                    'name': s.name,
                    'booking_id': s.booking_id,
                    'start': datetime_to_isoformat(s.start),
                    'user': _user(b.owner),
                    'pi': _user(b.owner.get_pi()),
                    'operator': _user(b.operator),
                    'folder': session_folders[s.name[:3]],
                    'title': e['title']
                 }]
                return send_json_data(data)
        time.sleep(3)

@api_bp.route('/create_session', methods=['POST'])
@flask_login.login_required
def create_session():
    return handle_session(app.dm.create_session)


@api_bp.route('/update_session', methods=['POST'])
@flask_login.login_required
def update_session():
    return handle_session(app.dm.update_session)


@api_bp.route('/delete_session', methods=['POST'])
@flask_login.login_required
def delete_session():
    return handle_session(app.dm.delete_session)


@api_bp.route('/load_session', methods=['POST'])
@flask_login.login_required
def load_session():
    return handle_session(app.dm.load_session)


@api_bp.route('/create_session_set', methods=['POST'])
@flask_login.login_required
def create_session_set():
    """ Create a set file without actual session. """
    def handle(session, set_id, **attrs):
        session.data.create_set(set_id, attrs)
        session.data.close()
        return {'session_set': {}}

    return handle_session_data(handle, mode="a")


@api_bp.route('/add_session_item', methods=['POST'])
@flask_login.login_required
def add_session_item():
    """ Add a new item. """
    def handle(session, set_id, **attrs):
        itemId = attrs.pop("item_id")
        session.data.add_set_item(set_id, itemId, attrs)
        session.data.close()
        return {'item': {}}

    return handle_session_data(handle, mode="a")


@api_bp.route('/update_session_item', methods=['POST'])
@flask_login.login_required
def update_session_item():
    """ Update existing item. """
    def handle(session, set_id, **attrs):
        itemId = attrs.pop("item_id")
        session.data.update_item(set_id, itemId, attrs)
        session.data.close()
        return {'item': {}}

    return handle_session_data(handle, mode="a")


@api_bp.route('/get_session_data', methods=['POST'])
@flask_login.login_required
def get_session_data():
    """ Return some information related to session (e.g CTF values, etc). """
    def handle(session, set_id, **attrs):
        result = DataContent(app).get_session_data(session)
        session.data.close()
        return result

    return handle_session_data(handle, mode="r")


# ---------------------------- INVOICE PERIODS --------------------------------

@api_bp.route('/get_invoice_periods', methods=['POST'])
@flask_login.login_required
def get_invoice_periods():
    return filter_request(app.dm.get_invoice_periods)


@api_bp.route('/create_invoice_period', methods=['POST'])
@flask_login.login_required
def create_invoice_period():
    return handle_invoice_period(app.dm.create_invoice_period)


@api_bp.route('/update_invoice_period', methods=['POST'])
@flask_login.login_required
def update_invoice_period():
    return handle_invoice_period(app.dm.update_invoice_period)


@api_bp.route('/delete_invoice_period', methods=['POST'])
@flask_login.login_required
def delete_invoice_period():
    return handle_invoice_period(app.dm.delete_invoice_period)


# ------------------------------ TRANSACTIONS ---------------------------------

@api_bp.route('/get_transactions', methods=['POST'])
@flask_login.login_required
def get_transactions():
    return filter_request(app.dm.get_transactions)


@api_bp.route('/create_transaction', methods=['POST'])
@flask_login.login_required
def create_transaction():
    return handle_transaction(app.dm.create_transaction)


@api_bp.route('/update_transaction', methods=['POST'])
@flask_login.login_required
def update_transaction():
    return handle_transaction(app.dm.update_transaction)


@api_bp.route('/delete_transaction', methods=['POST'])
@flask_login.login_required
def delete_transaction():
    return handle_transaction(app.dm.delete_transaction)


# ------------------------------ FORMS ---------------------------------

@api_bp.route('/get_forms', methods=['GET', 'POST'])
@flask_login.login_required
def get_forms():
    return send_json_data([f.json() for f in app.dm.get_forms()])


@api_bp.route('/create_form', methods=['POST'])
@flask_login.login_required
def create_form():
    return handle_form(app.dm.create_form)


@api_bp.route('/update_form', methods=['POST'])
@flask_login.login_required
def update_form():
    return handle_form(app.dm.update_form)


@api_bp.route('/delete_form', methods=['POST'])
@flask_login.login_required
def delete_form():
    return handle_form(app.dm.delete_form)


# ------------------------------ PROJECTS ---------------------------------

@api_bp.route('/get_projects', methods=['GET', 'POST'])
@flask_login.login_required
def get_projects():
    return send_json_data([p.json() for p in app.dm.get_projects()])


@api_bp.route('/create_project', methods=['POST'])
@flask_login.login_required
def create_project():
    return handle_project(app.dm.create_project)


@api_bp.route('/update_project', methods=['POST'])
@flask_login.login_required
def update_project():
    return handle_project(app.dm.update_project)


@api_bp.route('/delete_project', methods=['POST'])
@flask_login.login_required
def delete_project():
    return handle_project(app.dm.delete_project)

# ------------------------------ ENTRIES ---------------------------------

@api_bp.route('/get_entries', methods=['GET', 'POST'])
@flask_login.login_required
def get_entries():
    return send_json_data([p.json() for p in app.dm.get_entries()])


@api_bp.route('/create_entry', methods=['POST'])
@flask_login.login_required
def create_entry():
    return handle_entry(app.dm.create_entry, copy_entry_files)


@api_bp.route('/update_entry', methods=['POST'])
@flask_login.login_required
def update_entry():
    return handle_entry(app.dm.update_entry, copy_entry_files)


@api_bp.route('/delete_entry', methods=['POST'])
@flask_login.login_required
def delete_entry():
    return handle_entry(app.dm.delete_entry)

# ------------------------------ ENTRIES ---------------------------------

@api_bp.route('/get_entries', methods=['GET', 'POST'])
@flask_login.login_required
def get_pucks():
    return send_json_data([p.json() for p in app.dm.get_pucks()])


@api_bp.route('/create_puck', methods=['POST'])
@flask_login.login_required
def create_puck():
    return handle_puck(app.dm.create_puck,)


@api_bp.route('/update_puck', methods=['POST'])
@flask_login.login_required
def update_puck():
    return handle_puck(app.dm.update_puck)


@api_bp.route('/delete_puck', methods=['POST'])
@flask_login.login_required
def delete_puck():
    return handle_puck(app.dm.delete_puck)

# -------------------- UTILS functions ----------------------------------------

def filter_request(func):
    condition = request.json.get('condition', None)
    orderBy = request.json.get('orderBy', None)

    items = func(condition=condition, orderBy=orderBy,
                 asJson=True)

    if 'attrs' in request.json:
        attrs = request.json['attrs']

        def _filter(s):
            return {k: v for k, v in s.items()
                    if not attrs or k in attrs}
        items = [_filter(s) for s in items]

    return send_json_data(items)

def fix_dates(attrs, *date_keys):
    """ Convert the values from UTC string to datetime
    for some keys that might be present in the attrs dict. """
    for date_key in date_keys:
        if date_key in attrs:
            attrs[date_key] = datetime_from_isoformat(attrs[date_key])


def _handle_item(handle_func, result_key):
    try:
        if request.json:
            attrs = request.json['attrs']
        elif request.form:
            attrs = json.loads(request.form['attrs'])
        else:
            raise Exception("Expecting JSON or Form request.")
        result = handle_func(**attrs)
        return send_json_data({result_key: result})
    except Exception as e:
        print(e)
        import traceback
        traceback.print_exc()
        return send_error('ERROR from Server: %s' % e)


def handle_booking(result_key, booking_func, booking_transform=None):
    def handle(**attrs):
        dates = ['start', 'end']

        if attrs.get('repeat_value', 'no') != 'no':
            dates.append('repeat_stop')

        fix_dates(attrs, *dates)

        bt = booking_transform or app.dc.booking_to_event
        return [bt(b) for b in booking_func(**attrs)]

    return _handle_item(handle, result_key)


def handle_template(template_func):
    def handle(**attrs):
        return template_func(**attrs).json()

    return _handle_item(handle, 'template')


def handle_application(application_func):
    def handle(**attrs):
        return application_func(**attrs).json()

    return _handle_item(handle, 'application')


def handle_resource(resource_func):
    def handle(**attrs):
        return resource_func(**attrs).json()

    return _handle_item(handle, 'resource')


def handle_session(session_func):
    def handle(**attrs):
        fix_dates(attrs, 'start', 'end')
        return session_func(**attrs).json()

    return _handle_item(handle, 'session')


def handle_session_data(handle, mode="r"):
    attrs = request.json['attrs']
    session_id = attrs.pop("session_id")
    set_id = attrs.pop("set_id", 1)

    session = app.dm.load_session(sessionId=session_id, mode=mode)
    result = handle(session, set_id, **attrs)

    return send_json_data(result)


def handle_invoice_period(invoice_period_func):
    def handle(**attrs):
        fix_dates(attrs, 'start', 'end')
        return invoice_period_func(**attrs).json()

    return _handle_item(handle, 'invoice_period')


def handle_transaction(transaction_func):
    def handle(**attrs):
        fix_dates(attrs, 'date')
        return transaction_func(**attrs).json()

    return _handle_item(handle, 'transaction')


def handle_form(form_func):
    def handle(**attrs):
        return form_func(**attrs).json()

    return _handle_item(handle, 'form')


def handle_project(project_func):
    def handle(**attrs):
        fix_dates(attrs, 'date')
        return project_func(**attrs).json()

    return _handle_item(handle, 'project')


def copy_entry_files(attrs):
    """ Function used when creating or updating an Entry.
    It will handle the upload of new files.
    """
    data = attrs['extra']['data']

    from pprint import pprint
    pprint(data)

    def _path(key):
        base = 'entry-file-%06d-%s' % (int(attrs['id']), key)
        return os.path.join(app.config['ENTRY_FILES'], base)

    def _file(key, fn):
        _, ext = os.path.splitext(fn)
        return _path(key) + ext

    def _clean(key):
        """ Clean all previous files starting with that key. """
        for fn in glob(_path(key) + '.*'):
            os.remove(fn)

    for f in request.files:
        file = request.files[f]

        fn = file.filename
        if fn:
            _clean(f)
            data[f] = fn
            file.save(_file(f, fn))

    for key in data:
        if isinstance(data[key], str) and data[key].startswith('DELETE:'):
            _clean(key)
            data[key] = ''


def handle_entry(entry_func, files_func=None):
    def handle(**attrs):
        fix_dates(attrs, 'date')
        entry = entry_func(**attrs).json()
        attrs['id'] = entry['id']
        if files_func:
            files_func(attrs)

        return entry

    return _handle_item(handle, 'entry')


def handle_puck(entry_func):
    def handle(**attrs):
        return entry_func(**attrs).json()

    return _handle_item(handle, 'entry')


def create_item(name):
    def handle(**attrs):
        create_func = getattr(app.dm, 'create_%s' % name)
        item = create_func(**attrs)
        # For created items let's just return back the id
        return {'id': item.id}

    return _handle_item(handle, name)
