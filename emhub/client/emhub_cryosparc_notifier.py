#!/usr/bin/env python
# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *
# * [1] SciLifeLab, Stockholm University
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 2 of the License, or
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

""" 
This script will monitors the pre-processing progress in CryoSparc and notify to EMhub.
"""

import sys, os
import time
import datetime as dt
from glob import glob
import argparse
from pprint import pprint
from contextlib import contextmanager
import numpy as np

import mrcfile


from emhub.client import open_client
from emhub.utils.image import Base64Converter


def usage(error):
    print("ERROR: %s" % error)
    get_parser().print_usage()
    sys.exit(1)


def get_parser():
    """ Return the argparse parser, so we can get the arguments """

    parser = argparse.ArgumentParser()
    add = parser.add_argument  # shortcut

    g = parser.add_mutually_exclusive_group()
    g.add_argument('--list', action='store_true',
                   help="List existing sessions in the server.")
    g.add_argument('--update', action='store_true',
                   help="Update an existing session")

    add('-p', '--project', metavar='PROJECT_PATH',
        help='Project path.')

    add('--session_id', type=int,
        help='EMhub Session Id')

    # add('--prot_ctf', type=int, default=0,
    #     help="Id of the CTF protocol to monitor. ")
    #
    # add('--prot_picking', type=int, default=0,
    #     help="Id of the particle picking protocol to monitor. ")
    #
    # add('--prot_2d', type=int, default=0,
    #     help='Id of the classify 2d protocol.')

    add('--clear', action='store_true',
        help="Clear existing data associated with the session.")

    return parser


class CSLiveSession:
    def __init__(self, projPath, sessionId):
        self._sessionId = sessionId

        if not os.path.exists(projPath):
            usage("No project found at '%s'" % projPath)

        self._projectPath = projPath

    def _get_path(self, *paths):
        return os.path.join(self._projectPath, *paths)

    def _update_mics_ctfs(self, dc):
        files = glob(self._get_path('import_movies', '*.tiff'))
        self._micSetId = 'Micrographs_%06d' % 1  # FIXME: give a proper id

        attrs = {
            'session_id': self._sessionId,
            'set_id': self._micSetId
        }

        stats = {
            'numOfCls2D': 0,
            'numOfCtfs': 0,
            'numOfMics': 0,
            'numOfMovies': 0,
            'numOfPtcls': 0,
            'ptclSizeMax': 0,
            'ptclSizeMin': 0
        }

        micBase64 = Base64Converter()
        psdBase64 = Base64Converter()

        idset = set()
        idcount = 0
        mics_count = 0
        parts_count = 0

        def _get(folder, movieRoot, suffix):
            pattern = self._get_path(folder, movieRoot + '*' + suffix)
            matched = glob(pattern)
            print('pattern: ', pattern, 'matched: ', len(matched))
            return matched[0] if matched else None

        for fn in files:
            movieRoot, movieExt = os.path.splitext(os.path.basename(fn))
            extractFn = _get('extract', movieRoot, '.cs')
            micArray = np.load(extractFn)
            row = micArray[0]
            micId = int(row['location/micrograph_uid'])

            try:
                u = float(row['ctf/df1_A'])
                v = float(row['ctf/df2_A'])
                a = float(row['ctf/df_angle_rad'])
            except:
                print('Missing CTF value for Micrograph id "%s", ignoring.' % micId)
                continue

            mic = row['location/micrograph_path'].decode("utf-8")
            pixelSize = float(row['blob/psize_A'])

            if micId in idset:
                print('Micrograph id "%s" seems duplicated, ignoring.' % micId)
                continue

            idcount += 1
            attrs.update({
                'item_id': idcount,
                'uid': str(micId),
                'ctfDefocus': (u + v) * 0.5,
                'ctfDefocusU': u,
                'ctfDefocusV': v,
                'ctfDefocusAngle': np.rad2deg(a),
                'ctfResolution': 0.0,
                'ctfFit': 0.0,
                'location': mic,
                'ctfFitData': '',
                'shiftPlotData': '',
                'pixelSize': pixelSize
            })

            print("\nAdding item %06d: \n   -> %s" % (micId, mic))
            psdPath = _get('ctfestimated', movieRoot, 'diag_2D.mrc')

            print("  PSD: ", psdPath, "exists: ", os.path.exists(psdPath))
            if os.path.exists(psdPath):
                attrs['psdData'] = psdBase64.from_mrc(psdPath)

            micPath = self._get_path(mic.replace('S1/', ''))
            print("  MIC: ", micPath, "exists: ", os.path.exists(micPath))
            if os.path.exists(micPath):
                attrs['micThumbData'] = micBase64.from_mrc(micPath)
                attrs['micThumbPixelSize'] = pixelSize * micBase64.scale
                w, h = row['location/micrograph_shape']
                attrs['coordinates'] = [
                    (r['location/center_x_frac'] * h,
                     r['location/center_y_frac'] * w) for r in micArray]

            try:
                dc.add_session_item(attrs)
                idset.add(micId)
                mics_count += 1
                parts_count += len(attrs.get('coordinates', []))
            except Exception as e:
                print(">>> FAILED: id exists: ", micId in idset)
                pprint(attrs)
                raise e

            stats = {
                'numOfCls2D': 0,
                'numOfCtfs': mics_count,
                'numOfMics': mics_count,
                'numOfMovies': mics_count,
                'numOfPtcls': parts_count,
                'ptclSizeMax': 0,
                'ptclSizeMin': 0
            }

            if mics_count % 10 == 0:
                dc.update_session({'id': self._sessionId, 'stats': stats})
                time.sleep(10)  # FIXME

        dc.update_session({'id': self._sessionId, 'stats': stats})

    def _update_coords(self, dc):
        protCtf = self._protocols['ctf']
        outputCTF = getattr(protCtf, 'outputCTF', None)
        micSet = protCtf.inputMicrographs.get()

        protPicking = self._protocols.get('picking', None)

        if protPicking is None:
            return

        coordsSet = getattr(protPicking, 'outputCoordinates', None)
        attrs = {
            'session_id': self._sessionId,
            'set_id': 'Micrographs_%06d' % micSet.getObjId()
        }
        coordList = []
        lastMicId = None

        for coord in coordsSet.iterItems(orderBy='_micId', direction='ASC'):
            micId = coord.getMicId()
            if micId != lastMicId:
                # Update the coordinates information if necessary
                if lastMicId is not None:
                    attrs['item_id'] = lastMicId
                    attrs['coordinates'] = coordList

                    dc.update_session_item(attrs)
                lastMicId = micId
                coordList = []
            coordList.append(coord.getPosition())

    def run(self):
        with open_client() as dc:
            sessionDict = dc.get_session(self._sessionId)
            self._update_mics_ctfs(dc)


def main():
    args = get_parser().parse_args()

    if args.clear:
        with open_client() as dc:
            print("Clearing session data: ")
            dc.request('clear_session_data', jsonData={'attrs': {'id': args.session_id}})

    if args.list:
        with open_client() as dc:
            r = dc.request('get_sessions', jsonData={})

            for session in r.json():
                pprint(session)

    elif args.project:
        CSLiveSession(args.project, args.session_id).run()

    else:
        print("Please provide some arguments")
        sys.exit(1)


if __name__ == '__main__':
    main()





