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

from emhub.client import DataClient


def usage(error):
    print("""
    ERROR: %s

    Usage: %s CSV_FILE_PATH
        CSV_FILE_PATH: provide the full path to TFS Health Monitor exported data.
    """ % (sys.argv[0], error))
    sys.exit(1)


# Dict to match cvs parameter names and db columns
MATCH_DICT = {
    'Date_Time': 'timestamp',
    'Phase Plate Slot': 'vpp_slot',
    'Phase Plate Preset Position Counter': 'vpp_position',
    'Count of acquisitions': 'acq_count',
    'Acquisition mode': 'acq_mode',
    'Fractions file format': 'frac_fmt',
    'Cartridge Load Counter': 'cartridge_count',
    'Cassette Load Counter': 'cassette_count',
    'Autoloader Dewar LN2 Usage (% per hour)': 'al_dewar_usage',
    'Column Dewar LN2 Usage (% per hour)': 'col_dewar_usage',
    'Emission Current': 'emission_current',
    'Gun Lens Index': 'gun_lens',
    'Spot Size': 'spot_size',
    'Nominal Magnification': 'mag',
    'Eftem Mode': 'eftem_mode',
    'Illumination Mode': 'illum_mode',
    'Column Valves States': 'column_valves',
    'Memory Load': 'memory_load',
    'Aberration Free Image Beam Shift is Enabled': 'afis',
    'Camera Mode': 'camera_mode',
    'Number of Completed Exposures': 'num_exp',
    'Images per Hole': 'img_per_hole',
    'Mean Image Dose Rate': 'dose_rate',
    'test_label_old': 'test_label_new',
}


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
        df = pd.read_csv(self.path, sep=',', names=cols, skiprows=12,
                           parse_dates=[['Date', 'Time']], )

        df.fillna(method='ffill', inplace=True)
        # TODO: check with different order?
        df.rename(columns=MATCH_DICT, inplace=True)
        # Make timestamp JSON-serializable
        df['timestamp'] = df['timestamp'].dt.strftime('%Y-%m-%dT%H:%M:%S.%fZ')
        self.data = df.to_dict(orient='records')


    def addHealthRecords(self):
        """ Create a session using REST API. """
        with open_client() as dc:
            print("=" * 80, "\nAdding health items...")
            dc.add_health_records({'items': self.data})


    def run(self):
        """ Main execute function. """
        self.parseCsv()
        self.addHealthRecords()



if __name__ == '__main__':
    if len(sys.argv) != 2:
        usage("Incorrect number of input parameters")
    else:
        job = ImportHealthData(path=sys.argv[1])
        job.run()
