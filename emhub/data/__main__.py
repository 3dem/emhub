
import os
import sys

from .data_manager import DataManager
from .imports.test import TestData
from .imports.scilifelab import PortalData
from .imports.stjude import SJData

SLL = 1
SJ = 2


if __name__ == '__main__':
    instance_path = os.path.abspath(os.environ.get("EMHUB_INSTANCE",
                                                   'instance'))

    if not os.path.exists(instance_path):
        raise Exception("Instance folder '%s' does not exist. Create that folder first. "
                        % instance_path)

    mode = None

    if len(sys.argv) > 1:
        dataFile = sys.argv[1]
        if not os.path.exists(dataFile):
            raise Exception("Input data file '%s' does not exists. " % dataFile)

        if dataFile.endswith('csv'):
            mode = SJ
        elif dataFile.endswith('json'):
            mode = SLL
            bookingsJson = sys.argv[2]

            if not os.path.exists(bookingsJson):
                raise Exception("JSON bookings file '%s' does not exists. " % bookingsJson)

    dm = DataManager(instance_path, cleanDb=True)

    if mode == SLL:
        PortalData(dm, portalDataJson, bookingsJson)
    elif mode == SJ:
        SJData(dm, dataFile)
    else:
        TestData(dm)
