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

import flask
from flask import request
from flask import current_app as app


pages_bp = flask.Blueprint('pages', __name__)


@pages_bp.route("/", methods=['GET', 'POST'])
def index():
    if flask.request.method == 'GET':
        kwargs = flask.request.args.to_dict()
    else:
        kwargs = flask.request.form.to_dict()

    page_id = kwargs['page_id']

    params = {
        'page_id': page_id,
    }

    # Following params are required in main.html but are not really used
    # here in pages, maybe we should consider to have a separate template
    kwargs = {
        'possible_booking_owners': [],
        'possible_operators': [],
        'resources': [],
    }

    if app.user.is_authenticated:
        app.user.image = app.dc.user_profile_image(app.user)

    return flask.render_template("main.html",
                                 content_id='pages',
                                 params=params,
                                 is_devel=app.is_devel,
                                 version=app.version,
                                 emhub_title=app.config.get('EMHUB_TITLE', ''),
                                 **kwargs)


