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
import json
from glob import glob
import datetime as dt
import traceback

from flask import Blueprint, request, make_response
from flask import current_app as app

from emhub.utils import pretty_json, datetime_from_isoformat


api_bp = Blueprint('api', __name__)


# =============================== REST API ====================================

# ---------------------------- USERS ------------------------------------------
@api_bp.route('/create_user', methods=['POST'])
def create_user():
    attrs = request.json
    app.dm.create_user(**attrs)

    return send_json_data(-1)


@api_bp.route('/get_users', methods=['POST'])
def get_users():
    return filter_from_attrs(app.dm.get_users())


# ---------------------------- APPLICATIONS -----------------------------------
@api_bp.route('/create_template', methods=['POST'])
def create_template():
    return handle_template(app.dm.create_template)

@api_bp.route('/get_templates', methods=['POST'])
def get_templates():
    return send_json_data({'error': 'Not implemented'})


@api_bp.route('/update_template', methods=['POST'])
def update_template():
    return handle_template(app.dm.update_template)


@api_bp.route('/create_application', methods=['POST'])
def create_application():
    pass


@api_bp.route('/get_applications', methods=['POST'])
def get_applications():
    pass

# ---------------------------- BOOKINGS ---------------------------------------
@api_bp.route('/create_booking', methods=['POST'])
def create_booking():
    return handle_booking('bookings_created', app.dm.create_booking)


@api_bp.route('/update_booking', methods=['POST'])
def update_booking():
    return handle_booking('bookings_updated', app.dm.update_booking)


@api_bp.route('/delete_booking', methods=['POST'])
def delete_booking():
    # When deleting we don't need to send all info back, just ID
    def _transform(b):
        return {'id': b.id}

    return handle_booking('bookings_deleted', app.dm.delete_booking,
                          booking_transform=_transform)


@api_bp.route('/get_sessions', methods=['POST'])
def get_sessions():
    return filter_from_attrs(app.dm.get_sessions(asJson=True))


@api_bp.route('/create_session', methods=['POST'])
def create_session():
    pass


# -------------------- UTILS functions --------------------------

def send_json_data(data):
    resp = make_response(json.dumps(data))
    resp.status_code = 200
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp


def filter_from_attrs(items):
    attrs = None
    if request.json and 'attrs' in request.json:
        attrs = request.json['attrs'].split(',')

    if attrs:
        def _filter(s):
            return {k: v for k, v in s.items()
                    if not attrs or k in attrs}
        sessions = [_filter(s) for s in items]

    return send_json_data(sessions)


def _handle_item(handle_func, result_key):
    try:
        if not request.json:
            raise Exception("Expecting JSON request.")
        result = handle_func(**request.json['attrs'])
        return send_json_data({result_key: result})
    except Exception as e:
        print(e)
        return send_json_data({'error': 'Raised exception: %s' % e})


def handle_booking(result_key, booking_func, booking_transform=None):
    def handle(**attrs):
        def _fix_date(date_key):
            if date_key in attrs:
                attrs[date_key] = datetime_from_isoformat(attrs[date_key])

        _fix_date('start')
        _fix_date('end')

        if attrs.get('repeat_value', 'no') != 'no':
            _fix_date('repeat_stop')

        bt = booking_transform or app.dc.booking_to_event
        return [bt(b) for b in booking_func(**attrs)]

    return _handle_item(handle, result_key)


def handle_template(template_func):
    def handle(**attrs):
        return template_func(**attrs).json()

    return _handle_item(handle, 'template')