"""
Tests for the EMhub MCP server (emhub.mcp), using a fake client that records
the REST calls instead of a running EMhub server. Requires the optional
'mcp' package (Python >= 3.10).
"""

import asyncio
import json
import unittest

from emhub.mcp.server import _import_fastmcp

try:
    FastMCP = _import_fastmcp()
except SystemExit:  # 'mcp' package not installed
    FastMCP = None

from emhub.mcp.client import EmhubMcpError, clean, to_utc_iso, _short_error


class FakeClient:
    """ Records calls and returns canned results by method name. """
    def __init__(self, roles=None, results=None):
        self.username = 'jdoe'
        self.roles = roles or ['user']
        self.results = results or {}
        self.calls = []

    @property
    def is_admin(self):
        return bool({'admin', 'developer'} & set(self.roles))

    @property
    def current_user(self):
        return {'id': 7, 'username': self.username, 'roles': self.roles}

    def call(self, method, attrs=None, condition=None, orderBy=None,
             key=None, data=None):
        self.calls.append({'method': method, 'attrs': attrs,
                           'condition': condition, 'orderBy': orderBy,
                           'key': key, 'data': data})
        return self.results.get(method, [])


def _tool_names(mcp):
    return {t.name for t in asyncio.run(mcp.list_tools())}


def _call_tool(mcp, name, **args):
    return asyncio.run(mcp.call_tool(name, args))


def _tool_result(mcp, name, **args):
    """ Result of a tool returning a dict, parsed from its text content. """
    r = _call_tool(mcp, name, **args)
    if isinstance(r, tuple):  # mcp 1.x: (content, structured)
        r = r[0]
    content = r if isinstance(r, list) else r.content
    return json.loads(content[0].text)


def _tool_error(mcp, name, **args):
    """ Error message of a tool call that fails. """
    try:
        r = _call_tool(mcp, name, **args)
    except Exception as e:  # mcp 1.x raises ToolError
        return str(e)
    return str(r) if r.is_error else None


@unittest.skipIf(FastMCP is None, "'mcp' package not installed")
class TestMcpServer(unittest.TestCase):
    def _server(self, groups=None, roles=None, results=None):
        from emhub.mcp.server import build_server
        client = FakeClient(roles=roles, results=results)
        return build_server(client, groups), client

    def test_groups(self):
        mcp, _ = self._server(['booking'])
        names = _tool_names(mcp)
        self.assertTrue(names)
        self.assertTrue(all(n.startswith('booking_') for n in names))

        mcp, _ = self._server(['processing'])
        names = _tool_names(mcp)
        self.assertTrue(names)
        self.assertTrue(all(n.startswith('processing_') for n in names))

        mcp, _ = self._server()
        names = _tool_names(mcp)
        self.assertIn('booking_list_bookings', names)
        self.assertIn('processing_get_workflow', names)

    def test_admin_tools(self):
        admin_tools = {'booking_create_user', 'booking_update_resource',
                       'processing_delete_jobs'}
        mcp, _ = self._server(roles=['user'])
        names = _tool_names(mcp)
        self.assertFalse(admin_tools & names)
        # Safe writes are available to every user
        self.assertIn('booking_create_booking', names)
        self.assertIn('processing_launch_job', names)
        self.assertIn('processing_load_workflow', names)

        mcp, _ = self._server(roles=['user', 'admin'])
        self.assertTrue(admin_tools <= _tool_names(mcp))

    def test_create_booking(self):
        mcp, client = self._server(['booking'])
        _call_tool(mcp, 'booking_create_booking', resource_id=3,
                   start='2026-10-23 09:00-05:00',
                   end='2026-10-23 17:00-05:00', title='Krios test')
        c = client.calls[-1]
        self.assertEqual(c['method'], 'create_booking')
        self.assertEqual(c['key'], 'bookings_created')
        self.assertEqual(c['attrs'], {'resource_id': 3,
                                      'start': '2026-10-23T14:00:00Z',
                                      'end': '2026-10-23T22:00:00Z',
                                      'title': 'Krios test',
                                      'type': 'booking'})

    def test_list_bookings(self):
        events = [{'id': 1, 'resource': {'id': 3}},
                  {'id': 2, 'resource': {'id': 4}}]
        mcp, client = self._server(['booking'],
                                   results={'get_bookings_range': events})
        _call_tool(mcp, 'booking_list_bookings', start='2026-10-20',
                   end='2026-10-26', resource_id=4)
        c = client.calls[-1]
        self.assertEqual(c['data'], {'start': '2026-10-20',
                                     'end': '2026-10-26'})

    def test_launch_job(self):
        mcp, client = self._server(['processing'])
        _call_tool(mcp, 'processing_launch_job', session_id=12,
                   run_id='CtfFind/job003/', params={'gpu': '0'})
        c = client.calls[-1]
        self.assertEqual(c['method'], 'launch_job')
        self.assertEqual(c['key'], 'workflow')
        self.assertEqual(c['attrs'], {'session_id': 12,
                                      'run_id': 'CtfFind/job003/',
                                      'params': {'gpu': '0'},
                                      'clean': False})

    def test_create_tomo_project(self):
        mcp, client = self._server(['processing'], roles=['user'])
        self.assertIn('processing_create_tomo_project', _tool_names(mcp))
        _call_tool(mcp, 'processing_create_tomo_project',
                   processing_path='/data/tomo/p1', data_path='/data/raw')
        c = client.calls[-1]
        self.assertEqual(c['method'], 'create_tomo_project')
        self.assertEqual(c['key'], 'entry')
        self.assertEqual(c['attrs'], {'processing_path': '/data/tomo/p1',
                                      'data_path': '/data/raw'})

    def test_duplicate_and_copy_jobs(self):
        dup = {'protocols': {}, 'duplicated': [
            {'sourceId': 'CtfFind/job003/', 'newId': 'CtfFind/job009/'}]}
        mcp, client = self._server(['processing'],
                                   results={'duplicate_jobs': dup})
        _call_tool(mcp, 'processing_duplicate_jobs', session_id=12,
                   run_ids=['CtfFind/job003/'])
        c = client.calls[-1]
        self.assertEqual(c['method'], 'duplicate_jobs')
        self.assertEqual(c['attrs'], {'session_id': 12,
                                      'run_ids': ['CtfFind/job003/']})

        client.calls.clear()
        r = _tool_result(mcp, 'processing_copy_job', session_id=12,
                         run_id='CtfFind/job003/', params={'gpu': '1'})
        self.assertEqual([c['method'] for c in client.calls],
                         ['duplicate_jobs', 'save_job'])
        self.assertEqual(client.calls[-1]['attrs'],
                         {'session_id': 12, 'run_id': 'CtfFind/job009/',
                          'params': {'gpu': '1'}})
        self.assertEqual(r, {'sourceId': 'CtfFind/job003/',
                             'newId': 'CtfFind/job009/'})

    def test_export_workflow(self):
        workflow = [{'id': 'Import/job001/'}, {'id': 'CtfFind/job002/'}]
        mcp, client = self._server(['processing'], results={
            'get_session_workflow': workflow,
            'export_workflow': {'protocols': {}, 'workflow_file': 'wf.json',
                                'exported_jobs': 2}})
        r = _tool_result(mcp, 'processing_export_workflow', entry_id=5,
                         output_file='wf.json')
        c = client.calls[-1]
        self.assertEqual(c['method'], 'export_workflow')
        self.assertEqual(c['attrs'], {'entry_id': 5, 'output_path': 'wf.json',
                                      'run_ids': ['Import/job001/',
                                                  'CtfFind/job002/']})
        self.assertEqual(r, {'workflow_file': 'wf.json', 'exported_jobs': 2})

    def test_load_workflow_file(self):
        mcp, client = self._server(['processing'], roles=['user'],
                                   results={'load_workflow': {}})
        _call_tool(mcp, 'processing_load_workflow', entry_id=5,
                   workflow_file='wf.json')
        self.assertEqual(client.calls[-1]['attrs'],
                         {'entry_id': 5, 'workflow_file': 'wf.json'})
        self.assertIn("exactly one of 'workflow_id'",
                      _tool_error(mcp, 'processing_load_workflow', entry_id=5,
                                  workflow_id='tomo-otf',
                                  workflow_file='wf.json'))

    def test_labels(self):
        labels = {'labels': [{'id': 'L1', 'title': 'good', 'color': 'red'}],
                  'jobs': {}}
        mcp, client = self._server(['processing'], results={
            'get_project_labels': labels,
            'delete_project_label': {'id': 'L1', 'deleted': True}})
        _call_tool(mcp, 'processing_save_label', session_id=12,
                   title='best', color='#D2F5CB')
        self.assertEqual(client.calls[-1]['attrs'],
                         {'session_id': 12,
                          'label': {'title': 'best', 'color': '#D2F5CB'}})
        # Updating keeps the values not given
        _call_tool(mcp, 'processing_save_label', session_id=12,
                   label_id='L1', color='green')
        self.assertEqual(client.calls[-1]['attrs']['label'],
                         {'id': 'L1', 'title': 'good', 'color': 'green'})
        self.assertIn("no label with id 'L2'",
                      _tool_error(mcp, 'processing_save_label', session_id=12,
                                  label_id='L2', color='green'))
        _call_tool(mcp, 'processing_delete_label', session_id=12,
                   label_id='L1')
        self.assertEqual(client.calls[-1]['method'], 'delete_project_label')

    def test_list_workflows(self):
        mcp, client = self._server(['processing'], results={
            'get_workflow_templates': [{'id': 'tomo-otf'}]})
        _call_tool(mcp, 'processing_list_workflows')
        c = client.calls[-1]
        self.assertEqual((c['method'], c['attrs'], c['key']),
                         ('get_workflow_templates', {}, 'workflows'))

    def test_project_selector(self):
        from emhub.mcp.processing import _project_selector
        self.assertEqual(_project_selector(session_id=1), {'session_id': 1})
        self.assertEqual(_project_selector(path='/data/p'), {'path': '/data/p'})
        with self.assertRaises(EmhubMcpError):
            _project_selector()
        with self.assertRaises(EmhubMcpError):
            _project_selector(session_id=1, entry_id=2)

    def test_error_message(self):
        # EmhubMcpError messages must reach the model, mcp 2.x only keeps
        # the message of ToolError exceptions
        mcp, _ = self._server(['processing'])
        try:
            result = str(_call_tool(mcp, 'processing_get_workflow'))
        except Exception as e:  # mcp 1.x raises ToolError
            result = str(e)
        self.assertIn("Provide exactly one of 'session_id'", result)

    def test_get_job_logs(self):
        run = {'json': {'values': {}}, 'stdout': '\n'.join(map(str, range(10)))}
        mcp, client = self._server(['processing'],
                                   results={'get_session_run': run})
        _call_tool(mcp, 'processing_get_job', run_id='Import/job001/',
                   entry_id=5, include_logs=True, log_lines=3)
        c = client.calls[-1]
        self.assertEqual(c['attrs']['output'], ['json', 'stdout', 'stderr'])
        self.assertEqual(c['attrs']['entry_id'], 5)


class TestMcpClientUtils(unittest.TestCase):
    def test_to_utc_iso(self):
        self.assertEqual(to_utc_iso('2026-10-23 09:00Z'),
                         '2026-10-23T09:00:00Z')
        self.assertEqual(to_utc_iso('2026-10-23 09:00+02:00'),
                         '2026-10-23T07:00:00Z')
        with self.assertRaises(EmhubMcpError):
            to_utc_iso('tomorrow')

    def test_clean(self):
        self.assertEqual(clean([{'id': 1, 'password_hash': 'x'}]),
                         [{'id': 1}])

    def test_short_error(self):
        self.assertEqual(
            _short_error("ERROR from Server: Booking overlaps. "
                         "Traceback: File ..."),
            'Booking overlaps')


if __name__ == '__main__':
    unittest.main()
