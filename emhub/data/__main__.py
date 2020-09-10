
import os
import sys

from .data_manager import DataManager
from .imports.testdata import TestData
from .imports.scilifelab_portal import PortalData


if __name__ == '__main__':
    instance_path = os.path.abspath(os.environ.get("EMHUB_INSTANCE",
                                                   'instance'))

    if not os.path.exists(instance_path):
        raise Exception("Please execute the test command from the root of the "
                        "working directory.")

    if len(sys.argv) > 1:
        portalDataJson = sys.argv[1]
        bookingsJson = sys.argv[2]

        if not os.path.exists(portalDataJson):
            print("JSON data file '%s' does not exists. " % portalDataJson)

        if not os.path.exists(bookingsJson):
            print("JSON bookings file '%s' does not exists. " % bookingsJson)
    else:
        portalDataJson = None

    dm = DataManager(instance_path, cleanDb=True)

    if portalDataJson:
        PortalData(dm, portalDataJson, bookingsJson)
    else:
        TestData(dm)
