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

import json
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
        self.bucket = "test1"

    def create_rows(self, **kwargs):
        print(kwargs['items'], "\n\n")
        scope = "scope4" #kwargs.get("microscope").replace(" ", "\ ")
        items = json.loads(kwargs.get("items", ""))

        lines = []
        for point in items:
            fields = []
            timestp = int(point)
            for k, v in items[point].items():
                k = k.replace(" ", "\ ")
                if v == '':
                    continue
                elif isinstance(v, str):
                    fields.append('%s="%s"' % (k, v))
                else:
                    fields.append('%s=%s' % (k, v))
            fields = ",".join(fields)
            lines.append('%s %s %d' % (scope, fields, timestp))

        print("\n".join(lines))

        client = InfluxDBClient(url=self.url, token=self.token, org=self.org,
                                enable_gzip=True)
        write_api = client.write_api(write_options=WriteOptions(SYNCHRONOUS))
        write_api.write(bucket=self.bucket, org=self.org, record="\n".join(lines),
                        write_precision=WritePrecision.MS)
        write_api.close()
        client.close()

        return {"items": ''}

    def items_from_query(self, condition=None, orderBy=None, asJson=False):
        client = InfluxDBClient(url=self.url, token=self.token, org=self.org,
                                enable_gzip=True)
        query = '''
                from(bucket:"test1") |> range(start: -1y)
                |> filter(fn: (r) => r["_measurement"] == "scope4")
                |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
                |> drop(columns: ["_start", "_stop", "_measurement"])
                '''
        result = client.query_api().query_data_frame(org=self.org, query=query)
        #result.set_index("_time", inplace=True)
        results = result.to_json(orient='records')
        print(results)
        client.close()

        if condition is not None:
            pass

        if orderBy is not None:
            pass

        #return [s.json() for s in result] if asJson else result
        return results

    def json(self):
        return DbManager.json_from_object(self)
