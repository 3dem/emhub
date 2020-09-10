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
import sys
import json
from glob import glob
from datetime import datetime, timezone, timedelta
from emtable import Table

from emhub.client import DataClient
from emhub.utils import image


def usage(error):
    print("""
    ERROR: %s

    Usage: %s RELION_PROJECT_PATH
        RELION_PROJECT_PATH: provide the full path to Relion project folder.
    """ % (sys.argv[0], error))
    sys.exit(1)

TZ_DELTA = 0  # Define timezone, UTC '0'
tzinfo = timezone(timedelta(hours=TZ_DELTA))

MICROGRAPH_ATTRS = {
    'ctfDefocus': 'rlnDefocusU',
    'ctfDefocusU': 'rlnDefocusU',
    'ctfDefocusV': 'rlnDefocusV',
    'ctfDefocusAngle': 'rlnDefocusAngle',
    'ctfResolution': 'rlnCtfMaxResolution',
    'ctfFit': 'rlnCtfFigureOfMerit'
}

MICROGRAPH_DATA_ATTRS = [
    'micThumbData', 'psdData', 'ctfFitData', 'shiftPlotData'
]

STAR_DICT = {
    # jobtype: [fileName, tableName]
    'Import': ['Import/job???/movies.star', 'movies'],
    'MotionCorr': ['MotionCorr/job???/corrected_micrographs.star', 'micrographs'],
    'CtfFind': ['CtfFind/job???/micrographs_ctf.star', 'micrographs'],
    'Extract': ['Extract/job???/particles.star', 'particles'],
}


class ImportRelionSession:
    def __init__(self, path):
        self.path = path
        self.session_name = os.path.basename(self.path)
        self.results = dict()

    def parseRelionJobs(self):
        """ Parse Relion jobs into a dict. """
        for job in STAR_DICT:
            params = STAR_DICT[job]
            fnStar = glob(os.path.join(self.path, params[0]))
            if not fnStar:
                print("Didn't find %s job star file!" % job)
            else:
                # update STAR_DICT
                print("Found star file: ", fnStar[0])
                STAR_DICT[job][0] = fnStar[0]
                # parse Tables
                self.results[job] = Table(fileName=fnStar[0], tableName=params[1])

    def iterateItemsAttrs(self):
        """ Create a dict with Micrograph items. """
        print("Parsing Relion micrograph items...")
        for itemId, item in enumerate(self.results['CtfFind']):
            values = {
                'item_id': itemId + 1,
                'location': item.rlnMicrographName
            }
            values.update({k: item.get(MICROGRAPH_ATTRS[k], '')
                           for k in MICROGRAPH_ATTRS.keys()})
            values['micThumbData'] = image.mrc_to_base64(
                self._getRelionMicPath(item.rlnMicrographName))
            values['psdData'] = ""  # image.mrc_to_base64(
            #self._getRelionMicPath(item.rlnCtfImage))
            values['shiftPlotData'] = image.fn_to_base64(
                self._getRelionEpsPath(item.rlnMicrographName))

            yield values

    def populateSessionAttrs(self):
        """ Create a dict with acquisition etc attrs. """
        fn = os.path.join(self.path, STAR_DICT['CtfFind'][0])
        optics = Table(fileName=fn, tableName='optics')[0]
        numFrames, dosePerFrame = self._getMovieMetadata()
        acquisition = {'voltage': optics.rlnVoltage,
                       'cs': optics.rlnSphericalAberration,
                       'phasePlate': False,
                       'detector': 'Falcon2',
                       'detectorMode': 'Linear',
                       'pixelSize': optics.rlnMicrographOriginalPixelSize,
                       'dosePerFrame': dosePerFrame,
                       'totalDose': 35,
                       'exposureTime': 1.2,
                       'numOfFrames': numFrames,
                       }
        stats = {'numMovies': len(self.results['Import']),
                 'numMics': len(self.results['MotionCorr']),
                 'numCtf': len(self.results['CtfFind']),
                 'numPtcls': len(self.results['Extract']),
                 }
        sessionAttrs = {"name": "%s" % self.session_name,
                        "status": "finished",
                        "resource_id": "2",
                        "operator_id": "23",
                        "acquisition": acquisition,
                        "stats": stats
                        }

        return sessionAttrs

    def createNewSession(self):
        """ Create a session using REST API. """
        sc = DataClient()
        # Remove existing relion session
        sc.request(method="get_sessions",
                   jsonData={"condition": "name='%s'" % self.session_name,
                             "attrs": 'id'})
        res = json.loads(sc.json())
        if res:
            sc.delete_session({"id": res[0]['id']})

        # Create new session with no items
        sessionAttrs = self.populateSessionAttrs()
        print("=" * 80, "\nCreating session: %s" % sessionAttrs)
        sessionJson = sc.create_session(sessionAttrs)
        self.session_id = sessionJson['id']
        print("Created new session with id: %s" % self.session_id)

        # Create a new set
        session_set = {'session_id': self.session_id,
                       'set_id': 1}
        print("=" * 80, "\nCreating set: %s" % session_set)
        sc.create_session_set(session_set)
        print("Created new set with id: 1")

        # Add new items one by one
        for item in self.iterateItemsAttrs():
            item.update(session_set)
            print("=" * 80, "\nAdding item: %s" % item['item_id'])

            sc.add_session_item(item)

    def run(self):
        """ Main execute function. """
        self.parseRelionJobs()
        self.createNewSession()

# -------------------- UTILS functions ----------------------------------------

    def _getRelionMicPath(self, fn):
        if fn.endswith(".ctf:mrc"):
            fn = fn.rstrip(":mrc")
        return os.path.join(self.path, fn)

    def _getRelionEpsPath(self, fn):
        if fn.endswith(".mrc"):
            fn = fn.replace(".mrc", "_shifts.eps")
        return os.path.join(self.path, fn)

    def _getMovieMetadata(self):
        fn = self.results['MotionCorr'][0].rlnMicrographMetadata
        fn = self._getRelionMicPath(fn)
        md = Table(fileName=fn, tableName='general')[0]
        numFrames = md.rlnImageSizeZ
        dosePerFrame = md.rlnMicrographDoseRate
        return numFrames, dosePerFrame

    def _getStartDate(self):
        fn = STAR_DICT['Import'][0].replace("movies.star", "note.txt")
        fn = self._getRelionMicPath(fn)
        mtime = os.path.getmtime(fn)
        return datetime.fromtimestamp(mtime, tz=tzinfo)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        usage("Incorrect number of input parameters")
    else:
        job = ImportRelionSession(path=sys.argv[1])
        job.run()
