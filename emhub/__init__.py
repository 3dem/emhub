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
import datetime
import os
import sys
from glob import glob


__version__ = '1.0.2'


def create_app(test_config=None):
    import flask
    import flask_login
    import jinja2
    import importlib.util

    from . import utils
    from .blueprints import api_bp, images_bp, pages_bp
    from .utils import (datetime_to_isoformat,
                        pretty_date, pretty_datetime, pretty_quarter,
                        send_json_data, send_error, shortname, pairname)
    from .utils.mail import MailManager

    from emtools.utils import Pretty

    # create and configure the app
    emhub_instance_path = os.environ.get('EMHUB_INSTANCE', None)

    app = flask.Flask(__name__,
                      instance_path=emhub_instance_path,
                      instance_relative_config=True)

    def load_module(module_name):
        """ Allow to load a Python module from path for extending EMhub."""
        module_path = os.path.join(emhub_instance_path, 'extra', module_name) + '.py'
        if os.path.exists(module_path):
            spec = importlib.util.spec_from_file_location(module_name, module_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        return None

    extra_api = load_module('api')
    if extra_api and 'extend_api' in dir(extra_api):
        print(f"Extending api from: {extra_api.__file__}")
        extra_api.extend_api(api_bp)

    app.register_blueprint(api_bp, url_prefix='/api')
    app.register_blueprint(images_bp, url_prefix='/images')
    app.register_blueprint(pages_bp, url_prefix='/pages')

    ####
    # config specified here can be overridden by the config file

    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
    app.config['SECRET_KEY'] = 'dev'

    app.config["IMAGES"] = os.path.join(app.instance_path, 'images')
    app.config["USER_IMAGES"] = os.path.join(app.config["IMAGES"], 'user')
    app.config["ENTRY_FILES"] = os.path.join(app.instance_path, 'entry_files')
    app.config["RESOURCE_FILES"] = os.path.join(app.instance_path, 'resource_files')
    app.config["ALLOWED_IMAGE_EXTENSIONS"] = ["JPEG", "JPG", "PNG", "GIF"]
    app.config["SESSIONS"] = os.path.join(app.instance_path, 'sessions')
    app.config["PAGES"] = os.path.join(app.instance_path, 'pages')

    if test_config is None:
        # load the instance config, if it exists, when not testing
        app.config.from_pyfile('config.py', silent=True)
    else:
        # load the test config if passed in
        app.config.from_mapping(test_config)

    app.use_ldap = app.config.get('EMHUB_AUTH', 'local') == 'LDAP'

    # From this point on, any config items specified override conflicting
    # settings from the config file.

    portalAPI = app.config.get('SLL_PORTAL_API', None)
    if portalAPI is not None:
        from .data.imports.scilifelab import PortalManager
        app.sll_pm = PortalManager(portalAPI, cache=False)

    # ensure the instance folder exists
    os.makedirs(app.config['USER_IMAGES'], exist_ok=True)
    os.makedirs(app.config['ENTRY_FILES'], exist_ok=True)
    os.makedirs(app.config['RESOURCE_FILES'], exist_ok=True)
    os.makedirs(app.config['SESSIONS'], exist_ok=True)
    os.makedirs(app.config['PAGES'], exist_ok=True)

    # Define some content_id list that does not requires login
    NO_LOGIN_CONTENT = ['users_list',
                        'user_reset_password',
                        'pages']

    # Allow to define customized templates in the instance folder
    # templates should be in: 'extra/templates'
    # and will take precedence from the ones in the emhub/template folder
    here = os.path.abspath(os.path.dirname(__file__))
    emhub_instance_extra = os.path.join(emhub_instance_path, 'extra')
    template_folders = [os.path.join(emhub_instance_extra, 'templates'),
                        os.path.join(here, 'templates')]

    templates = []
    for folder in template_folders:
        templates.extend([os.path.basename(f) for f in glob(os.path.join(folder, '*.html'))])

    app.logger.debug("Template folders: %s" % template_folders)

    app.jinja_loader = jinja2.FileSystemLoader(template_folders)

    def register_basic_params(kwargs):
        kwargs['is_devel'] = app.is_devel
        kwargs['version'] = __version__
        kwargs['emhub_title'] = app.config.get('EMHUB_TITLE', '')

        kwargs['possible_booking_owners'] = app.dc.get_pi_labs()
        kwargs['possible_operators'] = app.dc.get_possible_operators()
        kwargs['booking_types'] = app.dm.Booking.TYPES
        kwargs['currency'] = app.dm.get_config('resources').get('currency', '$')
        try:
            display = app.dm.get_config('bookings')['display']
            kwargs['show_application'] = display['show_application']
        except:
            kwargs['show_application'] = False
        if 'resources' not in kwargs:
            kwargs['resources'] = app.dc.get_resources(image=True)['resources']

    @app.route('/main', methods=['GET', 'POST'])
    def main():
        if flask.request.method == 'GET':
            params = flask.request.args.to_dict()
        else:
            params = flask.request.form.to_dict()

        content_id = params.pop('content_id', 'empty')
        kwargs = {'content_id': content_id,
                  'params': params
                  }

        dm = app.dm  # shortcut

        # Special case to load a processing project
        # PROCESSING_PROJECT = 1 should be in config.py
        # this will login admin by default and also redirect to
        # the flowchart page template
        if processing := app.config.get('PROCESSING_PROJECT', None):
            params['login_user'] = 1  # admin
            kwargs['content_id'] = 'processing_flowchart'
            kwargs['params'] = {'path': processing}

        if 'login_user' in params and app.is_devel:
            user_id = params['login_user']
            user = dm.get_user_by(id=user_id)
            if user is None:
                return send_error("Invalid user id: '%s'" % user_id)
            elif user != app.user:
                flask_login.logout_user()
                flask_login.login_user(user)

        if app.user.is_authenticated:
            if content_id == 'user_login':  # Redirects to Dashboard by default
                kwargs['content_id'] = 'dashboard'
            app.user.image = app.dc.user_profile_image(app.user)
            kwargs['view_usage_report'] = dm.check_user_access('usage_report')
        else:
            if content_id not in NO_LOGIN_CONTENT:
                kwargs = {'content_id': 'user_login',
                          'next_content': content_id,
                          'params': {}}

        register_basic_params(kwargs)

        return flask.render_template("main.html", **kwargs)

    def _redirect(endpoint, **kwargs):
        return flask.redirect(flask.url_for(endpoint, _external=True, **kwargs))

    @app.route('/', methods=['GET', 'POST'])
    @app.route('/index', methods=['GET', 'POST'])
    def index():
        # return _redirect('pages.index', page_id='welcome')
        return _redirect('login')

    @app.route('/login', methods=['GET'])
    def login():
        """ This view will be called when the user lands in the login page (GET)
        and also when login credentials are submitted (POST).
        """
        next_content = flask.request.args.get('next_content', 'dashboard')
        return _redirect('main', content_id=next_content)

    @app.route('/do_login', methods=['POST'])
    def do_login():
        """ This view will be called as POST from the user login page. """
        username = flask.request.form['username']
        password = flask.request.form['password']
        next_content = flask.request.form.get('next_content', 'index')
        authenticated = None
        user = None

        if not app.config.get('CASE_SENSITIVE_USERNAMES', True):
            username = username.lower()

        user = app.dm.get_user_by(username=username)

        if user:  # First check that the user in the db, then try to authenticate

            auth_local = user.auth_local or not app.use_ldap

            if auth_local:
                if not user.check_password(password):
                    user = None
            else:
                response = ldap_manager.authenticate(username, password)
                # Specifics are configurable.  That information is not presently used.
                if response.status != flask_ldap3_login.AuthenticationResponseStatus.success:
                    user = None  # Failed authentication

        if not user:
            flask.flash('Invalid username or password')
            return _redirect('login')

        flask_login.login_user(user)

        if next_content == 'user_login':
            next_content = 'dashboard'
        return _redirect('main', content_id=next_content)

    @app.route('/do_switch_login', methods=['POST'])
    @flask_login.login_required
    def do_switch_login():
        """ This view will be called as POST from a currently logged admin user.
         It will allow admins to login as another users for troubleshooting.
        """
        if not app.user.is_admin:
            return send_error("Current user is not admin!")

        username = flask.request.json['username']

        user = app.dm.get_user_by(username=username)
        if user is None:
            return send_error("Invalid username: '%s'" % username)

        flask_login.logout_user()
        flask_login.login_user(user)

        return send_json_data({'user': user.id})

    @app.route('/logout', methods=['GET', 'POST'])
    def do_logout():
        flask_login.logout_user()
        return _redirect('index')

    @app.route('/reset_password', methods=['GET'])
    def reset_password():
        """ This view will be called when the user lands in the login page (GET)
        and also when login credentials are submitted (POST).
        """
        return _redirect('main', content_id='user_reset_password')

    @app.route('/reset_password_request', methods=['POST'])
    def reset_password_request():
        """ This view will be called as POST from the user login page. """
        email = flask.request.form['user-email'].strip()
        user = app.dm.get_user_by(email=email)

        if not email:
            msg = "ERROR: email can not be empty."
        elif user is None:
            msg = "ERROR: this email does not seen registered with any user."
        else:
            msg = ("Instructions about how to reset your password has been "
                   "sent to your email.")

            token = user.get_reset_password_token()
            app.dm.commit()  # store the user token

            def _render(fn):
                return flask.render_template(fn, user=user, token=token)

            app.mm.send_mail(
                [email],
                "emhub: CryoEM Reset your Password",
                _render('email/reset_password.txt'),
                html_body=_render('email/reset_password.html'))

        flask.flash(msg)
        return _redirect('reset_password')

    @app.route('/do_reset_password/<token>', methods=['GET', 'POST'])
    def do_reset_password(token):
        """ This view will be called as POST from the user login page. """
        if app.user.is_authenticated:
            return _redirect('index')

        user = app.dm.User.verify_reset_password_token(token)
        app.dm.commit()  # store the user token

        if not user:
            flask.flash("ERROR: Invalid token for resetting password. ")
            return _redirect('main', content_id='user_reset_password')

        flask_login.login_user(user)

        return _redirect('main', content_id='user_form', user_id=user.id)

    @app.route('/get_content', methods=['GET', 'POST'])
    def get_content():
        if flask.request.method == 'GET':
            content_kwargs = flask.request.args.to_dict()
        else:
            content_kwargs = flask.request.form.to_dict()

        content_id = content_kwargs['content_id']

        if content_id in NO_LOGIN_CONTENT or app.user.is_authenticated:
            try:
                if content_id.startswith('raw_'):
                    app.dc.check_user_access('raw')

                kwargs = app.dc.get(**content_kwargs)
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                error = {
                    'message': str(e),
                    'body': tb
                }
                return flask.render_template('error_dialog.html', error=error)
        else:
            kwargs = {'next_content': content_id}
            content_id = 'user_login'

        content_template = content_id + '.html'

        if content_template in templates:
            # Render from templates already in EMhub
            register_basic_params(kwargs)

            if app.is_devel:
                app.logger.debug(f"template: {content_template}, kwargs: {content_kwargs}")

            return flask.render_template(content_template, **kwargs)

        error = {
            "message": "Template '%s' not found." % content_template
        }
        return flask.render_template('error_dialog.html', error=error)

    @app.template_filter('basename')
    def basename(filename):
        return os.path.basename(filename) if filename else ''

    @app.template_filter('id_from_label')
    def id_from_label(label):
        return label.translate(label.maketrans("", "", "!#$%^&*()/\\ "))

    @app.template_filter('range_params')
    def range_params(date_range):
        s = date_range[0].strftime("%Y/%m/%d")
        e = date_range[1].strftime("%Y/%m/%d")
        return "&start=%s&end=%s" % (s, e)

    @app.template_filter('weekday')
    def weekday(dt):
        return app.dm.local_weekday(dt)

    @app.template_filter('booking_span')
    def booking_span(b):
        s = weekday(b.start)
        if b.hours > 24:
            s += ' - ' + weekday(b.end)
        return s

    @app.template_filter('redis_datetime')
    def redis_datetime(task_id, elapsed=False):
        dt = app.dm.dt_from_redis(task_id)
        dtStr = dt.strftime("%Y/%m/%d %H:%M:%S")
        if elapsed:
            dtStr += f" ({Pretty.elapsed(dt, now=app.dm.now())})"
        return dtStr

    @app.template_filter('pretty_elapsed')
    def pretty_elapsed(ts):
        return Pretty.elapsed(ts, now=app.dm.now())

    def url_for_content(contentId, **kwargs):
        return flask.url_for('main', _external=True, content_id=contentId, **kwargs)

    app.jinja_env.globals.update(url_for_content=url_for_content)
    app.jinja_env.add_extension('jinja2.ext.do')
    app.jinja_env.filters['basename'] = basename

    app.jinja_env.filters['pretty_date'] = pretty_date
    app.jinja_env.filters['pretty_quarter'] = pretty_quarter
    app.jinja_env.filters['shortname'] = shortname
    app.jinja_env.filters['pairname'] = pairname
    app.jinja_env.filters['pretty_size'] = Pretty.size
    app.jinja_env.filters['isoformat'] = datetime_to_isoformat

    from emhub.data.data_manager import DataManager
    app.user = flask_login.current_user

    from .data.content import dc
    app.dc = dc

    # Allow to define extra content in the instance folder
    extra_content = load_module('data_content')
    if extra_content and 'register_content' in dir(extra_content):
        print(f"Extending content from: {extra_content.__file__}")
        extra_content.register_content(dc)

    app.jinja_env.filters['booking_active_today'] = app.dc.booking_active_today
    app.jinja_env.filters['booking_to_event'] = app.dc.booking_to_event

    app.is_devel = (os.environ.get('FLASK_ENV', None) == 'development')
    app.version = __version__

    login_manager = flask_login.LoginManager()
    login_manager.init_app(app)

    app.mm = None
    app.r = None

    if app.use_ldap:
        import flask_ldap3_login
        ldap_manager = flask_ldap3_login.LDAP3LoginManager(app)

    if app.config.get('MAIL_SERVER', None):
        app.mm = MailManager(app)

    redis_config = os.path.join(emhub_instance_path, 'redis.conf')
    if os.path.exists(redis_config):
        with open(redis_config) as f:
            for line in f:
                if line.startswith('bind'):
                    host = line.split()[1]
                elif line.startswith('port'):
                    port = int(line.split()[1])
        import redis
        app.r = redis.StrictRedis(host, port,
                                  charset="utf-8", decode_responses=True)
        app.r.ping()

    app.dm = DataManager(app.instance_path, user=app.user, redis=app.r)

    from flaskext.markdown import Markdown
    Markdown(app)

    app.jinja_env.filters['pretty_datetime'] = app.dm.local_datetime

    extra_setup = load_module('app_setup')
    if extra_setup and 'setup_app' in dir(extra_setup):
        print(f"Extending app setup from: {extra_setup.__file__}")
        extra_setup.setup_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return app.dm.get_user_by(id=int(user_id))

    @app.teardown_appcontext
    def shutdown_session(exception=None):
        app.dm.close()

    return app
