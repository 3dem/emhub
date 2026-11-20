# **************************************************************************
# *
# * Authors:     J.M. de la Rosa Trevin (delarosatrevin@gmail.com)
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
# **************************************************************************

"""
Paths of a new or registered tomography project (tomo_processing entry):
the processing and data paths must be absolute or start with ~, relative
paths are rejected since they would be taken from the server's folder.
"""

import os
import tempfile
import unittest
from unittest import mock

from emhub.data.processing import absolute_project_path
from emhub.data.content import dc_tomo


class _FakeDC:
    """ Collect the content functions registered by dc_tomo. """
    def __init__(self):
        self.funcs = {}

    def content(self, func):
        self.funcs[func.__name__] = func
        return func


class _FakeEntry:
    def __init__(self, processing_path, data_path='', id=None):
        self.id = id
        self._data = {'processing_path': processing_path,
                      'data_path': data_path}

    def json(self):
        return {'extra': {'data': dict(self._data)}}


class TestTomoProjectPaths(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = os.path.realpath(self.tmp.name)
        self.data = os.path.join(self.base, 'raw')
        os.makedirs(self.data)
        dc = _FakeDC()
        dc_tomo.register_content(dc)
        self.validate = dc.funcs['entry_tomo_processing_validate']

    def tearDown(self):
        self.tmp.cleanup()

    def test_absolute_project_path(self):
        self.assertEqual(absolute_project_path(None), '')
        self.assertEqual(absolute_project_path('  '), '')
        self.assertEqual(absolute_project_path(' /a/b//c/ '), '/a/b/c')
        with mock.patch.dict(os.environ, {'HOME': self.base}):
            self.assertEqual(absolute_project_path('~/projects/p1'),
                             os.path.join(self.base, 'projects', 'p1'))
            self.assertEqual(absolute_project_path('~'), self.base)
        for path in ('projects/p1', './p1', '../p1', 'p1',
                     '~no_such_user_xyz/p1'):
            with self.assertRaisesRegex(ValueError, 'must be an absolute path'):
                absolute_project_path(path, 'Processing path')

    def test_relative_paths_rejected(self):
        for ppath, dpath in [('new_project', self.data),
                             ('projects/new_project', self.data),
                             (os.path.join(self.base, 'p1'), 'raw')]:
            with self.assertRaisesRegex(Exception, 'must be an absolute path'):
                self.validate(_FakeEntry(ppath, dpath))
        # Nothing created from the current folder
        self.assertFalse(os.path.exists(os.path.join(self.base, 'p1')))

    def test_missing_parent(self):
        ppath = os.path.join(self.base, 'missing', 'p1')
        with self.assertRaisesRegex(Exception, 'Parent path .* does not exist'):
            self.validate(_FakeEntry(ppath, self.data))

    def test_create_with_home(self):
        with mock.patch.dict(os.environ, {'HOME': self.base}):
            self.validate(_FakeEntry('~/p1/', '~/raw'))
        ppath = os.path.join(self.base, 'p1')
        self.assertTrue(os.path.isfile(os.path.join(ppath,
                                                    'default_pipeline.star')))
        # The data link points to the absolute (expanded) data path
        self.assertEqual(os.readlink(os.path.join(ppath, 'data')), self.data)


if __name__ == '__main__':
    unittest.main()
