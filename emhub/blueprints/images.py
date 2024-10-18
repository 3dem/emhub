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
import io
import base64
from PIL import Image, ImageEnhance, ImageOps, ImageFilter

import flask
from flask import request
from flask import current_app as app

from emhub.utils import send_json_data


images_bp = flask.Blueprint('images', __name__)


@images_bp.route("/static", methods=['GET', 'POST'])
def static():
    try:
        fn = request.args['filename']
        return app.send_static_file(os.path.join('images', fn))
    except FileNotFoundError:
        flask.abort(404)


@images_bp.route("/user_profile", methods=['GET', 'POST'])
def user_profile():
    try:
        user_id = request.args['user_id']
        user = app.dm.get_user_by(id=user_id)

        if user.profile_image is None:
            return app.send_static_file(os.path.join('images', 'user-icon.png'))

        return flask.send_from_directory(app.config["USER_IMAGES"],
                                         user.profile_image)
    except FileNotFoundError:
        flask.abort(404)


@images_bp.route("/get_mic_data", methods=['POST'])
def get_mic_data():
    """ Load micrograph data from a given micId.
    There are two ways where to retrieve micrograph data:
    1) From a session, where info from multiple runs.
        Input: micId, sessionId
    2) From a project, where info is taken from a run.
        Input: micId, projectId, runId
    """
    kwargs = request.form.to_dict()
    micId = int(kwargs['mic_id'])
    run = app.dm.get_processing_project(**kwargs)['run']
    mic = run.get_micrograph_data(micId)

    if 'coordinates' in mic:
        if not isinstance(mic['coordinates'], list):  # numpy arrays
            mic['coordinates'] = mic['coordinates'].tolist()
    else:
        mic['coordinates'] = []

    return send_json_data(mic)


@images_bp.route("/get_micrograph_gridsquare", methods=['POST'])
def get_micrograph_gridsquare():
    kwargs = request.form.to_dict()
    project = app.dm.get_processing_project(**kwargs)['project']
    data = project.get_micrograph_gridsquare(**kwargs)
    return send_json_data(data)


@images_bp.route("/get_volume_data", methods=['POST'])
def get_volume_data():
    """ Load volume data from a given run and output name.
    Input: projectId, runId, volName
    """
    dm = app.dm
    kwargs = request.form.to_dict()
    volName = kwargs['volName']
    axis = kwargs.get('axis', 'z')
    run = dm.get_processing_project(**kwargs)['run']
    vol = run.get_volume_data(volName, volume_data='slices', axis=axis)

    return send_json_data(vol)
