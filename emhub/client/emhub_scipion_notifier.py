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
This script will compute the statistics of the SetOfCTFs in a given project.
"""

import sys, os
import datetime as dt
import argparse
from pprint import pprint

from pyworkflow.project import Manager
import pyworkflow.utils as pwutils

from pwem.objects import SetOfCTF

import emhub_notifier_config as config

# add emhub source code to the path and import client submodule
sys.path.append(config.EMHUB_SOURCE)

from emhub.client import DataClient
from emhub.utils.image import mrc_to_base64


def usage(error):
    print("ERROR: %s" % error)
    get_parser().print_usage()
    sys.exit(1)


def get_parser():
    """ Return the argparse parser, so we can get the arguments """

    parser = argparse.ArgumentParser()
    add = parser.add_argument  # shortcut

    add('projName', metavar='PROJECT_NAME',
        help="Name of the Scipion project")

    add('protId', metavar='PROTOCOL_ID',
        help="ID of the CTF protocol. ")

    g = parser.add_mutually_exclusive_group()
    g.add_argument('--list', action='store_true',
                   help="List existing sessions in the server.")
    g.add_argument('--create',
                   help="Create a new session")
    g.add_argument(
        '--update',
        help="Update an existing session")
    g.add_argument(
        '--delete', metavar='SESSION_ID', type=int, nargs='+',
        help='Delete one or several sessions.')

    #
    # add('datasets', metavar='DATASET', nargs='*', help='Name of a dataset.')
    # add('--delete', action='store_true',
    #     help=('When uploading, delete any remote files in the dataset not '
    #           'present in local. It leaves the remote scipion data directory '
    #           'as it is in the local one. Dangerous, use with caution.'))
    # add('-u', '--url', default=pw.Config.SCIPION_URL_TESTDATA,
    #     help='URL where remote datasets will be looked for.')
    # add('--check-all', action='store_true',
    #     help='See if there is any remote dataset not in sync with locals.')
    # add('-l', '--login', default='scipion@scipion.cnb.csic.es', help='ssh login string. For upload')
    # add('-rf', '--remotefolder', default='scipionfiles/downloads/scipion/data/tests',
    #     help='remote folder to put the dataset there. For upload.')
    # add('-v', '--verbose', action='store_true', help='Print more details.')

    return parser


def main():
    args = get_parser().parse_args()

    # if len(sys.argv) < 3:
    #     usage("Incorrect number of input parameters")
    #
    projName = args.projName
    protId = args.protId

    now = dt.datetime.now()
    stamp = now.strftime("%y%m%d%H%M")

    manager = Manager()

    if not manager.hasProject(projName):
        usage("Unexistent project: %s" % pwutils.red(projName))

    project = manager.loadProject(projName)

    try:
        prot = project.getProtocol(protId)
    except:
        usage("Unexistent protocol with ID: %s" % pwutils.red(protId))

    outputCTF = prot.outputCTF
    #outputCTF.printAll()
    micSet = outputCTF.getMicrographs()
    #micSet.printAll()
    acq = micSet.getAcquisition()

    dc = DataClient(server_url=config.EMHUB_SERVER_URL)

    dc.login(config.EMHUB_USER, config.EMHUB_PASSWORD)

    if args.list:
        r = dc.request('get_sessions', jsonData={})
        for session in r.json():
            pprint(session)

    elif args.delete:
        for session_id in args.delete:
            json = dc.delete_session({'id': session_id})
            print("Deleted: ", json['name'])

    elif '--create' in sys.argv:
        attrs = {
            'acquisition': {'dosePerFrame': acq.getDosePerFrame(),
                            'exposureTime': -999,
                            'numberOfFrames': 1000,
                            'totalDose': 40,
                            'voltage': acq.getVoltage()},
            'booking_id': None,
            'end': '2021-02-23T08:00:00+00:00',
            'extra': {},
            'name': '%s-%s-%s' % (projName, protId, stamp),
            'operator_id': 8,
            'resource_id': None,
            'start': '2021-02-22T08:00:00+00:00',
            'stats': {'numOfCls2D': 0,
                      'numOfCtfs': outputCTF.getSize(),
                      'numOfMics': micSet.getSize(),
                      'numOfMovies': 0,
                      'numOfPtcls': 0,
                      'ptclSizeMax': 0,
                      'ptclSizeMin': 0},
            'status': 'running'
        }
        sessionDict = dc.create_session(attrs)
        setId = 'Micrographs_%06d' % micSet.getObjId()
        attrs = {
            'session_id': sessionDict['id'],
            'set_id': setId
        }
        dc.create_session_set(attrs)
        pprint(sessionDict)

        for ctf in outputCTF:
            u, v, a = ctf.getDefocus()
            ctfId = ctf.getObjId()
            mic = ctf.getMicrograph()

            attrs.update({
                'item_id': ctfId,
                'ctfDefocus': (u + v) * 0.5,
                'ctfDefocusU': u,
                'ctfDefocusV': v,
                'ctfDefocusAngle': a,
                'ctfResolution': ctf.getResolution(),
                'ctfFit': ctf.getFitQuality(),
                'location': mic.getFileName(),
                'ctfFitData': '',
                'shiftPlotData': ''
            })

            print("Adding item %06d" % ctfId)
            psdPath = os.path.join(project.path, ctf.getPsdFile())

            if os.path.exists(psdPath):
                print("  PSD: ", psdPath)
                attrs['psdData'] = mrc_to_base64(psdPath,
                                                 contrast_factor=5)

            micPath = os.path.join(project.path, ctf.getMicrograph().getFileName())
            if os.path.exists(micPath):
                print("  MIC: ", micPath)
                attrs['micThumbData'] = mrc_to_base64(micPath,
                                                      contrast_factor=10)


            dc.add_session_item(attrs)

    dc.logout()


if __name__ == '__main__':
    main()





