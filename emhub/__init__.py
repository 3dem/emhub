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

import flask
import flask_login

from . import utils
from .api import send_json_data, api_bp
from .utils import datetime_to_isoformat, pretty_datetime
from .data.data_content import DataContent


here = os.path.abspath(os.path.dirname(__file__))
templates = [os.path.basename(f) for f in glob(os.path.join(here, 'templates', '*.html'))]


def create_app(test_config=None):
    # create and configure the app
    app = flask.Flask(__name__, instance_relative_config=True)
    app.register_blueprint(api_bp, url_prefix='/api')

    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
    app.config.from_mapping(SECRET_KEY='dev')
    dbPath = os.path.join(app.instance_path, 'emhub.sqlite')

    if test_config is None:
        # load the instance config, if it exists, when not testing
        app.config.from_pyfile('config.py', silent=True)
    else:
        # load the test config if passed in
        app.config.from_mapping(test_config)

    # ensure the instance folder exists
    try:
        os.makedirs(app.instance_path)
    except OSError:
        pass

    # Define some content_id list that does not requires login
    NO_LOGIN_CONTENT = ['users-list']

    @app.route('/main', methods=['GET', 'POST'])
    def main():
        if flask.request.method == 'GET':
            content_id = flask.request.args.get('content_id', 'empty')
        else:
            content_id = flask.request.form['content_id']

        if not app.user.is_authenticated:
            kwargs = {'content_id': 'user-login', 'next_content': content_id}
        else:
            if content_id == 'user-login':
                content_id = 'booking-calendar'
            kwargs = {'content_id': content_id}

        return flask.render_template('main.html', **kwargs)

    @app.route('/', methods=['GET', 'POST'])
    @app.route('/index', methods=['GET', 'POST'])
    def index():
        return flask.redirect(flask.url_for('main', content_id='welcome'))

    @app.route('/login', methods=['GET'])
    def login():
        """ This view will called when the user lands in the login page (GET)
        and also when login credentials are submitted (POST).
        """
        next_content = flask.request.args.get('next_content', 'empty')
        return flask.redirect(flask.url_for('main',
                                            content_id=next_content))

    @app.route('/do_login', methods=['POST'])
    def do_login():
        """ This view will called as POST from the user login page. """
        username = flask.request.form['username']
        password = flask.request.form['password']
        next_content = flask.request.form.get('next_content', 'index')

        user = app.dm.get_user_by(username=username)

        if user is None or not user.check_password(password):
            flask.flash('Invalid username or password')
            return flask.redirect(flask.url_for('login'))

        flask_login.login_user(user)

        if next_content == 'user-login':
            next_content = 'booking-calendar'
        print("logged user: %s, next_content: %s" % (username, next_content))
        return flask.redirect(flask.url_for('main', content_id=next_content))

    @app.route('/logout', methods=['GET', 'POST'])
    def do_logout():
        flask_login.logout_user()
        return flask.redirect(flask.url_for('index'))

    @app.route('/get_mic_thumb', methods=['POST'])
    def get_mic_thumb():
        micId = int(flask.request.form['micId'])
        sessionId = int(flask.request.form['sessionId'])
        session = app.dm.load_session(sessionId)
        setObj = session.data.get_sets()[0]
        mic = session.data.get_item(setObj['id'], micId,
                                    dataAttrs=['micThumbData',
                                               'psdData',
                                               'shiftPlotData'])

        return send_json_data(mic._asdict())

    @app.route('/get_content', methods=['POST'])
    def get_content():
        content_kwargs = flask.request.form.to_dict()
        content_id = content_kwargs['content_id']
        print("get_content params: ")
        for k, v in content_kwargs.items():
            print("  %s = %s" % (k, v))

        if content_id in NO_LOGIN_CONTENT or app.user.is_authenticated:
            kwargs = app.dc.get(**content_kwargs)
        else:
            kwargs = {'next_content': content_id}
            content_id = 'user-login'

        content_template = content_id + '.html'

        if content_template in templates:
            return flask.render_template(content_template, **kwargs)

        return "<h1>Template '%s' not found</h1>" % content_template

    @app.template_filter('basename')
    def basename(filename):
        """Convert a string to all caps."""
        return os.path.basename(filename)

    app.jinja_env.filters['reverse'] = basename
    app.jinja_env.filters['pretty_datetime'] = pretty_datetime

    from emhub.data.data_manager import DataManager
    app.user = flask_login.current_user
    app.dm = DataManager(dbPath, user=app.user)
    app.dc = DataContent(app)

    login_manager = flask_login.LoginManager()
    login_manager.login_view = 'login'
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return app.dm.get_user_by(id=int(user_id))

    @app.teardown_appcontext
    def shutdown_session(exception=None):
        app.dm.close()

    return app
