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

import os
import sys
import time
import argparse
import subprocess
import datetime as dt
import tempfile
from pprint import pprint


from emhub.client import open_client, config

colors = [
    "#0000FF",
    "#8A2BE2",
    "#A52A2A",
    "#DEB887",
    "#5F9EA0",
    "#7FFF00",
    "#D2691E",
    "#FF7F50",
    "#6495ED",
    "#FFF8DC",
    "#DC143C",
    "#00FFFF",
    "#00008B",
    "#008B8B",
    "#B8860B",
    "#A9A9A9",
    "#006400",
    "#BDB76B",
    "#8B008B",
    "#556B2F",
    "#FF8C00",
    "#9932CC",
    "#8B0000",
    "#E9967A",
    "#8FBC8F",
    "#483D8B",
    "#2F4F4F",
    "#00CED1",
    "#9400D3",
    "#FF1493",
    "#00BFFF",
    "#696969",
    "#1E90FF",
    "#B22222",
    "#FFFAF0",
    "#228B22",
    "#FF00FF",
]

def color(i):
    return colors[i % len(colors)]


def main():

    count = 0

    with open_client() as dc:
        for d in [1, 2]:
            for c in range(1, 11):
                for p in range(1, 11):
                    count += 1
                    attrs = {
                        'id': 1000 + count,
                        'code': 'D%dC%dP%d-%03d' % (d, c, p, count),
                        'label': 'puck-%03d' % count,
                        'dewar': d,
                        'cane': c,
                        'position': p,
                        'color': color(count)
                    }
                    print("Creating puck: ", attrs)
                    r = dc.request('create_puck', jsonData={'attrs': attrs})
                    print(dc.json())


if __name__ == '__main__':
    main()





