import os
import json
import base64
from glob import glob
from io import BytesIO
from PIL import Image

from flask import Flask, render_template, request, make_response, send_file
from flask_sqlalchemy import SQLAlchemy
from .model import TestSessionData

here = os.path.abspath(os.path.dirname(__file__))

templates = [os.path.basename(f) for f in glob(os.path.join(here, 'templates', '*.html'))]

EMHUB_TESTDATA = os.environ.get('EMHUB_TESTDATA', '')

db = SQLAlchemy()


def create_app(test_config=None):
    # create and configure the app
    app = Flask(__name__, instance_relative_config=True)

    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
    app.config.from_mapping(
        SECRET_KEY='dev',
        #DATABASE=os.path.join(app.instance_path, 'emhub.sqlite'),
    )
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(app.instance_path, 'emhub.sqlite')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SQLALCHEMY_ECHO'] = True

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

    @app.route('/index')
    def index():
        from .model.sqlite import Session
        # get status=True sessions only
        sessions = Session.query.filter_by(status=True).all()
        running_sessions = []
        for session in sessions:
            # we need to pass scope name for the link name and the session id
            running_sessions.append({
                'microscope': session.microscope,
                'id': session.id})
        tsd = TestSessionData()
        return render_template('main.html', sessions=running_sessions)

    @app.route('/projects')
    def projects():
        return render_template('projects.html')

    @app.route('/micrographs')
    def micrographs():
        return render_template('micrographs.html')

    def send_json_data(data):
        resp = make_response(json.dumps(data))
        resp.status_code = 200
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp

    @app.route('/get_mic_thumb', methods=['POST'])
    def get_mic_thumb():
        micId = int(request.form['micId'])
        tsd = TestSessionData()
        micThumb = tsd._get_micthumb_fn(micId)
        micThumbBase64 = fn_to_base64(micThumb)
        micPsd = tsd._get_micpsd_fn(micId)
        micPsdBase64 = fn_to_base64(micPsd)
        micShifts = tsd._get_micshifts_fn(micId)
        micShiftsBase64 = fn_to_base64(micShifts)

        return send_json_data({
            'thumb': micThumb, 'thumb-base64': micThumbBase64,
            'psd': micPsd, 'psd-base64': micPsdBase64,
            'shifts': micShifts, 'shifts-base64': micShiftsBase64,
        })

    @app.route('/get_content', methods=['POST'])
    def get_content():
        # content = session-live-id#id
        content = request.form['content_id']
        content_id = content.split('-id')[0]
        session_id = content.split('-id')[-1] or None
        content_template = content_id + '.html'

        if content_template in templates:
            return render_template(content_template,
                                   **ContentData.get(content_id, session_id))

        return "<h1>Template '%s' not found</h1>" % content_template

    @app.template_filter('basename')
    def basename(filename):
        """Convert a string to all caps."""
        return os.path.basename(filename)

    class ContentData:
        # To have a quick way to retrieve data based on the content-id, we just
        # need to call the function get_$content-id_data and it will be
        # automatically retrieved. In the name, we need to replace the - in
        # the content id by _
        @classmethod
        def get(cls, content_id, session_id):
            get_func_name = 'get_%s' % content_id.replace('-', '_')
            get_func = getattr(cls, get_func_name, None)
            return {} if get_func is None else get_func(session_id)

        @classmethod
        def get_session_live(cls, session_id):
            mics = TestSessionData().getMicrographs(1, ['location', 'ctfDefocus'])
            defocusList = [m.ctfDefocus for m in mics]
            sample = ['Defocus'] + defocusList

            from .model.sqlite import Session, User
            session = Session.query.filter_by(id=session_id).first()
            data = User.query.all()
            bar1 = {'label': 'CTF Defocus',
                    'data': defocusList}

            mics = TestSessionData().getMicrographs(setId=1)

            return {'sample': sample,
                    'bar1': bar1,
                    'users': data,
                    'micrographs': mics,
                    'session': session}

    db.init_app(app)
    app.jinja_env.filters['reverse'] = basename

    with app.app_context():
        if not os.path.exists(os.path.join(app.instance_path, 'emhub.sqlite')):
            from .model.create_db import create_db_test, create_db_sessions
            db.create_all()
            create_db_test()
            create_db_sessions()

    return app


def fn_to_base64(filename):
    """ Read the image filename as a PIL image
    and encode it as base64.
    """
    img = Image.open(filename)
    encoded = pil_to_base64(img)
    img.close()
    return encoded


def pil_to_base64(pil_img):
    """ Encode as base64 the PIL image to be
    returned as an AJAX response.
    """
    img_io = BytesIO()
    pil_img.save(img_io, format='PNG')
    return base64.b64encode(img_io.getvalue()).decode("utf-8")



