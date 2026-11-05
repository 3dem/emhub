"""
Tests of the WorkflowEditor job duplication and template loading, which use
emwrap.base.workflow_refs (same logic as ProjectManager).
"""

import unittest
from unittest import mock

from emhub.data import workflow_widget
from emhub.data.workflow_widget import WorkflowEditor, jobs_to_protocols

JOBS = [
    {'jobid': 'Import/job001', 'jobtype': 'Import', 'params': {}},
    {'jobid': 'Ctf/job002', 'jobtype': 'Ctf',
     'params': {'input_star': 'Import/job001/movies.star'}},
    {'jobid': 'Pop/job003', 'jobtype': 'Pop',
     'params': {'sources': [{'name': 'A', 'warp_folder': 'Ctf/job002'}],
                'mask': 'Mask/job050/mask.mrc'}},
]


def _editor(jobs):
    editor = WorkflowEditor.__new__(WorkflowEditor)
    editor.workflow_id = 'test'
    editor.workflow_path = '/tmp/test.json'
    editor._workflow_def = {'jobs': []}
    editor.jobs = [dict(j) for j in jobs]
    return editor


class TestWorkflowEditor(unittest.TestCase):

    def test_protocols(self):
        protocols = jobs_to_protocols(JOBS)
        self.assertEqual(protocols['PROJECT']['children'], ['Import/job001'])
        self.assertEqual(protocols['Pop/job003']['parents'], ['Ctf/job002'])
        self.assertEqual(protocols['Import/job001']['children'], ['Ctf/job002'])

    def test_duplicate(self):
        editor = _editor(JOBS)
        _, duplicated = editor.duplicate_jobs(['Ctf/job002', 'Pop/job003'])
        self.assertEqual(duplicated, [
            {'sourceId': 'Ctf/job002', 'newId': 'Ctf/job004'},
            {'sourceId': 'Pop/job003', 'newId': 'Pop/job005'}])
        ctf, pop = editor.jobs[-2:]
        # External inputs are kept, the internal ones remapped (also nested)
        self.assertEqual(ctf['params']['input_star'], 'Import/job001/movies.star')
        self.assertEqual(pop['params']['sources'][0]['warp_folder'], 'Ctf/job004')
        self.assertEqual(pop['params']['mask'], 'Mask/job050/mask.mrc')
        # The originals are not modified
        self.assertEqual(editor.jobs[2]['params']['sources'][0]['warp_folder'],
                         'Ctf/job002')

    def test_load_template(self):
        editor = _editor(JOBS[:1])
        template = {'jobs': JOBS[1:]}
        with mock.patch.object(workflow_widget.ProcessingConfig, 'get_workflow',
                               return_value=template):
            editor.load_template('other')
        ctf, pop = editor.jobs[1:]
        self.assertEqual([ctf['jobid'], pop['jobid']], ['Ctf/job002', 'Pop/job003'])
        # References to jobs not in the template are cleared
        self.assertEqual(ctf['params']['input_star'], '')
        self.assertEqual(pop['params']['mask'], '')
        self.assertEqual(pop['params']['sources'][0]['warp_folder'], 'Ctf/job002')


if __name__ == '__main__':
    unittest.main()
