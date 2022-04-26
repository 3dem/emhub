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
This script will compute the statistics of the SetOfCTFs in a given project.
"""

import os, sys


from emhub.client import open_client


def main():
    verbose = '-v' in sys.argv or '--verbose' in sys.argv
    copy = '-c' in sys.argv or '--copy' in sys.argv

    with open_client() as dc:
        req = dc.request('get_resources', jsonData={})
        for r in req.json():
            r_id = int(r['id'])
            r_image = r['image']
            static_fn = os.path.join('emhub', 'static', 'images', r_image)
            exists_static = os.path.exists(static_fn)
            resources_fn = os.path.join(os.environ['EMHUB_INSTANCE'], 'resource_files',
                                        'resource-image-%06d-%s' % (r_id, r_image))
            exists_resources = os.path.exists(resources_fn)

            if verbose:
                print('id: ', r_id, 'image: ', r_image,
                      '\n   static:', exists_static,
                      '\n   resources:', exists_resources)

            if exists_static and not exists_resources:
                cmd = 'cp %s %s' % (static_fn, resources_fn)
                print(cmd)
                if copy:
                    os.system(cmd)


if __name__ == '__main__':
    main()





