"""Render the OTF dashboard templates offline, against a fake project.

Stubs just enough of emhub (dc, dm, entries, projects) to call the content
functions and feed their output through Jinja, so template errors show up
without a database or a running server.

    python emhub/tests/test_otf_render.py /tmp/fake3
"""
import os
import sys
import json
import types
import importlib.util

import jinja2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TEMPLATES = os.path.join(ROOT, 'emhub', 'templates')


def load_module(name, relpath):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, relpath))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def build_stub_dc(project_path):
    """Minimal stand-ins for the emhub objects dc_otf touches."""

    class User:
        def __init__(self, name):
            self.name = name

    users = {2: User('L. Ferrand'), 3: User('D. Hsu')}

    class Project:
        id = 6
        user = User('M. Okonjo')
        collaborators_ids = ['2', '3']

    class Entry:
        id = 6
        project_id = 6
        type = 'tomo_processing'
        title = 'bt24_hela_mito'
        extra = {'data': {'processing_path': project_path}}

        def json(self):
            return {'id': self.id, 'title': self.title}

    class DataManager:
        def get_entry_by(self, **kw):
            return Entry() if kw.get('id') == 6 else None

        def get_entries(self, condition=None):
            return [Entry()]

        def get_project_by(self, **kw):
            return Project()

        def get_user_by(self, **kw):
            return users.get(kw.get('id'))

    class App:
        dm = DataManager()
        user = types.SimpleNamespace(is_manager=True, id=1)

    class DC:
        app = App()

        def __init__(self):
            self.funcs = {}

        def content(self, func):
            self.funcs[func.__name__] = func
            return func

    return DC()


def render(env, name, context):
    try:
        return env.get_template(name).render(**context)
    except Exception as e:
        print(f'  RENDER FAIL {name}: {type(e).__name__}: {e}')
        raise


def main():
    project_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake3'

    # Load the reader, then stub the emhub.data.processing package that
    # dc_otf imports so we do not pull in sqlalchemy or mrcfile.
    otf = load_module('otf_cryoet', 'emhub/data/processing/otf_cryoet.py')

    pkg = types.ModuleType('emhub')
    pkg.__path__ = []
    data_pkg = types.ModuleType('emhub.data')
    data_pkg.__path__ = []
    proc_pkg = types.ModuleType('emhub.data.processing')
    proc_pkg.__path__ = []
    proc_pkg.resolve_processing_path = lambda p: (
        os.path.expanduser(p) if p and p.startswith('~') else p)
    sys.modules.update({'emhub': pkg, 'emhub.data': data_pkg,
                        'emhub.data.processing': proc_pkg,
                        'emhub.data.processing.otf_cryoet': otf})

    dc_otf = load_module('dc_otf', 'emhub/data/content/dc_otf.py')

    dc = build_stub_dc(project_path)
    dc_otf.register_content(dc)

    # Templates that need full app context are stubbed out.
    loader = jinja2.ChoiceLoader([
        jinja2.DictLoader({'include_header.html': '',
                           'entry_macros.html': ''}),
        jinja2.FileSystemLoader(TEMPLATES),
    ])
    env = jinja2.Environment(loader=loader)
    env.globals['url_for_content'] = lambda *a, **k: '#'
    env.globals['url_for'] = lambda *a, **k: '#'
    env.globals['current_user'] = types.SimpleNamespace(is_manager=True)
    env.policies['json.dumps_function'] = lambda v, **kw: json.dumps(v)

    failures = 0

    print(f'Project: {project_path}')

    # ---- overview ----
    data = dc.funcs['otf_dashboard'](entry_id=6)
    print(f'\notf_dashboard: {len(data["rows"])} rows, '
          f'{len(data["trends"]["plots"])} trends, state={data["state"]["label"]}')
    for st in data['stages']:
        print(f'  {st["label"]:<32} {st["done"]:>4}/{st["total"]}'
              f'  lag={st["lag"]} failed={st["failed"]}')

    for name in ('otf_dashboard_content.html', 'otf_dashboard.html'):
        try:
            html = render(env, name, data)
            print(f'  rendered {name}: {len(html)} chars')
        except Exception:
            failures += 1

    # ---- detail, both orderings, and a failed series ----
    rows = data['rows']
    targets = [rows[0]['tomoName']]
    failed = [r['tomoName'] for r in rows if r['status'] == 'failed']
    if failed:
        targets.append(failed[0])

    for tomo_name in targets:
        for order in ('angle', 'acq'):
            d = dc.funcs['otf_tiltseries'](
                entry_id=6, tomo_name=tomo_name, order=order)
            if d.get('error'):
                print(f'\notf_tiltseries {tomo_name} ({order}): {d["error"]}')
                continue
            print(f'\notf_tiltseries {tomo_name} ({order}): '
                  f'{len(d["strips"])} strips, {d["nUsed"]}/{d["nTilts"]} used, '
                  f'status={d["statusLabel"]}')
            try:
                html = render(env, 'otf_tiltseries.html', d)
                print(f'  rendered: {len(html)} chars')
            except Exception:
                failures += 1

    # ---- error path: a path that does not exist ----
    class BadEntry:
        id = 6
        project_id = 6
        type = 'tomo_processing'
        title = 'gone'
        extra = {'data': {'processing_path': '/nonexistent/project'}}

        def json(self):
            return {}

    dc.app.dm.get_entry_by = lambda **kw: BadEntry()
    d = dc.funcs['otf_dashboard'](entry_id=6)
    print(f'\nmissing path: error={d["error"]!r}')
    try:
        render(env, 'otf_dashboard_content.html', d)
        print('  rendered the error state')
    except Exception:
        failures += 1

    print(f'\n{"FAILURES: %d" % failures if failures else "all renders OK"}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
