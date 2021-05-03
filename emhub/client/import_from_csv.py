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
import pandas as pd
from contextlib import contextmanager
#from influxdb_client import InfluxDBClient

from emhub.client import DataClient


def usage(error):
    print("""
    ERROR: %s

    Usage: %s CSV_FILE_PATH
        CSV_FILE_PATH: provide the full path to TFS Health Monitor exported data.
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
    def __init__(self, path):
        self.path = path
        self.name = os.path.basename(self.path)

    def parse_header(self):
        """ Parse CSV header and return a nested dict of params. """
        header = pd.read_csv(self.path, sep=',', header=None, skiprows=5,
                             nrows=6, index_col=1)
        self.microscope = header[2][0]
        params = ["Date", "Time"]

        for i in range(2, len(header.columns)+1):
            params.append("%s/%s/%s" % (header[i][1], header[i][2], header[i][3]))

        return params

    def parseCsv(self, params):
        """ Parse CSV data into a dict. """
        self.df = pd.read_csv(self.path, sep=',', skiprows=12,
                         parse_dates=[["Date", "Time"]],
                         index_col=0,
                         keep_default_na=False,
                         na_filter=False, error_bad_lines=False,
                         names=params)

        #print(self.df.info())
        self.jsonData = self.df.to_json(orient='index')

    def addHealthRecords(self):
        """ Create a session using REST API. """
        with open_client() as dc:
            print("=" * 80, "\nAdding health items...")
            dc.add_health_records({'items': self.jsonData, 'microscope': self.microscope})

    def testInflux(self):
        # TODO: remove this later
        # You can generate a Token from the "Tokens Tab" in the UI
        token = "ECCh91MEsbHtX8DwU-S_82IikgejP8GSQ8-Iki4QFZyeLcFe4W9P4_YZ8i3drdWnKYad9EEy7niZHd62YRPNUg=="
        org = "emhub"
        bucket = "health"

        client = InfluxDBClient(url="http://localhost:8086", token=token,
                                org=org)
        # if DEBUG:
        #     print(self.df)
        #     print(self.df.index)
        #     print(self.df.columns)
        #
        # write_api = client.write_api(write_options=SYNCHRONOUS)
        # write_api.write(bucket=bucket, org=org, record=self.df,
        #                 data_frame_measurement_name=self.microscope)
        # write_api.close()

        query = '''
                 from(bucket:"health") |> range(start: -1y)
                 |> filter(fn: (r) => r["_measurement"] == "%s")
                 '''
        result = client.query_api().query(org=org, query=query % self.microscope)

        for table in result:
            print(table)
            for record in table.records:
                print(str(record["_time"]) + " - " + record["_field"] + ": " + str(record["_value"]))

        client.close()

    def run(self):
        """ Main execute function. """
        columns = self.parse_header()
        self.parseCsv(columns)
        self.addHealthRecords()
        #self.testInflux()


if __name__ == '__main__':
    if len(sys.argv) != 2:
        usage("Incorrect number of input parameters")
    else:
        job = ImportHealthData(path=sys.argv[1])
        job.run()
