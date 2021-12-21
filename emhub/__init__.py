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
from glob import glob


__version__ = '0.2.7'


def create_app(test_config=None):
    import flask
    import flask_login

    from . import utils
    from .blueprints import api_bp, images_bp, pages_bp
    from .utils import (datetime_to_isoformat,
                        pretty_date, pretty_datetime, pretty_quarter,
                        send_json_data, send_error)
    from .utils.mail import MailManager
    from .data.data_content import DataContent

    here = os.path.abspath(os.path.dirname(__file__))
    templates = [os.path.basename(f) for f in glob(os.path.join(here, 'templates', '*.html'))]

    # create and configure the app
    emhub_instance_path = os.environ.get('EMHUB_INSTANCE', None)

    app = flask.Flask(__name__,
                      instance_path=emhub_instance_path,
                      instance_relative_config=True)

    app.register_blueprint(api_bp, url_prefix='/api')
    app.register_blueprint(images_bp, url_prefix='/images')
    app.register_blueprint(pages_bp, url_prefix='/pages')

    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
    app.config['SECRET_KEY'] = 'dev'

    app.config["IMAGES"] = os.path.join(app.instance_path, 'images')
    app.config["USER_IMAGES"] = os.path.join(app.config["IMAGES"], 'user')
    app.config["ENTRY_FILES"] = os.path.join(app.instance_path, 'entry_files')
    app.config["ALLOWED_IMAGE_EXTENSIONS"] = ["JPEG", "JPG", "PNG", "GIF"]
    app.config["SESSIONS"] = os.path.join(app.instance_path, 'sessions')
    app.config["PAGES"] = os.path.join(app.instance_path, 'pages')

    if test_config is None:
        # load the instance config, if it exists, when not testing
        app.config.from_pyfile('config.py', silent=True)
    else:
        # load the test config if passed in
        app.config.from_mapping(test_config)

    portalAPI = app.config.get('SLL_PORTAL_API', None)
    if portalAPI is not None:
        from .data.imports.scilifelab import PortalManager
        app.sll_pm = PortalManager(portalAPI, cache=False)

    # ensure the instance folder exists
    os.makedirs(app.config['USER_IMAGES'], exist_ok=True)
    os.makedirs(app.config['ENTRY_FILES'], exist_ok=True)
    os.makedirs(app.config['SESSIONS'], exist_ok=True)
    os.makedirs(app.config['PAGES'], exist_ok=True)

    # Define some content_id list that does not requires login
    NO_LOGIN_CONTENT = ['users_list',
                        'user_reset_password',
                        'pages']

    @app.route('/main', methods=['GET', 'POST'])
    def main():
        if flask.request.method == 'GET':
            params = flask.request.args.to_dict()
            #content_id = flask.request.args.get('content_id', 'empty')
        else:
            params = flask.request.form.to_dict()
            #content_id = flask.request.form['content_id']

        content_id = params.pop('content_id', 'empty')
        kwargs = {'content_id': content_id,
                  'params': params
                  }

        if app.user.is_authenticated:
            if content_id == 'user_login':  # Redirects to Dashboard by default
                kwargs['content_id'] = 'dashboard'
            app.user.image = app.dc.user_profile_image(app.user)
        else:
            if content_id not in NO_LOGIN_CONTENT:
                kwargs = {'content_id': 'user_login',
                          'next_content': content_id,
                          'params': {}}

        kwargs['is_devel'] = app.is_devel
        kwargs['version'] = __version__
        kwargs['emhub_title'] = app.config.get('EMHUB_TITLE', '')
        kwargs['possible_owners'] = app.dc.get_pi_labs()
        kwargs['possible_operators'] = app.dc.get_possible_operators()
        kwargs.update(app.dc.get_resources_list())

        return flask.render_template('main.html', **kwargs)

    def _redirect(endpoint, **kwargs):
        return flask.redirect(flask.url_for(endpoint, **kwargs))

    @app.route('/', methods=['GET', 'POST'])
    @app.route('/index', methods=['GET', 'POST'])
    def index():
        return _redirect('pages.index', page_id='welcome')

    @app.route('/login', methods=['GET'])
    def login():
        """ This view will called when the user lands in the login page (GET)
        and also when login credentials are submitted (POST).
        """
        next_content = flask.request.args.get('next_content', 'empty')
        return _redirect('main', content_id=next_content)

    @app.route('/do_login', methods=['POST'])
    def do_login():
        """ This view will called as POST from the user login page. """
        username = flask.request.form['username']
        password = flask.request.form['password']
        next_content = flask.request.form.get('next_content', 'index')

        user = app.dm.get_user_by(username=username)
        if user is None or not user.check_password(password):
            flask.flash('Invalid username or password')
            return _redirect('login')

        flask_login.login_user(user)

        if next_content == 'user_login':
            next_content = 'dashboard'
        return _redirect('main', content_id=next_content)

    @app.route('/do_switch_login', methods=['POST'])
    @flask_login.login_required
    def do_switch_login():
        """ This view will called as POST from a currently logged admin user.
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
        """ This view will called when the user lands in the login page (GET)
        and also when login credentials are submitted (POST).
        """
        return _redirect('main', content_id='user_reset_password')

    @app.route('/reset_password_request', methods=['POST'])
    def reset_password_request():
        """ This view will called as POST from the user login page. """
        email = flask.request.form['user-email']
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
        """ This view will called as POST from the user login page. """
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
                kwargs = app.dc.get(**content_kwargs)
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                result = "<h1><span style='color: red'>Error</span> </br>%s</h1>" % e
                result += "<pre>%s</pre>" % tb
                return result
        else:
            kwargs = {'next_content': content_id}
            content_id = 'user_login'

        content_template = content_id + '.html'

        if content_template in templates:
            kwargs['is_devel'] = app.is_devel
            return flask.render_template(content_template, **kwargs)

        return "<h1>Template '%s' not found</h1>" % content_template


    @app.template_filter('basename')
    def basename(filename):
        return os.path.basename(filename)

    @app.template_filter('id_from_label')
    def id_from_label(label):
        return label.translate(label.maketrans("", "", "!#$%^&*()/\\ "))
        #return label.replace(' ', '_')

    @app.template_filter('range_params')
    def range_params(date_range):
        s = date_range[0].strftime("%Y/%m/%d")
        e = date_range[1].strftime("%Y/%m/%d")
        return "&start=%s&end=%s" % (s, e)

    def url_for_content(contentId, **kwargs):
        return flask.url_for('main', content_id=contentId, **kwargs)

    app.jinja_env.globals.update(url_for_content=url_for_content)
    app.jinja_env.add_extension('jinja2.ext.do')
    app.jinja_env.filters['reverse'] = basename
    app.jinja_env.filters['pretty_datetime'] = pretty_datetime
    app.jinja_env.filters['pretty_date'] = pretty_date
    app.jinja_env.filters['pretty_quarter'] = pretty_quarter

    from emhub.data.data_manager import DataManager
    app.user = flask_login.current_user
    app.dm = DataManager(app.instance_path, user=app.user)
    app.dc = DataContent(app)
    app.is_devel = (os.environ.get('FLASK_ENV', None) == 'development')
    app.version = __version__

    login_manager = flask_login.LoginManager()
    #login_manager.login_view = 'login'
    login_manager.init_app(app)

    app.mm = MailManager(app)

    from flaskext.markdown import Markdown
    Markdown(app)

    @login_manager.user_loader
    def load_user(user_id):
        return app.dm.get_user_by(id=int(user_id))

    @app.teardown_appcontext
    def shutdown_session(exception=None):
        app.dm.close()

    return app
