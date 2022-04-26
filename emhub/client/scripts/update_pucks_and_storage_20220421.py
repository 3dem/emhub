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
This script will insert New Pucks
and then also update the existing Grid Storage Entries
"""

import os
import sys
import time
import argparse
import subprocess
import datetime as dt
import tempfile
from pprint import pprint
from io import StringIO


from emhub.client import open_client, config

LOCATION_LABELS = ['dewar_number', 'cane_number', 'puck_number']


def location(row, labels=None):
    labels = labels or LOCATION_LABELS
    return tuple([int(row.get(k, 0)) for k in labels])


def update_old_puck(dc, puck):
    loc = location(puck, labels=['dewar', 'cane', 'position'])
    puck['code'] = None
    label = 'OLD_PUCK-D%dC%02dP%02d' % loc
    puck['label'] = label

    dc.request('update_puck', jsonData={'attrs': puck})

    return loc


def print_puck(puck):
    puck_str = str(puck).replace('position', 'p')
    print(puck_str)


def list_pucks():
    with open_client() as dc:
        r = dc.request('get_pucks', jsonData={})
        for puck in r.json():
            print_puck(puck)


def update_pucks_label():
    with open_client() as dc:
        locDict = {}

        r = dc.request('get_pucks', jsonData={})

        for puck in r.json():
            loc = update_old_puck(dc, puck)
            print_puck(puck)
            locDict[loc] = puck

    return locDict


def list_entries():
    with open_client() as dc:
        r = dc.request('get_entries', jsonData={})
        for entry in r.json():
            t = entry['type']
            if t == 'grids_storage':
                extra = entry['extra']
                table = extra.get('data', {}).get('grids_storage_table', [])

                if table:
                    print('Entry ', entry['id'])
                    for row in table:
                        print("   ", row)


def rename_col(row, old_col, new_col):
    if old_col in row:
        row[new_col] = row[old_col]
        del row[old_col]

def remove_key(obj, key):
    if key in obj:
        del obj[key]

def update_storage_entries(locDict):
    with open_client() as dc:
        r = dc.request('get_entries', jsonData={})
        for entry in r.json():
            t = entry['type']
            extra = entry['extra']
            data = extra.get('data', {})

            if t == 'grids_storage':
                remove_key(data, 'gridbox_slot')
                table = data.get('grids_storage_table', [])

                if table:
                    newTable = []
                    for row in table:
                        loc = location(row)
                        try:
                            puck = locDict[loc]
                            row['puck_id'] = puck['id']

                            rename_col(row, 'puck_position', 'box_position')
                            rename_col(row, 'gridbox_slot', 'grid_position')

                            newTable.append(row)
                        except Exception as e:
                            print('Error: ', e)
                            pprint(row)
                    data['grids_storage_table'] = newTable

                dc.request('update_entry', jsonData={'attrs': entry})
                    # loc = location(row)
                    # if loc:
                    #     print("   D%d-C%02d-P%02d" % tuple(loc),
                    #           'label=%s' % row.get('puck_label', ''),
                    #           'color=%s' % row.get('puck_color', ''))
            elif t == 'screening':
                if data:
                    rename_col(data, 'grids_storage_table', 'grids_table')
                    dc.request('update_entry', jsonData={'attrs': entry})


NEW_PUCKS = """
201	D1C1P1	SciLifeLab_0201	Red	1	10-01	1	group	Black
202	D1C1P2	SciLifeLab_0202	Orange	1	10-01	1	group
203	D1C1P3	SciLifeLab_0203	Green	1	10-01	1	group
204	D1C1P4	SciLifeLab_0204	Navy	1	10-01	1	group
205	D1C1P5	SciLifeLab_0205	Lilac	1	10-01	1	group
206	D1C1P6	SciLifeLab_0206	Black	1	10-01	1	group
207	D1C1P7	SciLifeLab_0207	Silver	1	10-01	1	group
208	D1C1P8	SciLifeLab_0208	Pink	1	10-01	1	group
209	D1C1P9	SciLifeLab_0209	Blue	1	10-01	1	group
210	D1C1P10	SciLifeLab_0210	Gold	1	10-01	1	group
211	D1C2P1	SciLifeLab_0211	Red	1	10-02	1	group	Green
212	D1C2P2	SciLifeLab_0212	Orange	1	10-02	1	group
213	D1C2P3	SciLifeLab_0213	Green	1	10-02	1	group
214	D1C2P4	SciLifeLab_0214	Navy	1	10-02	1	group
215	D1C2P5	SciLifeLab_0215	Lilac	1	10-02	1	group
216	D1C2P6	SciLifeLab_0216	Black	1	10-02	1	group
217	D1C2P7	SciLifeLab_0217	Silver	1	10-02	1	group
218	D1C2P8	SciLifeLab_0218	Pink	1	10-02	1	group
219	D1C2P9	SciLifeLab_0219	Blue	1	10-02	1	group
220	D1C2P10	SciLifeLab_0220	Gold	1	10-02	1	group
221	D1C3P1	SciLifeLab_0221	Red	1	10-03	1	group	Pink
222	D1C3P2	SciLifeLab_0222	Orange	1	10-03	1	group
223	D1C3P3	SciLifeLab_0223	Green	1	10-03	1	group
224	D1C3P4	SciLifeLab_0224	Navy	1	10-03	1	group
225	D1C3P5	SciLifeLab_0225	Lilac	1	10-03	1	group
226	D1C3P6	SciLifeLab_0226	Black	1	10-03	1	group
227	D1C3P7	SciLifeLab_0227	Silver	1	10-03	1	group
228	D1C3P8	SciLifeLab_0228	Pink	1	10-03	1	group
229	D1C3P9	SciLifeLab_0229	Blue	1	10-03	1	group
230	D1C3P10	SciLifeLab_0230	Gold	1	10-03	1	group
231	D1C4P1	SciLifeLab_0231	Red	1	10-04	1	group	Red
232	D1C4P2	SciLifeLab_0232	Orange	1	10-04	1	group
233	D1C4P3	SciLifeLab_0233	Green	1	10-04	1	group
234	D1C4P4	SciLifeLab_0234	Navy	1	10-04	1	group
235	D1C4P5	SciLifeLab_0235	Lilac	1	10-04	1	group
236	D1C4P6	SciLifeLab_0236	Black	1	10-04	1	group
237	D1C4P7	SciLifeLab_0237	Silver	1	10-04	1	group
238	D1C4P8	SciLifeLab_0238	Pink	1	10-04	1	group
239	D1C4P9	SciLifeLab_0239	Blue	1	10-04	1	group
240	D1C4P10	SciLifeLab_0240	Gold	1	10-04	1	group
241	D1C5P1	SciLifeLab_0241	Red	1	10-05	1	group	Lilac
242	D1C5P2	SciLifeLab_0242	Orange	1	10-05	1	group
243	D1C5P3	SciLifeLab_0243	Green	1	10-05	1	group
244	D1C5P4	SciLifeLab_0244	Navy	1	10-05	1	group
245	D1C5P5	SciLifeLab_0245	Lilac	1	10-05	1	group
246	D1C5P6	SciLifeLab_0246	Black	1	10-05	1	group
247	D1C5P7	SciLifeLab_0247	Silver	1	10-05	1	group
248	D1C5P8	SciLifeLab_0248	Pink	1	10-05	1	group
249	D1C5P9	SciLifeLab_0249	Blue	1	10-05	1	group
250	D1C5P10	SciLifeLab_0250	Gold	1	10-05	1	group
251	D1C6P1	SciLifeLab_0251	Red	1	10-06	1	group	Blue
252	D1C6P2	SciLifeLab_0252	Orange	1	10-06	1	group
253	D1C6P3	SciLifeLab_0253	Green	1	10-06	1	group
254	D1C6P4	SciLifeLab_0254	Navy	1	10-06	1	group
255	D1C6P5	SciLifeLab_0255	Lilac	1	10-06	1	group
256	D1C6P6	SciLifeLab_0256	Black	1	10-06	1	group
257	D1C6P7	SciLifeLab_0257	Silver	1	10-06	1	group
258	D1C6P8	SciLifeLab_0258	Pink	1	10-06	1	group
259	D1C6P9	SciLifeLab_0259	Blue	1	10-06	1	group
260	D1C6P10	SciLifeLab_0260	Gold	1	10-06	1	group
261	D1C7P1	SciLifeLab_0261	Red	1	10-07	1	group	Gold
262	D1C7P2	SciLifeLab_0262	Orange	1	10-07	1	group
263	D1C7P3	SciLifeLab_0263	Green	1	10-07	1	group
264	D1C7P4	SciLifeLab_0264	Navy	1	10-07	1	group
265	D1C7P5	SciLifeLab_0265	Lilac	1	10-07	1	group
266	D1C7P6	SciLifeLab_0266	Black	1	10-07	1	group
267	D1C7P7	SciLifeLab_0267	Silver	1	10-07	1	group
268	D1C7P8	SciLifeLab_0268	Pink	1	10-07	1	group
269	D1C7P9	SciLifeLab_0269	Blue	1	10-07	1	group
270	D1C7P10	SciLifeLab_0270	Gold	1	10-07	1	group
271	D1C8P1	SciLifeLab_0271	Red	1	10-08	1	group	Orange
272	D1C8P2	SciLifeLab_0272	Orange	1	10-08	1	group
273	D1C8P3	SciLifeLab_0273	Green	1	10-08	1	group
274	D1C8P4	SciLifeLab_0274	Navy	1	10-08	1	group
275	D1C8P5	SciLifeLab_0275	Lilac	1	10-08	1	group
276	D1C8P6	SciLifeLab_0276	Black	1	10-08	1	group
277	D1C8P7	SciLifeLab_0277	Silver	1	10-08	1	group
278	D1C8P8	SciLifeLab_0278	Pink	1	10-08	1	group
279	D1C8P9	SciLifeLab_0279	Blue	1	10-08	1	group
280	D1C8P10	SciLifeLab_0280	Gold	1	10-08	1	group
281	D1C9P1	SciLifeLab_0281	Red	1	10-09	1	group	Navy
282	D1C9P2	SciLifeLab_0282	Orange	1	10-09	1	group
283	D1C9P3	SciLifeLab_0283	Green	1	10-09	1	group
284	D1C9P4	SciLifeLab_0284	Navy	1	10-09	1	group
285	D1C9P5	SciLifeLab_0285	Lilac	1	10-09	1	group
286	D1C9P6	SciLifeLab_0286	Black	1	10-09	1	group
287	D1C9P7	SciLifeLab_0287	Silver	1	10-09	1	group
288	D1C9P8	SciLifeLab_0288	Pink	1	10-09	1	group
289	D1C9P9	SciLifeLab_0289	Blue	1	10-09	1	group
290	D1C9P10	SciLifeLab_0290	Gold	1	10-09	1	group
291	D1C10P1	SciLifeLab_0291	Red	1	10-10	1	group	Silver
292	D1C10P2	SciLifeLab_0292	Orange	1	10-10	1	group
293	D1C10P3	SciLifeLab_0293	Green	1	10-10	1	group
294	D1C10P4	SciLifeLab_0294	Navy	1	10-10	1	group
295	D1C10P5	SciLifeLab_0295	Lilac	1	10-10	1	group
296	D1C10P6	SciLifeLab_0296	Black	1	10-10	1	group
297	D1C10P7	SciLifeLab_0297	Silver	1	10-10	1	group
298	D1C10P8	SciLifeLab_0298	Pink	1	10-10	1	group
299	D1C10P9	SciLifeLab_0299	Blue	1	10-10	1	group
300	D1C10P10	SciLifeLab_0300	Gold	1	10-10	1	group
301	D2C1P1	SciLifeLab_0301	Red	2	10-11	1	group	Green
302	D2C1P2	SciLifeLab_0302	Orange	2	10-11	1	group
303	D2C1P3	SciLifeLab_0303	Green	2	10-11	1	group
304	D2C1P4	SciLifeLab_0304	Navy	2	10-11	1	group
305	D2C1P5	SciLifeLab_0305	Lilac	2	10-11	1	group
306	D2C1P6	SciLifeLab_0306	Black	2	10-11	1	group
307	D2C1P7	SciLifeLab_0307	Silver	2	10-11	1	group
308	D2C1P8	SciLifeLab_0308	Pink	2	10-11	1	group
309	D2C1P9	SciLifeLab_0309	Blue	2	10-11	1	group
310	D2C1P10	SciLifeLab_0310	Gold	2	10-11	1	group
311	D2C2P1	SciLifeLab_0311	Red	2	10-12	1	group	Gold
312	D2C2P2	SciLifeLab_0312	Orange	2	10-12	1	group
313	D2C2P3	SciLifeLab_0313	Green	2	10-12	1	group
314	D2C2P4	SciLifeLab_0314	Navy	2	10-12	1	group
315	D2C2P5	SciLifeLab_0315	Lilac	2	10-12	1	group
316	D2C2P6	SciLifeLab_0316	Black	2	10-12	1	group
317	D2C2P7	SciLifeLab_0317	Silver	2	10-12	1	group
318	D2C2P8	SciLifeLab_0318	Pink	2	10-12	1	group
319	D2C2P9	SciLifeLab_0319	Blue	2	10-12	1	group
320	D2C2P10	SciLifeLab_0320	Gold	2	10-12	1	group
"""

COLOR_MAP = {
    'Pink': 'HotPink',
    'Lilac': 'Plum',
    'Blue': 'LightSteelBlue',
    'Navy': 'MediumBlue',
    'Gold': 'Moccasin',
    'Silver': 'Gainsboro'
}

NEW_SCREENING = """{
    "title": "Screening",
    "sections": [
        {
            "label": "Grids Comments",
            "params": [
                {
                    "id": "grids_table",
                    "label": "Grids Table",
                    "type": "table",
                    "columns": [
                        {
                            "id": "gridbox_label",
                            "label": "Grid Label"
                        },
                        {
                            "id": "sample",
                            "label": "Sample",
                            "type": "text"
                        },
                        {
                            "id": "comments",
                            "label": "Comments",
                            "type": "text"
                        }
                    ],
                    "min_rows": 5
                }
            ]
        },
        {
            "label": "Report Images",
            "params": [
                {
                    "id": "images_table",
                    "label": "Images Table",
                    "type": "table",
                    "columns": [
                        {
                            "id": "image_title",
                            "label": "Image Title"
                        },
                        {
                            "id": "image_description",
                            "label": "Image Description",
                            "type": "text"
                        },
                        {
                            "id": "image_file",
                            "label": "Image File",
                            "type": "file_image"
                        }
                    ],
                    "min_rows": 5
                }
            ]
        }
    ]
}"""

NEW_STORAGE = """{
    "title": "Grids Storage",
    "params": [
        {
            "id": "grids_storage_table",
            "label": "Grids Storage Table",
            "type": "table",
            "columns": [
                {
                    "id": "gridbox_label",
                    "label": "GridBox Label"
                },
                {
                    "id": "puck_id",
                    "label": "Puck",
                    "type": "custom",
                    "template": "param_select_puck.html"
                },
                {
                    "id": "box_position",
                    "label": "Box Position",
                    "enum": {
                        "choices": [
                            1,
                            2,
                            3,
                            4,
                            5,
                            6,
                            7,
                            8,
                            9,
                            10,
                            11,
                            12
                        ],
                        "display": "combo"
                    }
                },
                {
                    "id": "grid_position",
                    "label": "Grid Position",
                    "enum": {
                        "choices": [
                            1,
                            2,
                            3,
                            4
                        ],
                        "display": "combo",
                        "multiple": true
                    }
                },
                {
                    "id": "sample",
                    "label": "Sample",
                    "type": "text"
                },
                {
                    "id": "sessions",
                    "label": "Session(s)"
                },
                {
                    "id": "atlas",
                    "label": "Atlas",
                    "type": "bool"
                },
                {
                    "id": "EPU",
                    "label": "EPU",
                    "type": "bool"
                }
            ],
            "min_rows": 5
        }
    ]
}"""

def _color(c):
    return COLOR_MAP.get(c, c)

def insert_new_pucks():
    with open_client() as dc:
        f = StringIO(NEW_PUCKS)
        last_dewar = 0

        for line in f:
            if line.strip():
                parts = line.split()
                d = int(parts[4])
                c = int(parts[5].replace('10-', ''))
                p = int(parts[1].split('P')[1])

                extra = {}

                if d != last_dewar:
                    extra['dewar'] = {
                    }
                    last_dewar = d

                if p == 1:
                    extra['cane'] = {
                        'label': parts[5],
                        'color': _color(parts[8])
                    }

                puck = {'id': int(parts[0]),
                        'code': None,
                        'label': parts[2],
                        'color': _color(parts[3]),
                        'dewar': d,
                        'cane': c,
                        'position': p,
                        'extra': extra}

                print("Creating puck: ", puck)
                dc.request('create_puck', jsonData={'attrs': puck})
                print(dc.json())


def main():

    instance = os.environ['EMHUB_INSTANCE']
    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)
    print("EMHUB_INSTANCE: ", instance)

    update = '--update' in sys.argv

    if update:
        locDict = update_pucks_label()
        update_storage_entries(locDict)
        insert_new_pucks()
    else:
        list_pucks()
        #list_entries()
        #insert_new_pucks()



if __name__ == '__main__':
    main()





