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

from flask import Blueprint, request, make_response
from flask import current_app as app

from emhub.utils import pretty_json, datetime_from_isoformat


api_bp = Blueprint('api', __name__)


# ------------------- REST API -----------------------------------
@api_bp.route('/create_user', methods=['POST'])
def create_user():
    attrs = request.json
    #utils.pretty_json(attrs)

    app.sm.create_user(**attrs)

    return send_json_data(-1)


@api_bp.route('/get_users', methods=['POST'])
def get_users():
    return filter_from_attrs(app.sm.get_users())


@api_bp.route('/create_booking', methods=['POST'])
def create_booking():
    try:
        if not request.json:
            raise Exception("Expecting JSON request.")
        pretty_json(request.json)
        attrs = request.json['attrs']
        attrs['start'] = datetime_from_isoformat(attrs['start'])
        attrs['end'] = datetime_from_isoformat(attrs['end'])
        booking = app.sm.create_booking(**attrs)
        return send_json_data({'booking': booking.to_event()})
    except Exception as e:
        print(e)
        return send_json_data({'error': 'Raised exception: %s' % e})


@api_bp.route('/get_sessions', methods=['POST'])
def get_sessions():
    return filter_from_attrs(app.sm.get_sessions(asJson=True))


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