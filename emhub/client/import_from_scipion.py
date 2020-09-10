#!/usr/bin/env python
# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *
# * [1] SciLifeLab, Stockholm University
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

"""
This script will compute the statistics of the SetOfCTFs in a given project.
"""

import sys

import pyworkflow as pw
from pyworkflow.project import Manager
import pyworkflow.utils as pwutils
import pwem

from emhub.utils import image
from emhub.data import H5SessionData


def usage(error):
    print("""
    ERROR: %s

    Usage: scipion python ctf_stats.py PROJECT CTF_PROT_ID
        PROJECT: provide the project name in which the workflow will be executed.
        CTF_PROT_ID: provide the ctf estimation protcol to use
    """ % error)
    sys.exit(1)


def getCtfStats(ctfSet):
    """ Compute some stats from a given set of ctf. """
    ctf = ctfSet.getFirstItem()
    minDefocus = ctf.getDefocusU()
    maxDefocus = ctf.getDefocusU()

    for ctf in ctfSet:
        minDefocus = min(minDefocus, ctf.getDefocusU(), ctf.getDefocusV())
        maxDefocus = max(maxDefocus, ctf.getDefocusU(), ctf.getDefocusV())

    return minDefocus, maxDefocus


MICROGRAPH_ATTRS = {
    'ctfDefocus': '_defocusU',
    'ctfDefocusU': '_defocusU',
    'ctfDefocusV': '_defocusV',
    'ctfDefocusAngle': '_defocusAngle',
    'ctfResolution': '_resolution',
    'ctfFit': '_fitQuality'
}

MICROGRAPH_DATA_ATTRS = [
    'micThumbData', 'psdData', 'ctfFitData', 'shiftPlotData'
]


if __name__ == '__main__':
    if len(sys.argv) != 3:
        usage("Incorrect number of input parameters")

    projName = sys.argv[1]
    protId = int(sys.argv[2])

    # Create a new project
    pw.Config.setDomain(pwem)
    manager = Manager()

    if not manager.hasApplication(projName):
        usage("Unexistent project: %s" % pwutils.red(projName))

    project = manager.loadApplication(projName)
    ctfProt = project.getProtocol(protId)

    outputCtf = ctfProt.outputCTF
    print(ctfProt.getRunName(), '- outputCTF')
    minDefocus, maxDefocus = getCtfStats(outputCtf)
    print("  defocus: (%0.4f - %0.4f)" % (minDefocus, maxDefocus))

    hsd = H5SessionData('/tmp/%s.h5' % projName, 'w')
    setId = outputCtf.getObjId()
    hsd.create_set(setId)
    for ctf in outputCtf:
        itemId = ctf.getObjId()
        mic = ctf.getMicrograph()
        values = {
            'id': itemId,
            'location': mic.getFileName()
        }
        values.update({k: ctf.getAttributeValue(MICROGRAPH_ATTRS[k], '')
                       for k in MICROGRAPH_ATTRS.keys()})
        values['micThumbData'] = image.fn_to_base64(mic.thumbnail.getFileName())
        values['psdData'] = ''
        values['shiftPlotData'] = image.fn_to_base64(mic.plotGlobal.getFileName())
        #pwutils.prettyDict(values)
        hsd.add_item(setId, itemId=ctf.getObjId(), **values)
        print("%s - defocus %s" % (ctf._micObj.thumbnail.getFileName(), ctf.getDefocusU()))

    hsd.close()


