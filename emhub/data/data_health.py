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

import pandas as pd
import numpy as np
from influxdb_client import InfluxDBClient, WritePrecision, WriteOptions
from influxdb_client.client.write_api import SYNCHRONOUS

from .data_db import DbManager



class DataHealth(DbManager):
    """ Main class that will manage the health info about microscopes.
    """
    def __init__(self):
        self.url="http://localhost:8086"
        self.token = "ECCh91MEsbHtX8DwU-S_82IikgejP8GSQ8-Iki4QFZyeLcFe4W9P4_YZ8i3drdWnKYad9EEy7niZHd62YRPNUg=="
        self.org = "emhub"
        self.bucket = "health"

    def create_rows(self, **kwargs):
        items = kwargs.get("items", "")
        #print(items)

        df = pd.read_json(items, orient="index")
        # convert datetime ns to ms
        df.index = df.index.astype(np.int64) // int(1e6)
        scope = kwargs.get("microscope")

        print(df.shape)

        client = InfluxDBClient(url=self.url, token=self.token, org=self.org)
        write_api = client.write_api(write_options=WriteOptions(SYNCHRONOUS,
                                                                batch_size=1_000,
                                                                flush_interval=5_000))
        write_api.write(bucket=self.bucket, org=self.org, record=df,
                        data_frame_measurement_name=scope,
                        write_precision=WritePrecision.MS)
        write_api.close()

        client.close()

        return {"items": ''}

    def items_from_query(self, condition=None, orderBy=None, asJson=False):
        client = "tbd"
        query = '''
                from(bucket:"health") |> range(start: -1y)
                |> filter(fn: (r) => r["_measurement"] == "3413 (943205600511) [Titan Krios]")
                '''
        result = client.query_api().query_data_frame(org=self.org, query=query)
        print(result.head())

        client.close()

        if condition is not None:
            pass

        if orderBy is not None:
            pass

        #result = query.all()
        #return [s.json() for s in result] if asJson else result
