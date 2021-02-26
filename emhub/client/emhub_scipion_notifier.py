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
import time
import datetime as dt
import argparse
from pprint import pprint
from contextlib import contextmanager


from pyworkflow.project import Manager
import pyworkflow.utils as pwutils

from pwem.objects import SetOfCTF


class config:
    EMHUB_SOURCE = os.environ['EMHUB_SOURCE']
    EMHUB_SERVER_URL = os.environ['EMHUB_SERVER_URL']
    EMHUB_USER = os.environ['EMHUB_USER']
    EMHUB_PASSWORD = os.environ['EMHUB_PASSWORD']


# add emhub source code to the path and import client submodule
sys.path.append(config.EMHUB_SOURCE)

from emhub.client import DataClient
from emhub.utils.image import mrc_to_base64


def usage(error):
    print("ERROR: %s" % error)
    get_parser().print_usage()
    sys.exit(1)


@contextmanager
def open_client():
    dc = DataClient(server_url=config.EMHUB_SERVER_URL)
    try:
        dc.login(config.EMHUB_USER, config.EMHUB_PASSWORD)
        yield dc
    finally:
        dc.logout()


class SetMonitor:
    """ Monitor when there are changes to a given set. """
    def __init__(self, inputSet):
        self.__class = inputSet.getClass()
        self.__filename = inputSet.getFileName()
        self.__lastCheck = None
        self.count = 0

    @contextmanager
    def open_set(self):
        modified = pwutils.getFileLastModificationDate(self.__filename)

        if self.__lastCheck is None or modified > self.__lastCheck:
            setObj = self.__class(filename=self.__filename)
            setObj.loadAllProperties()
            yield setObj
            setObj.close()
        else:
            yield None

        self.__lastCheck = modified

    def update_count(self):
        """ Return True if there were new items. """
        old_count = self.count
        with self.open_set() as setObj:
            if setObj is not None:
                self.count = setObj.getSize()

        return self.count > old_count


def get_parser():
    """ Return the argparse parser, so we can get the arguments """

    parser = argparse.ArgumentParser()
    add = parser.add_argument  # shortcut

    # add('projName', metavar='PROJECT_NAME',
    #     help="Name of the Scipion project")
    #
    # add('protId', metavar='PROTOCOL_ID',
    #     help="ID of the CTF protocol. ")

    g = parser.add_mutually_exclusive_group()
    g.add_argument('--list', action='store_true',
                   help="List existing sessions in the server.")
    g.add_argument('--create', nargs=2,
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


def notify_session(projName, protId):
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

    outputCTF = getattr(prot, 'outputCTF', None)
    #outputCTF.printAll()
    micSet = prot.inputMicrographs.get()

    micParents = project.getSourceParents(micSet)

    for p in micParents:
        p.printAll()

    #micSet.printAll()
    acq = micSet.getAcquisition()

    stats = {
        'numOfCls2D': 0,
        'numOfCtfs': outputCTF.getSize(),
        'numOfMics': micSet.getSize(),
        'numOfMovies': 0,
        'numOfPtcls': 0,
        'ptclSizeMax': 0,
        'ptclSizeMin': 0
    }

    session_attrs = {
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
        'stats': stats,
        'status': 'running'
    }

    sessionId = None

    with open_client() as dc:
        sessionDict = dc.create_session(session_attrs)
        sessionId = sessionDict['id']

        setId = 'Micrographs_%06d' % micSet.getObjId()
        attrs = {
            'session_id': sessionId,
            'set_id': setId
        }
        dc.create_session_set(attrs)
        pprint(sessionDict)

    lastId = 0
    ctfMonitor = SetMonitor(outputCTF)
    micMonitor = SetMonitor(micSet)

    while True:
        found_new_mics = False
        ctfSet = SetOfCTF(filename=outputCTF.getFileName())
        ctfSet.loadAllProperties()

        with open_client() as dc:

            new_stats = {}

            for ctf in ctfSet.iterItems(where="id>%s" % lastId):
                u, v, a = ctf.getDefocus()
                lastId = ctfId = ctf.getObjId()
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

                for i in range(3):  # try 3 times
                    try:
                        dc.add_session_item(attrs)
                        break
                    except Exception as e:
                        print("dc.add_session_item:: Error: %s" % e)
                        print("                      Trying again in 3 seconds.")
                        time.sleep(3)

                new_stats['numOfCtfs'] = ctfSet.getSize()

            # Check if there are new micrographs
            if micMonitor.update_count():
                new_stats['numOfMics'] = micMonitor.count

            if new_stats:
                stats.update(new_stats)
                print("Updating session stats: ")
                print("   Mics: ", micMonitor.count)
                print("   CTFs: ", ctfSet.getSize())

                dc.update_session({'id': sessionId, 'stats': stats})
            else:
                time.sleep(10)

        ctfSet.close()

        print("lastId: ", lastId)

        if ctfSet.isStreamClosed():
            with open_client() as dc:
                dc.update_session({'id': sessionId, 'status': 'finished'})
            break


def main():
    args = get_parser().parse_args()

    if args.list:
        with open_client() as dc:
            r = dc.request('get_sessions', jsonData={})

            for session in r.json():
                pprint(session)

    elif args.delete:
        with open_client() as dc:
            for session_id in args.delete:
                json = dc.delete_session({'id': session_id})
                print("Deleted: ", json['name'])

    elif args.create:
        projName = args.create[0]
        protId = int(args.create[1])
        notify_session(projName, protId)


if __name__ == '__main__':
    main()





