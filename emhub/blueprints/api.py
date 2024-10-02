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
""" This module contains functions from the EMhub's REST API.

The REST API allows to operate with the underlying database entities.
There are functions to create, update, delete and retrieve existing elements.

This functions will be the channel between the `DataClient` in the client code
and the server `DataManager`.

"""

import os
import time
import json
from glob import glob
import datetime as dt
import traceback

import flask
from flask import request
from flask import current_app as app
import flask_login
import jwt

from emtools.utils import Pretty, Color
from emhub.utils import (datetime_from_isoformat, datetime_to_isoformat,
                         send_json_data, send_error)


api_bp = flask.Blueprint('api', __name__)


# ---------------------------- AUTH  ------------------------------------------

@api_bp.route('/login', methods=['POST'])
def login():
    """ Login a given user in the server.

    Arguments are expected coming in ``request.json``.

    Args:
        username: Username to login.
        password: password to login.

    """
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
    """ Logout previously logged user. """
    flask_login.logout_user()

    return send_json_data('OK')


# ---------------------------- USERS ------------------------------------------

@api_bp.route('/create_user', methods=['POST'])
@flask_login.login_required
def create_user():
    """ Create a new `User` in the system. """
    return handle_user(app.dm.create_user)


@api_bp.route('/register_user', methods=['POST'])
@flask_login.login_required
def register_user():
    def register(**attrs):
        email = attrs['email'].strip()
        user = app.dm.create_user(
            username=email,
            email=email,
            phone='',
            password=os.urandom(24).hex(),
            name=attrs['name'],
            roles=attrs['roles'],
            pi_id=attrs['pi_id'],
            status='active'
        )

        if app.mm:
            app.mm.send_mail(
                [user.email],
                "emhub: New account registered",
                flask.render_template('email/account_registered.txt',
                                      user=user))
        return user

    return handle_user(register)


@api_bp.route('/update_user', methods=['POST'])
@flask_login.login_required
def update_user():
    """ Update a given `User` in the system. """
    return handle_user(app.dm.update_user)


@api_bp.route('/delete_user', methods=['POST'])
@flask_login.login_required
def delete_user():
    """ Delete a `User` from the system. """
    return handle_user(app.dm.delete_user)


@api_bp.route('/update_user_form', methods=['POST'])
@flask_login.login_required
def update_user_form():
    try:
        f = request.form

        attrs = {'id': f['user-id'],
                 'name': f['user-name'],
                 'phone': f['user-phone'],
                 'status': f['user-status-select']
                 }

        roles = [v.replace('role-', '') for v in f if v.startswith('role-')]
        if roles:
            attrs['roles'] = roles

        if 'user-pi-select' in f:
            pi_id = int(f['user-pi-select'])
            if pi_id:
                attrs['pi_id'] = pi_id
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
    """ Create a new `Template`. """
    return handle_template(app.dm.create_template)


@api_bp.route('/get_templates', methods=['POST'])
@flask_login.login_required
def get_templates():
    """ Get a list of all existing templates. """
    return filter_request(app.dm.get_templates)


@api_bp.route('/update_template', methods=['POST'])
@flask_login.login_required
def update_template():
    """ Update an existing `Template`. """
    return handle_template(app.dm.update_template)


@api_bp.route('/delete_template', methods=['POST'])
@flask_login.login_required
def delete_template():
    """ Delete a given `Template`. """
    return handle_template(app.dm.delete_template)


@api_bp.route('/create_application', methods=['POST'])
@flask_login.login_required
def create_application():
    """ Create an `Application`. """
    return handle_application(app.dm.create_application)


@api_bp.route('/get_applications', methods=['POST'])
@flask_login.login_required
def get_applications():
    """ Get all applications. """
    return filter_request(app.dm.get_applications)


@api_bp.route('/update_application', methods=['POST'])
@flask_login.login_required
def update_application():
    """ Update an existing `Application`. """
    return handle_application(app.dm.update_application)


@api_bp.route('/delete_application', methods=['POST'])
@flask_login.login_required
def delete_application():
    """ Delete an `Application`. """
    return handle_application(app.dm.delete_application)


@api_bp.route('/import_application', methods=['POST'])
@flask_login.login_required
def import_application():
    try:
        if not request.is_json:
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
        traceback.print_exc()

        return send_error('ERROR from Server: %s' % e)


# ---------------------------- RESOURCES ---------------------------------------

@api_bp.route('/get_resources', methods=['POST'])
@flask_login.login_required
def get_resources():
    """ Retrieve existing resources. """
    return filter_request(app.dm.get_resources)


@api_bp.route('/create_resource', methods=['POST'])
@flask_login.login_required
def create_resource():
    """ Create a new `Resource`. """
    return handle_resource(app.dm.create_resource)


@api_bp.route('/update_resource', methods=['POST'])
@flask_login.login_required
def update_resource():
    """ Update a given `Resource`. """
    return handle_resource(app.dm.update_resource)


@api_bp.route('/delete_resource', methods=['POST'])
@flask_login.login_required
def delete_resource():
    """ Delete a `Resource`. """
    return handle_resource(app.dm.delete_resource)


# ---------------------------- BOOKINGS ---------------------------------------
@api_bp.route('/create_booking', methods=['POST'])
@flask_login.login_required
def create_booking():
    """ Create a new `Booking`. """
    def create(**attrs):
        check_min = request.json.get('check_min_booking', True)
        check_max = request.json.get('check_max_booking', True)
        return app.dm.create_booking(check_min_booking=check_min,
                                     check_max_booking=check_max,
                                     **attrs)

    return handle_booking('bookings_created', create)


@api_bp.route('/get_bookings', methods=['POST'])
@flask_login.login_required
def get_bookings():
    """ Retrieve existing bookings. """
    return filter_request(app.dm.get_bookings)


# Shortcut method to get a range of bookings, used by the Calendar
@api_bp.route('/get_bookings_range', methods=['POST'])
@flask_login.login_required
def get_bookings_range():
    """ Retrieve booking within a given time range.

    Args:
        start (str): Starting date (format "YYYY-MM-DD").
        end (str): Ending date (format "YYYY-MM-DD").
        func: Function used to process the booking, by default 'to_event'
    """
    d = dict(request.get_json(silent=True) or request.form)
    bookings = app.dm.get_bookings_range(
        datetime_from_isoformat(d['start']),
        datetime_from_isoformat(d['end'])
    )
    funcName = d.get('func', 'to_event')
    if funcName == 'to_event':
        func = app.dc.booking_to_event
    elif funcName == 'to_json':
        def to_json(b):
            return b.json()
        func = to_json
    else:
        raise Exception(f"Unknown function {funcName}")

    return send_json_data([func(b) for b in bookings])


@api_bp.route('/update_booking', methods=['POST'])
@flask_login.login_required
def update_booking():
    """ Update an existing `Booking`. """
    return handle_booking('bookings_updated', app.dm.update_booking)


@api_bp.route('/delete_booking', methods=['POST'])
@flask_login.login_required
def delete_booking():
    """ Delete an existing `Booking`. """
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
    # FIXME: this fuction is very old (used in SLL) and
    # FIXME: needs to be updated
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
            data = []
            for s in sessions:
                b = s.booking
                e = app.dc.booking_to_event(b)
                data.append({
                    'id': s.id,
                    'name': s.name,
                    'booking_id': s.booking_id,
                    'start': datetime_to_isoformat(s.start),
                    'user': _user(b.owner),
                    'pi': _user(b.owner.get_pi()),
                    'operator': _user(b.operator),
                    'folder': session_folders[s.name[:3]],
                    'title': e['title']
                 })
            return send_json_data(data)
        time.sleep(3)


@api_bp.route('/poll_active_sessions', methods=['POST'])
@flask_login.login_required
def poll_active_sessions():
    while True:
        dm = app.dm  # DataManager(app.instance_path, user=app.user)
        sessions = dm.get_sessions(condition='status=="active"')
        data = [s.json() for s in sessions if s.actions]
        if data:
            return send_json_data(data)
        time.sleep(5)
        dm.commit()


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


@api_bp.route('/clear_session_data', methods=['POST'])
@flask_login.login_required
def clear_session_data():
    return handle_session(app.dm.clear_session_data)


@api_bp.route('/get_session_data', methods=['POST'])
@flask_login.login_required
def get_session_data():
    """ Return some information related to session (e.g CTF values, etc). """
    def handle(session, **attrs):
        return app.dc.get_session_data(session, **attrs)

    return handle_session_data(handle, mode="r")

@api_bp.route('/update_session_extra', methods=['POST'])
def update_session_extra():
    """ Update only certain elements from the extra property. """
    def handle(**attrs):
        token = attrs.pop('token')
        worker = validate_worker_token(token)
        return app.dm.update_session_extra(**attrs)

    return handle_session(handle)


@api_bp.route('/get_session_users', methods=['POST'])
@flask_login.login_required
def get_session_users():

    def _user(u):
        return {'id': u.id, 'name': u.name, 'email': u.email} if u else {}

    def _session_users(**attrs):
        session = app.dm.get_session_by(id=attrs['id'])
        b = session.booking
        return {
            'owner': _user(b.owner),
            'operator': _user(b.operator),
            'creator': _user(b.creator),
            'group': app.dm.get_user_group(b.owner)
        }
    return _handle_item(_session_users, 'session_users')


def _loadFileLines(fn):
    lines = ''
    if os.path.exists(fn):
        for line in open(fn):
            lines += line

    return lines


@api_bp.route('/get_session_run', methods=['POST'])
@flask_login.login_required
def get_session_run():
    """
    This method will retrieve a run instance.
    Processing project can be loaded from a session_id
    or an entry_id
    """
    dm = app.dm

    def _get_run(**attrs):
        run = dm.get_processing_project(**attrs)['run']
        outputs = attrs.get('output', ['json'])
        results = {}

        if 'json' in outputs:
            results['json'] = {'values': run.getValues(),
                               'info': run.getInfo()}
            results['json'].update(run.getInputsOutputs())

        if 'stdout' in outputs:
            results['stdout'] = _loadFileLines(run.getStdOut())

        if 'stderr' in outputs:
            results['stderr'] = _loadFileLines(run.getStdError())

        if 'form' in outputs:
            results['form'] = run.getFormDefinition()

        return results

    return _handle_item(_get_run, 'run')


@api_bp.route("/get_classes2d", methods=['POST'])
def get_classes2d():
    """ Load 2d classification data. """
    kwargs = request.form.to_dict()
    run = app.dm.get_processing_project(**kwargs)['run']
    classes = run.get_classes2d(iteration=kwargs.get('iteration', None))
    return send_json_data(classes)


@api_bp.route("/get_file_info", methods=['POST'])
def get_file_info():
    """ Load 2d classification data. """
    kwargs = request.form.to_dict()
    project = app.dm.get_processing_project(**kwargs)['project']
    file_info = project.get_file_info(kwargs['path'])
    return send_json_data(file_info)


def get_worker_token(worker):
    return jwt.encode(
        {'worker': worker},
        app.config['SECRET_KEY'], algorithm='HS256')


def validate_worker_token(token):
    result = None
    try:
        token = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        result = token.get('worker', None)
    except:
        raise Exception("Invalid token for this worker")

    return result


@api_bp.post('/connect_worker')
@flask_login.login_required
def connect_worker():
    def _connect_worker(**attrs):
        worker = attrs['worker']
        specs = attrs['specs']
        app.dm.connect_worker(worker, specs)
        return get_worker_token(worker)

    return _handle_item(_connect_worker, 'token')

@api_bp.post('/create_task')
@flask_login.login_required
def create_task():
    def _create_task(**attrs):
        worker = attrs['worker']
        task = attrs['task']
        app.logger.debug(f"attrs: {attrs}")
        task_id = app.dm.get_worker_stream(worker).create_task(task)
        return {'id': task_id}

    return _handle_item(_create_task, 'task')

@api_bp.post('/delete_task')
@flask_login.login_required
def delete_task():
    def _delete_task(**attrs):
        worker = attrs['worker']
        dm = app.dm
        wstream = dm.get_worker_stream(worker)
        result = 0
        task_id = attrs['task_id']
        if task_id == 'all_done':
            done_days = attrs.get('days', 3)
            td = dt.timedelta(days=done_days)
            now = dm.now()
            for t in wstream.get_all_tasks():
                if t['status'] == 'done' or now - dm.get_task_lastupdate(t['id']) >= td:
                    result += wstream.delete_task(t['id'])

        elif task_id.startswith('<'):
            task_id.replace('<', '')
            for t in wstream.get_all_tasks():
                if t['id'] < task_id:
                    result += wstream.delete_task(t['id'])
        else:
            result = wstream.delete_task(task_id)
        return {'result': result}

    return _handle_item(_delete_task, 'task')


@api_bp.post('/update_task')
def update_task():
    def _update_task(**attrs):
        worker = validate_worker_token(attrs['token'])
        task_id = attrs['task_id']
        event = attrs['event']
        app.dm.get_worker_stream(worker, update=True).update_task(task_id, event)
        return {'result': 'OK'}

    return _handle_item(_update_task, 'task')


@api_bp.post('/get_new_tasks')
def get_new_tasks():
    """ This function will return tasks for a given worker when they
    are available. If not, it will be sleeping waiting for it.
    """
    def _get_new_tasks(**attrs):
        worker = validate_worker_token(attrs['token'])
        tasks = app.dm.get_worker_stream(worker, update=True).get_new_tasks()
        return tasks

    return _handle_item(_get_new_tasks, 'tasks')


@api_bp.post('/get_pending_tasks')
def get_pending_tasks():
    """ This function will return pending tasks for a given worker.
    A task is pending if it was claimed by the worker, but it has not been
    acknowledged as completed.
    """
    def _get_pending_tasks(**attrs):
        worker = validate_worker_token(attrs['token'])
        ws = app.dm.get_worker_stream(worker, update=True)
        tasks = [t for t in ws.get_all_tasks() if t['status'] == 'pending']
        return tasks

    return _handle_item(_get_pending_tasks, 'tasks')


@api_bp.post('/get_all_tasks')
def get_all_tasks():
    """ This function will return pending tasks for a given worker.
    A task is pending if it was claimed by the worker, but it has not been
    acknowledged as completed.
    """
    def _get_all_tasks(**attrs):
        worker = validate_worker_token(attrs['token'])
        all_tasks = []
        for w, tasks in app.dm.get_all_tasks():
            for t in tasks:
                # Add worker info
                t['worker'] = w
                all_tasks.append(t)

        return all_tasks

    return _handle_item(_get_all_tasks, 'tasks')


@api_bp.route('/get_workers', methods=['POST'])
@flask_login.login_required
def get_workers():
    def _user(u):
        return {'id': u.id, 'name': u.name, 'email': u.email} if u else {}

    def _workers(**attrs):
        return app.dc.get_workers()['workers']

    return _handle_item(app.dc.get_workers, 'workers')


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
    return filter_request(app.dm.get_forms)


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


@api_bp.route('/get_config', methods=['GET', 'POST'])
@flask_login.login_required
def get_config():
    def _get_config(**attrs):
        return app.dm.get_config(attrs['config'])

    return _handle_item(_get_config, 'config')


# ------------------------------ PROJECTS ---------------------------------

@api_bp.route('/get_projects', methods=['GET', 'POST'])
@flask_login.login_required
def get_projects():
    return filter_request(app.dm.get_projects)


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
    return filter_request(app.dm.get_entries)


@api_bp.route('/create_entry', methods=['POST'])
@flask_login.login_required
def create_entry():
    def handle(**attrs):
        fix_dates(attrs, 'date')
        entry = app.dm.create_entry(**attrs)
        save_entry_files(entry, entry.extra['data'])
        entry = app.dm.update_entry(id=entry.id, extra=entry.extra,
                                    validate=False)
        return entry.json()

    return _handle_item(handle, 'entry')


@api_bp.route('/update_entry', methods=['POST'])
@flask_login.login_required
def update_entry():
    def handle(**attrs):
        fix_dates(attrs, 'date', 'creation_date', 'last_update_date')
        entry = app.dm.get_entry_by(id=attrs['id'])
        old_files = set(app.dm.get_entry_files(entry))
        save_entry_files(entry, attrs['extra']['data'])
        # There is a validation about the entry type
        attrs['type'] = entry.type
        entry = app.dm.update_entry(**attrs)
        new_files = set(app.dm.get_entry_files(entry))
        clean_files(old_files - new_files)
        return entry.json()

    return _handle_item(handle, 'entry')


@api_bp.route('/delete_entry', methods=['POST'])
@flask_login.login_required
def delete_entry():
    def handle(**attrs):
        entry = app.dm.get_entry_by(id=attrs['id'])
        old_files = set(app.dm.get_entry_files(entry))
        entry = app.dm.delete_entry(**attrs)
        clean_files(old_files)
        return entry.json()

    return _handle_item(handle, 'entry')


# ------------------------------ PUCKS ---------------------------------

@api_bp.route('/get_pucks', methods=['GET', 'POST'])
@flask_login.login_required
def get_pucks():
    return filter_request(app.dm.get_pucks)


@api_bp.route('/create_puck', methods=['POST'])
@flask_login.login_required
def create_puck():
    return handle_puck(app.dm.create_puck)


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
            try:
                attrs[date_key] = datetime_from_isoformat(attrs[date_key])
            except:
                attrs[date_key] = None


def _handle_item(handle_func, result_key):
    try:
        if request.is_json:
            attrs = request.json['attrs']
        elif request.form:
            attrs = json.loads(request.form['attrs'])
        else:
            raise Exception("Expecting JSON or Form request.")
        result = handle_func(**attrs)
        return send_json_data({result_key: result})
    except Exception as e:
        print(e)
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


def handle_user(user_func):
    def handle(**attrs):
        fix_dates(attrs, 'created')
        return user_func(**attrs).json()

    return _handle_item(handle, 'user')


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
        r = resource_func(**attrs)

        for f in request.files:
            file = request.files[f]
            fn = file.filename
            if fn:
                # Clean up previous image files
                old_files = glob(app.dm.get_resource_image_path(r, '*'))
                clean_files(old_files)
                file.save(app.dm.get_resource_image_path(r, fn))
        return r.json()

    return _handle_item(handle, 'resource')


def handle_session(session_func):
    def handle(**attrs):
        fix_dates(attrs, 'start', 'end')
        return session_func(**attrs).json()

    return _handle_item(handle, 'session')


def handle_session_data(handle, mode="r"):
    attrs = request.json['attrs']
    session_id = attrs.pop("session_id")
    tries = 0

    while tries < 3:
        try:
            session = app.dm.get_session_by(id=session_id)
            result = handle(session, **attrs)
            break
        except OSError:
            print(f"Error with session (id={session_id})data, sleeping 3 secs")
            traceback.print_exc()
            time.sleep(3)
            result = {}
            tries += 1

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


def save_entry_files(entry, data):
    """ Function used when creating or updating an Entry.
    It will handle the upload of new files.
    """
    for f in request.files:
        file = request.files[f]

        fn = file.filename
        if fn:
            data[f] = fn
            file.save(app.dm.get_entry_path(entry, fn))


def clean_files(paths):
    for p in paths:
        if os.path.exists(p):
            os.remove(p)


def handle_puck(puck_func):
    def handle(**attrs):
        return puck_func(**attrs).json()

    return _handle_item(handle, 'puck')


def create_item(name):
    def handle(**attrs):
        create_func = getattr(app.dm, 'create_%s' % name)
        item = create_func(**attrs)
        # For created items let's just return back the id
        return {'id': item.id}

    return _handle_item(handle, name)
