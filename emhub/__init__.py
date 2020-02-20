import os
import json
import base64
from glob import glob
from io import BytesIO
from PIL import Image

from flask import Flask, render_template, request, make_response, send_file
from flask_sqlalchemy import SQLAlchemy


here = os.path.abspath(os.path.dirname(__file__))

templates = [os.path.basename(f) for f in glob(os.path.join(here, 'templates', '*.html'))]

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
        return render_template('main.html')

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

    @app.route('/get_mic', methods=['POST'])
    def get_mic():
        """
t20-tutorial/imgMicThumbs/14sep05c_c_00003gr_00014sq_00010hl_00002es.frames_thumbnail.png
t20-tutorial/imgMicThumbs/14sep05c_c_00003gr_00014sq_00011hl_00002es.frames_thumbnail.png
t20-tutorial/imgMicThumbs/14sep05c_c_00003gr_00014sq_00011hl_00003es.frames_thumbnail.png
t20-tutorial/imgMicThumbs/14sep05c_c_00003gr_00014sq_00011hl_00004es.frames_thumbnail.png

t20-tutorial/imgPsdThumbs/14sep05c_c_00003gr_00014sq_00010hl_00002es.frames_aligned_mic_ctfEstimation.png
t20-tutorial/imgPsdThumbs/14sep05c_c_00003gr_00014sq_00011hl_00002es.frames_aligned_mic_ctfEstimation.png
t20-tutorial/imgPsdThumbs/14sep05c_c_00003gr_00014sq_00011hl_00003es.frames_aligned_mic_ctfEstimation.png
t20-tutorial/imgPsdThumbs/14sep05c_c_00003gr_00014sq_00011hl_00004es.frames_aligned_mic_ctfEstimation.png

t20-tutorial/imgShiftThumbs/14sep05c_c_00003gr_00014sq_00010hl_00002es.frames_global_shifts.png
t20-tutorial/imgShiftThumbs/14sep05c_c_00003gr_00014sq_00011hl_00002es.frames_global_shifts.png
t20-tutorial/imgShiftThumbs/14sep05c_c_00003gr_00014sq_00011hl_00003es.frames_global_shifts.png
t20-tutorial/imgShiftThumbs/14sep05c_c_00003gr_00014sq_00011hl_00004es.frames_global_shifts.png

        :return:
        """
        micId = int(request.form['micId'])
        return send_json_data(get_mic_prefix(micId))

    @app.route('/get_mic_thumb', methods=['POST'])
    def get_mic_thumb():
        micId = int(request.form['micId'])
        micThumb = get_micthumb_fn(micId)
        encoded = fn_to_base64(micThumb)
        return send_json_data({'thumbnail': micThumb, 'base64': encoded})

    @app.route('/get_content', methods=['POST'])
    def get_content():
        content_template = request.form['content_id'] + '.html'

        # FIXME: DB query is here
        from .models import User
        users = User.query.all()

        if content_template in templates:
            return render_template(content_template, users=users)

        return "<h1>Template '%s' not found</h1>" % content_template

    db.init_app(app)

    with app.app_context():
        if not os.path.exists(os.path.join(app.instance_path, 'emhub.sqlite')):
            from .create_db import create_database
            db.create_all()
            create_database()

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


def get_mic_prefix(micId):
    micDict = {
        1: '14sep05c_c_00003gr_00014sq_00010hl_00002es.frames',
        2: '14sep05c_c_00003gr_00014sq_00011hl_00002es.frames',
        3: '14sep05c_c_00003gr_00014sq_00011hl_00003es.frames',
        4: '14sep05c_c_00003gr_00014sq_00011hl_00004es.frames'
    }
    return micDict.get(micId)


def get_micthumb_fn(micId):
    return get_fn('imgMicThumbs/%s_thumbnail.png' % get_mic_prefix(micId))


def get_fn(basename):
    return "emdash/static/t20-tutorial/" + basename
