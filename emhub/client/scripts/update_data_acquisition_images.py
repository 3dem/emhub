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
This script will update images key in the extra of the entries that are of type Data Acquisition
"""

import os
import sys
import time
import argparse
import subprocess
import datetime as dt
import tempfile
from pprint import pprint


from emhub.client import open_client, config


def main():

    instance = os.environ['EMHUB_INSTANCE']
    entry_files = os.path.join(instance, 'entry_files')

    print("EMHUB_SERVER_URL: ", config.EMHUB_SERVER_URL)
    print("EMHUB_INSTANCE: ", instance)


    with open_client() as dc:
        r = dc.request('get_entries', jsonData={})
        for entry in r.json():
            entry_id = entry['id']
            t = entry['type']
            images = []
            extra = entry['extra']
            data = extra.get('data', {})
            for k, v in data.items():
                if k.endswith('_image'):
                    images.append((k, v))

            if images:
                print("\nentry: ", entry_id, "type: ", t)
                print("   images: ")
                if not 'images_table' in data:
                    data['images_table'] = []

                for k, v in images:
                    print("    - %s = %s" % (k, v))
                    fn, ext = os.path.splitext(v)
                    old_fn = os.path.join(entry_files, 'entry-file-%06d-%s%s'
                                          % (entry_id, k, ext))
                    #print("      old_file: ", old_fn, "exists: ", os.path.exists(old_fn))
                    new_fn = os.path.join(entry_files, 'entry-file-%06d-%s'
                                          % (entry_id, v))
                    print("mv %s '%s'" % (os.path.basename(old_fn), os.path.basename(new_fn)))

                    if k == 'atlas_image':
                        title = 'Atlas'
                    elif k == 'micrograph_image':
                        title = 'Micrograph'
                    else:
                        title = k

                    data['images_table'].append({'image_title': title,
                                                 'image_file': v})
                    del data[k]
                    print("   -> Updating extra with:")
                    pprint(extra)
                    r2 = dc.request('update_entry', jsonData={
                        'attrs': {'id': entry_id,
                                  'extra': extra
                                  }
                    })


if __name__ == '__main__':
    main()





