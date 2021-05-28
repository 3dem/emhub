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
from emhub.utils.image import mrc_to_base64, array_to_base64


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
    g.add_argument('--create', action='store_true',
                   help="Create a new session")
    g.add_argument('--update', action='store_true',
                   help="Update an existing session")
    g.add_argument(
        '--delete', metavar='SESSION_ID', type=int, nargs='+',
        help='Delete one or several sessions.')

    add('-p', '--project', metavar='PROJECT_NAME',
        help='Project name.')

    add('--session_id', type=int,
        help='Session Id')

    add('--prot_ctf', type=int, default=0,
        help="Id of the CTF protocol to monitor. ")

    add('--prot_picking', type=int, default=0,
        help="Id of the particle picking protocol to monitor. ")

    add('--prot_2d', type=int, default=0,
        help='Id of the classify 2d protocol.')

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


def load_project(projName, protIdList):
    """ Load a project by name and a list of protocols given their ids. """
    manager = Manager()

    if not manager.hasProject(projName):
        usage("Unexistent project: %s" % pwutils.red(projName))

    project = manager.loadProject(projName)

    def load_protocol(protId):
        try:
            return project.getProtocol(protId)
        except:
            usage("Unexistent protocol with ID: %s" % pwutils.red(protId))

    return project, [load_protocol(protId) for protId in protIdList]


def notify_session(projName, protIdList):
    now = dt.datetime.now()
    stamp = now.strftime("%y%m%d%H%M")

    project, protocols = load_project(projName, protIdList)
    protId = protIdList[0]
    prot = protocols[0]

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


class ProjectSession:
    def __init__(self, projName, sessionId):
        self._sessionId = sessionId
        manager = Manager()

        if not manager.hasProject(projName):
            usage("Unexistent project: %s" % pwutils.red(projName))

        self._project = manager.loadProject(projName)

    def _get_path(self, *paths):
        return os.path.join(self._project.path, *paths)

    def _load_protocol(self, protId):
        try:
            return self._project.getProtocol(protId)
        except:
            usage("Unexistent protocol with ID: %s" % pwutils.red(protId))

    def _update_coords(self, dc, protCoordsId, micSetDict):
        protPicking = self._load_protocol(protCoordsId)
        coordsSet = getattr(protPicking, 'outputCoordinates', None)
        attrs = {
            'session_id': self._sessionId,
            'set_id': micSetDict['id'],
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

    def _update_classes(self, dc, protClass2DId, sets):
        prot2D = self._load_protocol(protClass2DId)
        outputClasses = getattr(prot2D, 'outputClasses', None)
        outputClasses.printAll()
        setId = 'Class2D_%06d' % protClass2DId
        attrs = {
            'session_id': self._sessionId,
            'set_id': setId,
            'size': outputClasses.getSize()
        }
        if any(s['id'] == setId for s in sets):
            set_func = dc.update_session_set
            item_func = dc.update_session_item
            label = 'Updating'
        else:
            set_func = dc.create_session_set
            item_func = dc.add_session_item
            label = 'Creating'

        print("- %s set %s" % (label, setId))
        set_func(attrs)

        import mrcfile
        fn = outputClasses.getFirstItem().getRepresentative().getFileName()
        mrc_stack = mrcfile.open(fn, permissive=True)

        for class2d in outputClasses:
            rep = class2d.getRepresentative()
            rep.setFileName(self._get_path(rep.getFileName()))
            i = rep.getIndex() - 1
            attrs.update({
                'item_id': class2d.getObjId(),
                'size': class2d.getSize(),
                'average': array_to_base64(mrc_stack.data[i,:,:])
            })
            for i in range(3):  # try 3 times
                try:
                    item_func(attrs)
                    break
                except Exception as e:
                    print("dc.add_session_item:: Error: %s" % e)
                    print("                      Trying again in 3 seconds.")
                    time.sleep(3)

    def update_session(self, protCoordsId, protClass2DId):

        with open_client() as dc:
            sessionDict = dc.get_session(self._sessionId)
            pprint(sessionDict)
            sets = dc.get_session_sets({'session_id': self._sessionId})

            print("\n>>> Sets:")
            for s in sets:
                pprint(s)

            if protCoordsId:
                print("\n>>> Updating coordinates...")
                self._update_coords(dc, protCoordsId, sets[0])

            if protClass2DId:
                print("\n>>> Updating classes...")
                print("- Using protocol id=%d" % protClass2DId)


                self._update_classes(dc, protClass2DId, sets)








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
        notify_session(args.project, [args.prot_ctf])

    elif args.update:
        ps = ProjectSession(args.project, args.session_id)
        ps.update_session(args.prot_picking, args.prot_2d)

    else:
        print("Please provide some arguments")
        sys.exit(1)


if __name__ == '__main__':
    main()





