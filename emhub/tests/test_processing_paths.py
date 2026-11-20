""" Processing paths stored relative are relative to the home folder of the
user running EMhub, not to the server's working directory.

A tomo_processing entry stored as 'coescb/home/...' was read by the
dashboard (os.stat, relative to the working directory) but its tilt
thumbnails were 404 (flask.send_from_directory resolves a relative folder
from the app root instead).
"""

import os
import tempfile
import unittest
from unittest import mock

import flask

from emhub.data.processing import resolve_processing_path, resolve_project_root


class TestResolveProcessingPath(unittest.TestCase):

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self._tmp.name, 'home')
        self.elsewhere = os.path.join(self._tmp.name, 'elsewhere')
        os.makedirs(self.elsewhere)
        # A project under the home folder, with a tilt thumbnail
        self.rel_project = os.path.join('coescb', 'proj')
        self.project = os.path.join(self.home, self.rel_project)
        self.thumb_rel = 'EMwrap/job007/thumbnails/tilt_EER.jpg'
        os.makedirs(os.path.dirname(os.path.join(self.project, self.thumb_rel)))
        with open(os.path.join(self.project, self.thumb_rel), 'wb') as f:
            f.write(b'\xff\xd8\xff\xe0jpeg')
        self._env = mock.patch.dict(os.environ, {'HOME': self.home})
        self._env.start()
        self._cwd = os.getcwd()
        # The server may start anywhere: not in the home folder
        os.chdir(self.elsewhere)

    def tearDown(self):
        os.chdir(self._cwd)
        self._env.stop()
        self._tmp.cleanup()

    def test_empty(self):
        for p in ('', None):
            self.assertEqual(resolve_processing_path(p), p)
            self.assertEqual(resolve_project_root(p), p)

    def test_absolute(self):
        self.assertEqual(resolve_processing_path(self.project), self.project)
        self.assertEqual(resolve_processing_path(self.project + '/'), self.project)

    def test_tilde(self):
        self.assertEqual(resolve_processing_path('~/' + self.rel_project), self.project)

    def test_relative_is_from_home(self):
        for f in (resolve_processing_path, resolve_project_root):
            self.assertEqual(f(self.rel_project), self.project)
            self.assertEqual(f('./' + self.rel_project), self.project)

    def test_relative_thumbnail_is_served(self):
        """ The tomo_otf_thumbnail route: send_from_directory with the root
        of an entry stored relative. """
        root = resolve_processing_path(self.rel_project)
        app = flask.Flask('emhub_test', root_path=self.elsewhere)
        with app.test_request_context():
            response = flask.send_from_directory(root, self.thumb_rel)
            response.direct_passthrough = False
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.get_data().startswith(b'\xff\xd8'))


if __name__ == '__main__':
    unittest.main()
