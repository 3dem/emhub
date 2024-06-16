# **************************************************************************
# *
# * Authors:     J.M. de la Rosa Trevin (delarosatrevin@gmail.com)
# *
# *****************************************************************
usage = """
Script to parse options from:

https://github.com/3dem/relion/blob/ver5.0/src/pipeline_jobs.cpp

It will write .json files with basic description of parameters
used in EMhub forms for Relion jobs.

Usage:

wget https://raw.githubusercontent.com/3dem/relion/ver5.0/src/pipeline_jobs.cpp

python parse_options_from_pipeline_jobs.py pipeline_jobs.cpp RelionParams

"""

import os
import re
import json
import sys

if len(sys.argv) < 2:
    print(usage)
    sys.exit(1)

pipeline_jobs_cpp = sys.argv[1]
outputDir = sys.argv[2] if len(sys.argv) > 2 else 'RelionParams'

if not os.path.exists(pipeline_jobs_cpp):
    raise Exception(f"File {pipeline_jobs_cpp} does not exist."
                    f"Provide a valid path to pipeline_jobs.cpp")

if os.path.exists(outputDir):
    raise Exception(f"Output dir {outputDir} already exist."
                    f"Remove it before running the script.")


os.system(f"mkdir -p '{outputDir}'")

print(f"Writing output .json files to: {outputDir}")

r = re.compile('joboptions\[(?P<name>"[^"]*")]\s*=\s*JobOption\((?P<label>"[^"]*")(?P<rest>.*)')
rr = re.compile('(?P<parts>.*)(?P<help>".*")\);')

rrr = re.compile('void\s*RelionJob::initialise(?P<jobname>[a-zA-Z]+Job)')

with open(pipeline_jobs_cpp) as f:
    lines = f.readlines()
    i = 0
    params = []
    jobname = None

    while i < len(lines):
        line_strip = lines[i].strip()
        mmm = rrr.match(line_strip)

        if mmm is not None:
            if jobname is not None:  # write previous params
                with open(os.path.join(outputDir, f'{jobname}.json'), 'w') as f:
                    json.dump(params, f, indent=4)
                params = []
            jobname = mmm.groupdict()['jobname']
            print(f"\t >>> {jobname}")

        m = r.match(line_strip)
        if m is not None:
            print("\n-------------------")
            print(line_strip)
            g = m.groupdict()
            rest = g['rest']
            while line_strip.endswith('\\'):
                i += 1
                line_strip = lines[i].strip()
                rest += line_strip

            mm = rr.match(rest)
            if mm is not None:
                gg = mm.groupdict()
                help = gg['help']
                default = gg['parts'].split(',')[1].strip()

            else:
                help = ' No-help '
                default = ' No-default '

            print(f"\t>>> name: {g['name']}\n"
                  f"\t>>> label: {g['label']}\n"
                  f"\t>>> rest: {rest}\n")

            params.append({
                'name': g['name'][1:-1],
                'label': g['label'][1:-1],
                'help': help[1:-1],
                'default': default
            })

        i += 1

