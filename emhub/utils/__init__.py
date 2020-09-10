# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *
# * [1] SciLifeLab, Stockholm University
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

import json
import datetime as dt
import flask

from . import image


def pretty_json(d):
    print(json.dumps(d, indent=4))


def pretty_datetime(input_dt):
    if input_dt is None:
        return 'None'

    return input_dt.strftime("%d/%m/%Y %I:%M %p")


def datetime_from_isoformat(iso_string):
    """ Parse the input string and handle ending Z and assume UTC. """
    dt_string = iso_string.replace('Z', '+00:00').replace('+0000', '+00:00')

    return dt.datetime.fromisoformat(dt_string).replace(tzinfo=dt.timezone.utc)


def datetime_to_isoformat(input_dt):
    return input_dt.isoformat().replace('+00:00', 'Z')


def send_json_data(data):
    resp = flask.make_response(json.dumps(data))
    resp.status_code = 200
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp


def send_error(msg):
    return send_json_data({'error': msg})
