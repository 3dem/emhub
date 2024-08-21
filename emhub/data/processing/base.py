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

import os
import datetime as dt
from glob import glob
from collections import defaultdict
import json

import mrcfile
from emtools.utils import Path, Timer, Pretty
from emtools.metadata import StarFile, EPU, SqliteFile
from emtools.image import Thumbnail


def hours(tsFirst, tsLast):
    dtFirst = dt.datetime.fromtimestamp(tsFirst)
    dtLast = dt.datetime.fromtimestamp(tsLast)
    d = dtLast - dtFirst
    return d.days * 24 + d.seconds / 3600


class SessionRun:
    """ Group functions related to a run in a Session. """
    def __init__(self, project, path):
        self.project = project
        self._path = path
        self._epuData = None

    def join(self, *paths):
        return os.path.join(self._path, *paths)

    def getFormDefinition(self):
        """ Return the class definition for this run type. """
        return {}

    def getValues(self):
        return {}

    def getStdOut(self):
        """ Return run's stdout file. """
        return None

    def getStdError(self):
        """ Return run's stdout file. """
        return None


class SessionData:
    """ Base class with common functionality. """
    def __init__(self, path, mode='r'):
        self._path = path
        self._epuData = None

    @property
    def path(self):
        return self._path

    def join(self, *paths):
        return os.path.join(self._path, *paths)

    def relpath(self, path):
        return os.path.relpath(path, self._path)

    def exists(self, path):
        return os.path.exists(self.join(path))

    def getEpuData(self):
        if not self._epuData:
            epuFolder = self.join('EPU')
            moviesStarFile = self.join('EPU', 'movies.star')
            if Path.exists(moviesStarFile):
                self._epuData = EPU.Data(epuFolder, moviesStarFile)
        return self._epuData

    def mtime(self, fn):
        mt = os.path.getmtime(self.join(fn))
        return mt

    def close(self):
        """ Deprecated, just for backward compatibility. """
        pass

    # ------------ Functions to override in subclasses ---------------------
    def get_stats(self):
        return {'movies': {'count': 0}, 'ctfs': {'count': 0}}

    def get_micrographs(self):
        return []

    def get_micrograph_data(self):
        return {}

    def get_micrograph_coordinates(self, micName):
        return []

    def get_micrograph_gridsquare(self, **kwargs):
        epuData = self.getEpuData()
        gsId = kwargs.get('gsId', '')
        locData = {
            'gridSquare': {},
            'foilHole': {}
        }
        if epuData is None:
            return locData

        thumb = Thumbnail(output_format='base64', max_size=(512, 512))

        for row in epuData.gsTable:
            if row.id == gsId:
                imgPath = self.join('EPU', row.folder, row.image)
                locData['gridSquare'] = {
                    'id': row.id,
                    'image': row.image,
                    'folder': row.folder,
                    'thumbnail': thumb.from_path(imgPath)
                }
                break

        def _microns(v):
            return round(v * 0.0001, 3)

        defocus = []
        resolution = []
        particles = 0
        for mic in self.get_micrographs():
            micName = mic.get('micName', mic['micrograph'])
            loc = EPU.get_movie_location(micName)
            if loc['gs'] == gsId:
                defocus.append(_microns(mic['ctfDefocus']))
                resolution.append(round(mic['ctfResolution'], 3))
                particles += len(self.get_micrograph_coordinates(micName))

        locData.update({'defocus': defocus,
                        'resolution': resolution,
                        'particles': particles
                        })

        return locData

    def get_gridsquares(self, **kwargs):
        epuData = self.getEpuData()
        gs = []
        lastGs = None
        counter = 0
        if epuData is not None:
            for row in epuData.moviesTable:
                movieGs = row.gsId
                if movieGs != lastGs:
                    if lastGs:
                        gs.append({'gsId': lastGs, 'micrographs': counter})
                    lastGs = movieGs
                    counter = 0
                counter += 1
            gs.append({'gsId': lastGs, 'count': counter})

        return gs

    def get_classes2d(self):
        pass

    def get_workflow(self):
        """ Return protocols and their relations. """
        return []

    def get_run(self, runId):
        """ Retrieve Run class. """
        return None
