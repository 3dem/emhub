""" Inputs and outputs of a Relion/emwrap run (api get_session_run 'json',
used by the MCP tool processing_get_job and the run summary), with a fake
job graph and info.json files as written by emwrap pipelines (no
database, server or GPUs needed):

    python -m unittest emhub.tests.test_run_inputs_outputs
"""
import os
import json
import shutil
import tempfile
import unittest

import jinja2

from emhub.data.processing.processing_relion.runs import RelionRun

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.join(os.path.dirname(HERE), 'templates')

JOB_ID = 'WarpMCreatePopulation/job011'
INPUTS = ['External/job010/mask.mrc', 'Refine3D/job009/run_data.star']
OUTPUTS = ['WarpMCreatePopulation/job011/m/ApoF.population']


class Node:
    def __init__(self, nodeId):
        self.id = nodeId


class Job(dict):
    """ Minimal stand-in of an emtools.jobs Job of the workflow graph. """
    def __init__(self, jobId, inputs, outputs):
        dict.__init__(self, jobtype='emw-warp-mtools_create', alias='None',
                      status='Succeeded')
        self.id = jobId
        self.inputs = [Node(i) for i in inputs]
        self.outputs = [Node(o) for o in outputs]


class TestRunInputsOutputs(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='emhub_run_ios_')
        self.addCleanup(shutil.rmtree, self.tmp)
        os.makedirs(os.path.join(self.tmp, JOB_ID))

    def _run(self, info=None):
        if info is not None:
            with open(os.path.join(self.tmp, JOB_ID, 'info.json'), 'w') as f:
                json.dump(info, f)
        job = Job(JOB_ID, INPUTS, OUTPUTS)
        return RelionRun(None, os.path.join(self.tmp, JOB_ID), job)

    def test_empty_info_uses_graph(self):
        """ emwrap pipelines write empty 'inputs'/'outputs' to info.json
        (the WarpMCreatePopulation/job011 case): the graph is used. """
        run = self._run({'inputs': {}, 'outputs': {}, 'runs': []})
        self.assertEqual(run.getInputsOutputs(),
                         {'inputs': INPUTS, 'outputs': OUTPUTS})

    def test_no_info_uses_graph(self):
        run = self._run()
        self.assertEqual(run.getInputsOutputs()['inputs'], INPUTS)

    def test_info_entries_override_graph(self):
        """ Pipelines describing their outputs (e.g. preprocessing) keep
        their entries, the inputs still come from the graph. """
        mics = {'label': 'Micrographs', 'type': 'MicrographGroupMetadata',
                'info': '10 items',
                'files': [['Preprocess/job002/micrographs_ctf.star', 'x']]}
        run = self._run({'inputs': {}, 'outputs': {'Micrographs': mics}})
        ios = run.getInputsOutputs()
        self.assertEqual(ios['outputs'], [mics])
        self.assertEqual(ios['inputs'], INPUTS)
        self.assertEqual(RelionRun.ioFiles(mics),
                         ['Preprocess/job002/micrographs_ctf.star'])

    def test_plain_info_values_ignored(self):
        """ Values that are not entries (tilt analysis stores
        {'type': ..., 'star': ...}) do not replace the graph. """
        run = self._run({'inputs': {'input_tiltseries': 'X/job001/ts.star'},
                         'outputs': {'type': 'TiltSeriesAnalysis',
                                     'star': 'Y/job002/out.star'}})
        self.assertEqual(run.getInputsOutputs(),
                         {'inputs': INPUTS, 'outputs': OUTPUTS})

    def test_summary_template_renders_graph_ids(self):
        run = self._run({'inputs': {}, 'outputs': {}})
        env = jinja2.Environment(loader=jinja2.FileSystemLoader(TEMPLATES))
        html = env.get_template('processing_run_summary.html').render(run=run)
        for path in INPUTS + OUTPUTS:
            self.assertIn(f"loadRunFileInfo('{path}')", html)
        self.assertIn('>mask.mrc<', html)


if __name__ == '__main__':
    unittest.main()
