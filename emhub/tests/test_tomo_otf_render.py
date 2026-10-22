"""Render the OTF dashboard templates offline, against a fake project.

Stubs just enough of emhub (dc, dm, entries, projects) to call the content
functions and feed their output through Jinja, so template errors show up
without a database or a running server.

    python emhub/tests/test_tomo_otf_render.py /tmp/fake3
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
    """Minimal stand-ins for the emhub objects dc_tomo_otf touches."""

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

    class Session:
        """ An EMhub session whose OTF folder is the project. """
        id = 7
        shortname = 'bt24_session'
        data_path = project_path
        owner = User('M. Okonjo')
        project = Project()
        extra = {'otf': {}}

    class DataManager:
        def get_session_by(self, **kw):
            return Session() if kw.get('id') == 7 else None

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
        user = types.SimpleNamespace(is_manager=True, id=1,
                                     can_edit_project=lambda project: True,
                                     same_pi=lambda other: False)

    class DC:
        app = App()

        def __init__(self):
            self.funcs = {}

        def content(self, func):
            self.funcs[func.__name__] = func
            return func

    return DC()


def add_jobs(project_path, jobs, source):
    """ Add jobs to the project's default_pipeline.star: (job id, job type,
    [input star files], [output star files]); the output files are written
    as copies of source, so the readers find tilt series in them. """
    import shutil
    from emtools.metadata import StarFile
    pipeline = os.path.join(project_path, 'default_pipeline.star')
    with StarFile(pipeline) as sf:
        tables = {n: sf.getTable(n) for n in sf.getTableNames()}
    for job_id, jobtype, inputs, outputs in jobs:
        tables['pipeline_processes'].addRowValues(job_id + '/', 'None', jobtype, 'Succeeded')
        for star in inputs:
            tables['pipeline_input_edges'].addRowValues(star, job_id + '/')
        for star in outputs:
            tables['pipeline_nodes'].addRowValues(
                star, 'TomogramGroupMetadata.star.emwrap.TiltSeries', 0)
            tables['pipeline_output_edges'].addRowValues(job_id + '/', star)
            os.makedirs(os.path.join(project_path, os.path.dirname(star)), exist_ok=True)
            shutil.copy(os.path.join(project_path, source), os.path.join(project_path, star))
    with StarFile(pipeline, 'w') as sf:
        for name, table in tables.items():
            sf.writeTable(name, table)


def check_downstream(otf, env, dc, project_path):
    """ On a copy of the project: the dashboard only offers alignment and
    reconstruction jobs derived from the tilt series of its analysis, shows
    the newest by default, and the one asked for if it is an option. """
    import shutil
    import tempfile
    failures = 0
    tmp = tempfile.mkdtemp()
    proj = os.path.join(tmp, 'proj')
    shutil.copytree(project_path, proj, symlinks=True)

    base = otf.OtfSession(proj)
    mctf = base.analysis()['input']
    align0 = base.stages()['align'].id
    tomo0 = base.stages()['tomogram'].id
    add_jobs(proj, [
        # Another motion correction, analyzed by its own job, with nothing after it
        ('WarpMctf/job020', 'emw-warp-mctf', [], ['WarpMctf/job020/tilt_series.star']),
        ('EMwrap/job021', 'emw-tilt-analyze', ['WarpMctf/job020/tilt_series.star'],
         ['EMwrap/job021/tilt_analysis.star']),
        # An alignment and reconstruction of that other motion correction
        ('WarpTsAlign/job022', 'emw-warp-tsalign', ['WarpMctf/job020/tilt_series.star'],
         ['WarpTsAlign/job022/aligned_tilt_series.star']),
        ('WarpCtfRec/job023', 'emw-warp-ctfrec', ['WarpTsAlign/job022/aligned_tilt_series.star'],
         ['WarpCtfRec/job023/tomograms.star']),
        # A newer alignment of the analyzed tilt series, through a subset
        ('EMwrap/job024', 'emw-subset-ts', [mctf], ['EMwrap/job024/tilt_series.star']),
        ('WarpTsAlign/job025', 'emw-warp-tsalign', ['EMwrap/job024/tilt_series.star'],
         ['WarpTsAlign/job025/aligned_tilt_series.star']),
    ], source=mctf)
    # tilt_analysis.star of the new analysis job
    src = os.path.join(proj, base.analysis_job.id, 'tilt_analysis.star')
    text = open(src).read().replace(base.analysis_job.id, 'EMwrap/job021').replace(mctf, 'WarpMctf/job020/tilt_series.star')
    os.makedirs(os.path.join(proj, 'EMwrap/job021'), exist_ok=True)
    open(os.path.join(proj, 'EMwrap/job021/tilt_analysis.star'), 'w').write(text)

    def ids(session, key):
        return [o['id'] for o in session.downstream()[key]['options']]

    def expect(what, value, wanted):
        nonlocal failures
        ok = value == wanted
        failures += not ok
        print(f'  {"ok  " if ok else "FAIL"} {what}: {value}' + ('' if ok else f' (expected {wanted})'))

    print('\nalignment and reconstruction derived from the analyzed tilt series:')
    first = base.analysis_job.id
    s = otf.OtfSession(proj, analysis_job=first)
    expect(f'{first} alignment options', ids(s, 'align'), [align0, 'WarpTsAlign/job025'])
    expect(f'{first} alignment shown (newest)', s.stages()['align'].id, 'WarpTsAlign/job025')
    expect(f'{first} reconstruction options, of job025', ids(s, 'tomogram'), [])
    s = otf.OtfSession(proj, analysis_job=first, align_job=align0)
    expect(f'{first} alignment asked for', s.stages()['align'].id, align0)
    expect(f'{first} reconstruction of {align0}', s.stages()['tomogram'].id, tomo0)
    s = otf.OtfSession(proj, analysis_job=first, align_job='WarpTsAlign/job022')
    expect(f'{first} unrelated alignment asked for -> newest', s.stages()['align'].id,
           'WarpTsAlign/job025')
    s = otf.OtfSession(proj, analysis_job=first, align_job=align0, tomo_job='none')
    expect(f'{first} no reconstruction asked for', s.stages()['tomogram'], None)
    s = otf.OtfSession(proj, analysis_job='EMwrap/job021')
    expect('job021 alignment options', ids(s, 'align'), ['WarpTsAlign/job022'])
    expect('job021 reconstruction shown', s.stages()['tomogram'].id, 'WarpCtfRec/job023')
    expect('job021 motion correction', s.stages()['motioncorr'].id, 'WarpMctf/job020')

    # Rendered with the pickers
    d = dc.funcs['tomo_otf_dashboard'](entry_id=6, job_id=first, align_job=align0)
    try:
        html = render(env, 'tomo_otf_dashboard_content.html', d)
        expect('pickers rendered', ('The newest' in html, align0 in html, tomo0 in html),
               (True, True, True))
    except Exception:
        failures += 1
    shutil.rmtree(tmp)
    return failures


def render(env, name, context):
    try:
        return env.get_template(name).render(**context)
    except Exception as e:
        print(f'  RENDER FAIL {name}: {type(e).__name__}: {e}')
        raise


def main():
    project_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake3'

    # Load the reader, then stub the emhub.data.processing package that
    # dc_tomo_otf imports so we do not pull in sqlalchemy or mrcfile.
    otf = load_module('tomo_otf', 'emhub/data/processing/tomo_otf.py')

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
                        'emhub.data.processing.tomo_otf': otf})

    dc_tomo_otf = load_module('dc_tomo_otf', 'emhub/data/content/dc_tomo_otf.py')

    dc = build_stub_dc(project_path)
    dc_tomo_otf.register_content(dc)

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
    data = dc.funcs['tomo_otf_dashboard'](entry_id=6)
    print(f'\notf_dashboard: {len(data["rows"])} rows, '
          f'{len(data["trends"]["plots"])} trends, state={data["state"]["label"]}')
    for st in data['stages']:
        print(f'  {st["label"]:<32} {st["done"]:>4}/{st["total"]}'
              f'  lag={st["lag"]} failed={st["failed"]}')

    for name in ('tomo_otf_dashboard_content.html', 'tomo_otf_dashboard.html'):
        try:
            html = render(env, name, data)
            print(f'  rendered {name}: {len(html)} chars')
        except Exception:
            failures += 1

    # ---- the same dashboard, from an EMhub session (session_live) ----
    sdata = dc.funcs['tomo_otf_dashboard'](session_id=7)
    if sdata['error'] or sdata['source'] != {'session_id': 7} or sdata['otf_page'] != 'session_live':
        print(f'  FAIL: session dashboard: error={sdata["error"]!r}, source={sdata["source"]}')
        failures += 1
    for name in ('tomo_otf_dashboard_content.html', 'tomo_otf_dashboard.html'):
        try:
            html = render(env, name, sdata)
            print(f'  rendered {name} for a session: {len(html)} chars')
        except Exception:
            failures += 1
    if not dc.funcs['tomo_otf_tiltseries'](session_id=7, tomo_name=data['rows'][0]['tomoName'])['source']:
        failures += 1

    # ---- detail, both orderings, and a failed series ----
    rows = data['rows']
    targets = [rows[0]['tomoName']]
    failed = [r['tomoName'] for r in rows if r['status'] == 'failed']
    if failed and failed[0] not in targets:
        targets.append(failed[0])

    # Image content flags, from the _imageqc.json files, when there are any
    image_flags = ('blank', 'blacked', 'field', 'shifted')
    session = otf.OtfSession(project_path)
    flagged = {ts.tomoName: [k for t in ts.tilts for k in t.get('reject', [])
                             if k in image_flags]
               for ts in session.tilt_series()}
    counts = {k: sum(v.count(k) for v in flagged.values()) for k in image_flags}
    print(f'\nimage content flags: '
          f'{counts if any(counts.values()) else "none (no _imageqc.json)"}')
    prop = session.proposal_inputs()
    proposing = [x for x in prop['series'] if x['proposed']]
    print(f'proposed exclusions: {sum(len(x["proposed"]) for x in proposing)} tilts in '
          f'{len(proposing)} tilt series (usable limit {prop["usableLimit"]})')
    if session.subset_input() is None:
        print('  FAIL: no tilt series to make a subset from')
        failures += 1
    with_flags = [n for n, v in flagged.items() if v]
    if with_flags and with_flags[0] not in targets:
        targets.append(with_flags[0])

    for tomo_name in targets:
        for order in ('angle', 'acq'):
            d = dc.funcs['tomo_otf_tiltseries'](
                entry_id=6, tomo_name=tomo_name, order=order)
            if d.get('error'):
                print(f'\notf_tiltseries {tomo_name} ({order}): {d["error"]}')
                continue
            print(f'\notf_tiltseries {tomo_name} ({order}): '
                  f'{len(d["strips"])} strips, {d["nUsed"]}/{d["nTilts"]} used, '
                  f'status={d["statusLabel"]}')
            for note in sorted({n for n in d.get('tiltNotes', []) if n}):
                print(f'  tilt note: {note}')
            try:
                html = render(env, 'tomo_otf_tiltseries.html', d)
                print(f'  rendered: {len(html)} chars')
            except Exception:
                failures += 1

    # ---- several tilt analysis jobs: a dashboard and a selection each ----
    jobs = [j.id for j in session.analysis_jobs()]
    print(f'\ntilt analysis jobs: {jobs}, shown by default: {session.analysis_job.id}')
    print(f'  thumbnails: {session.analysis()["thumbnails"]}, '
          f'input: {session.analysis()["input"]}')
    if len(jobs) > 1:
        d = dc.funcs['tomo_otf_dashboard'](entry_id=6, job_id=jobs[0])
        print(f'  dashboard of {jobs[0]}: job_id={d["job_id"]}, {len(d["rows"])} rows, '
              f'{len(d["analysisJobs"])} jobs to pick from')
        try:
            html = render(env, 'tomo_otf_dashboard_content.html', d)
            print(f'  rendered with the job picker: {len(html)} chars')
        except Exception:
            failures += 1
        first, last = (otf.OtfSession(project_path, analysis_job=j) for j in (jobs[0], jobs[-1]))
        name = rows[0]['tomoName']
        first.save_selection([name], {}, user='test')
        if (first.selection()['deselected'] != [name] or last.selection()['deselected']
                or not os.path.exists(os.path.join(project_path, jobs[0], otf.SELECTION_FILE))):
            print('  FAIL: the selections of the two dashboards are not apart')
            failures += 1
        else:
            print(f'  selection kept in {jobs[0]}/{otf.SELECTION_FILE} only')
        os.remove(first.selection_file)

    # ---- the alignment and reconstruction shown: only derived jobs ----
    failures += check_downstream(otf, env, dc, project_path)

    # ---- a project without a tilt analysis job ----
    d = dc.funcs['tomo_otf_dashboard'](entry_id=6, job_id='job999')
    print(f'\nunknown analysis job: error={d["error"]!r}')
    if not d['error']:
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
    d = dc.funcs['tomo_otf_dashboard'](entry_id=6)
    print(f'\nmissing path: error={d["error"]!r}')
    try:
        render(env, 'tomo_otf_dashboard_content.html', d)
        print('  rendered the error state')
    except Exception:
        failures += 1

    print(f'\n{"FAILURES: %d" % failures if failures else "all renders OK"}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
