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
import pandas as pd
from datetime import datetime, timezone, timedelta

from emhub.client import DataClient


def usage(error):
    print("""
    ERROR: %s

    Usage: %s CSV_FILE_PATH
        CSV_FILE_PATH: provide the full path to TFS Health Monitor exported data.
    """ % (sys.argv[0], error))
    sys.exit(1)

TZ_DELTA = 0  # Define timezone, UTC '0'
tzinfo = timezone(timedelta(hours=TZ_DELTA))


class ImportHealthData:
    def __init__(self, path):
        self.path = path
        self.name = os.path.basename(self.path)

    def parseCsv(self):
        """ Parse CSV file into a dict. """
        cols = ["Date", "Time"]
        header = pd.read_csv(self.path, sep=',', header=None, skiprows=5,
                             nrows=6, index_col=1)
        # Add "Parameter" names to the cols list
        for ind in range(2, len(header.columns) + 1):
            cols.append(header[ind][3])

        # Merge Date and Time columns
        print("Parsing CSV file...")
        data = pd.read_csv(self.path, sep=',', names=cols, skiprows=12,
                           parse_dates=[['Date', 'Time']], )#dtype=typesdict)
        # Set date_time as index
        data = data.set_index(['Date_Time'])
        data.sort_index(inplace=True, ascending=True)
        data.fillna(method='ffill', inplace=True)
        print("Parsed OK")

        return data

    def iterateItemsAttrs(self):
        """ Create a dict with Micrograph items. """
        print("Parsing Relion micrograph items...")
        for itemId, item in enumerate(self.results['CtfFind']):
            values = {
                'item_id': itemId + 1,
                'location': item.rlnMicrographName
            }

            yield values

    def createNewSession(self):
        """ Create a session using REST API. """
        sc = DataClient()
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
        self.parseCsv()
        #self.createNewSession()

# -------------------- UTILS functions ----------------------------------------

    def getRowsByDate(self, startdate, enddate=None):
        if enddate:
            return self.data.loc[startdate:enddate]
        else:
            return self.data.loc[startdate:]

    def getColsByName(self, colnames):
        return self.data[colnames]


if __name__ == '__main__':
    if len(sys.argv) != 2:
        usage("Incorrect number of input parameters")
    else:
        job = ImportHealthData(path=sys.argv[1])
        job.run()
