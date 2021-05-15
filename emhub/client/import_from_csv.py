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
import sys
import pandas as pd
from contextlib import contextmanager

from emhub.client import DataClient


def usage(error):
    print("""
    ERROR: %s

    Usage: %s CSV_FILE_PATH MICROSCOPE_NAME
        CSV_FILE_PATH: provide the full path to TFS Health Monitor exported data.
        MICROSCOPE_NAME: microscope name
    """ % (sys.argv[0], error))
    sys.exit(1)


@contextmanager
def open_client():
    dc = DataClient()
    try:
        dc.login('stairs', 'stairs')
        yield dc
    finally:
        dc.logout()


class ImportHealthData:
    def __init__(self, path, microscope):
        self.path = path
        self.microscope = microscope

    def _convert(self, value):
        """ Convert a string to datatype. """
        if value == "":
            return value
        elif len(value.split(".")) == 2:
            return float(value)
        elif value.lstrip("-").isdecimal():
            return int(value)
        else:
            return str(value)

    def parse_header(self):
        """ Parse CSV header. """
        header = pd.read_csv(self.path, sep=',', header=None, skiprows=5,
                             nrows=6, index_col=1)
        #self.microscope = header[2][0]
        self.params = ["Date", "Time"]
        self.dtypes = {}

        for i in range(2, len(header.columns)+1):
            self.params.append("%s/%s/%s" % (header[i][1], header[i][2], header[i][3]))
            self.dtypes[self.params[-1]] = self._convert


    def parse_data(self):
        """ Parse CSV data into json. """
        with pd.read_csv(self.path, sep=',', skiprows=12,
                         parse_dates=[["Date", "Time"]],
                         index_col=0, na_filter=False,
                         error_bad_lines=False, names=self.params,
                         converters=self.dtypes,
                         chunksize=5000) as reader, open_client() as dc:
            print("=" * 80, "\nAdding health items...")
            for chunk in reader:
                dc.add_health_records({'items': chunk.to_json(orient='index'),
                                       'microscope': self.microscope})

    def run(self):
        """ Main execute function. """
        self.parse_header()
        self.parse_data()


if __name__ == '__main__':
    if len(sys.argv) != 3:
        usage("Incorrect input parameters.")
    else:
        job = ImportHealthData(path=sys.argv[1], microscope=sys.argv[2])
        job.run()
