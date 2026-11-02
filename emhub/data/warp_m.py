"""Information of Warp/M refinements of a population, for the WarpPopulation
viewer (blueprints/api_viewers_warp.py):

- species_params: the <Param> of a .species file.
- particles_stats: particles of a species, by half set and tilt series.
- refinement_history: the refinement rounds that led to a species, from the
  chain of emwrap jobs (job.star input population, info.json run time) or,
  without emwrap, from the versions of the species kept by Warp.
- local_resolution: the histogram of local resolution of a species.
- series_refinement: per tilt series scores and time of the M refinement,
  from its logs (refinement_temp/logs/refine_<series>.log).
"""

import glob
import json
import os
import re
import xml.etree.ElementTree as ET

from emtools.metadata import StarFile, WarpPopulation

# Short names of the emwrap jobs that write a population
JOB_PROGRAMS = {
    'emw-warp-mtools_create': 'Create population',
    'emw-warp-mcore': 'M refinement',
    'emw-warp-estimate_weights': 'Estimate weights',
    'emw-warp-mtools_resample': 'Resample',
}

_SCORE_LINE = re.compile(r'iteration (\d+)/(\d+), ([A-Za-z &]+?)(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)\s*$')
_FINAL_SCORE = re.compile(r'Final score: (-?[\d.]+(?:[eE]-?\d+)?)')
_TOOK = re.compile(r'Execution took ([\d.]+) seconds')


def species_params(species_file):
    """ The <Param Name Value> of a .species file as a dict ({} if unreadable). """
    try:
        root = ET.parse(species_file).getroot()
    except (OSError, ET.ParseError):
        return {}
    return {p.get('Name'): p.get('Value') for p in root.iter('Param')}


def _float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def particles_stats(particles_star):
    """ {'total', 'halves': {subset: n}, 'series': {source name: n}} of a
    species *_particles.star (None if missing). """
    if not particles_star or not os.path.exists(particles_star):
        return None
    halves, series = {}, {}
    total = 0
    with StarFile(particles_star) as sf:
        table = sf.getTableNames()[0]
        cols = sf.getTableInfo(table).getColumnNames()
        has_half = 'wrpRandomSubset' in cols
        has_source = 'wrpSourceName' in cols
        for row in sf.iterTable(table, guessType=False):
            total += 1
            if has_half:
                h = row.wrpRandomSubset
                halves[h] = halves.get(h, 0) + 1
            if has_source:
                s = row.wrpSourceName
                series[s] = series.get(s, 0) + 1
    return {'total': total, 'halves': halves, 'series': series}


def local_resolution(localres_star):
    """ [(resolution Å, voxels)] of a species *_localres.star, highest
    resolution last, without the empty bins (None if missing). """
    if not localres_star or not os.path.exists(localres_star):
        return None
    table = StarFile.getTableFromFile('', localres_star, guessType=False)
    bins = []
    for row in table:
        res, n = _float(row.wrpResolution), _float(row.wrpSamples)
        if res is None or n is None or res == float('inf'):
            continue
        bins.append((res, int(n)))
    while bins and not bins[0][1]:
        bins.pop(0)
    while bins and not bins[-1][1]:
        bins.pop()
    return bins


# ----------------------- Refinement history -----------------------------
def _job_folder(population_file):
    """ The emwrap job folder of a population (…/jobNNN/m/x.population),
    or None when it is not in one (no job.star). """
    folder = os.path.dirname(os.path.dirname(os.path.abspath(population_file)))
    return folder if os.path.exists(os.path.join(folder, 'job.star')) else None


def _job_options(job_folder):
    """ (job type label, {option: value}) from the job.star of a job. """
    job_star = os.path.join(job_folder, 'job.star')
    label = None
    with open(job_star) as f:
        for line in f:
            if line.startswith('_rlnJobTypeLabel'):
                label = line.split()[1]
                break
    options = {}
    table = StarFile.getTableFromFile('joboptions_values', job_star, guessType=False)
    for row in table:
        value = row.rlnJobOptionValue
        options[row.rlnJobOptionVariable] = '' if value in ('""', None) else value
    return label, options


def _job_elapsed(job_folder):
    """ Elapsed time of the last run of a job (h:mm:ss) from its info.json. """
    try:
        with open(os.path.join(job_folder, 'info.json')) as f:
            runs = json.load(f).get('runs') or []
        return runs[-1]['elapsed'].split('.')[0] if runs else ''
    except (OSError, ValueError, KeyError, TypeError):
        return ''


def _species_in(population_file, guid, name):
    """ The species file of a population with that GUID (or name). """
    try:
        wp = WarpPopulation(population_file)
    except Exception:
        return None
    folder = os.path.dirname(population_file)
    for s in wp.Species:
        if s['id'] == guid or s['name'] == name:
            path = os.path.join(folder, s['path'])
            if os.path.exists(path):
                return path
    return None


def _step(params, **kwargs):
    # A new species (no previous version) has placeholder values, no map yet
    created = not params.get('PreviousVersion')
    return dict({
        'version': params.get('Version', ''),
        'previous': params.get('PreviousVersion', ''),
        'resolution': None if created else _float(params.get('GlobalResolution')),
        'bfactor': None if created else _float(params.get('GlobalBFactor')),
    }, **kwargs)


def refinement_history(population_file, species_file, root=None, max_steps=100):
    """ The steps (oldest first) that led to a species: one per emwrap job
    of the chain of input populations (job, program, refined options, run
    time) followed back from the job of population_file, or, outside
    emwrap jobs, one per version of the species in its versions folder.
    root: paths of the jobs are given relative to it. """
    params = species_params(species_file)
    guid, name = params.get('GUID'), params.get('Name')
    steps = []
    job = _job_folder(population_file)
    seen = set()
    while job and job not in seen and len(steps) < max_steps:
        seen.add(job)
        label, options = _job_options(job)
        pop_files = glob.glob(os.path.join(job, 'm', '*.population'))
        sp = _species_in(pop_files[0], guid, name) if pop_files else None
        p = species_params(sp) if sp else {}
        program = label.split('.')[0] if label else ''
        # Options of the program (e.g. mcore.refine_particles = Yes)
        refined = [k.split('.', 1)[1] for k, v in options.items()
                   if '.' in k and v == 'Yes' and not k.startswith(('queue.', 'do_'))]
        steps.append(_step(
            p,
            job=os.path.relpath(job, root) if root else os.path.basename(job),
            program=JOB_PROGRAMS.get(program, program),
            refined=refined,
            elapsed=_job_elapsed(job),
        ))
        inputs = [v for k, v in options.items() if v.endswith('.population')]
        if not inputs:
            break
        project = os.path.dirname(os.path.dirname(job))  # …/Type/jobNNN
        prev = os.path.join(project, inputs[0])
        job = _job_folder(prev) if os.path.exists(prev) else None

    if not steps:
        # Warp alone: the versions of the species
        versions = os.path.join(os.path.dirname(species_file), 'versions')
        by_version = {}
        for path in glob.glob(os.path.join(versions, '*', os.path.basename(species_file))):
            p = species_params(path)
            by_version[p.get('Version')] = (p, os.path.getmtime(path))
        current = params.get('Version')
        while current in by_version and len(steps) < max_steps:
            p, mtime = by_version.pop(current)
            steps.append(_step(p, mtime=mtime))
            current = p.get('PreviousVersion')
        if not steps:
            steps.append(_step(params))
    steps.reverse()
    return steps


# ----------------------- Per tilt series ---------------------------------
def _logs_folder(population_file):
    """ The refinement logs next to a population, if they are of an M
    refinement (EstimateWeights also writes refine_*.log, with no
    optimization iterations). """
    folder = os.path.join(os.path.dirname(population_file), 'refinement_temp', 'logs')
    logs = glob.glob(os.path.join(folder, 'refine_*.log'))
    return folder if logs and _parse_refine_log(logs[0])['iterations'] else None


def find_refinement_logs(population_file, max_jobs=50):
    """ (logs folder, population file) of the last M refinement that led to
    this population: its own, or the one of an earlier emwrap job (e.g. the
    input of EstimateWeights), or (None, None). """
    pop = os.path.abspath(population_file)
    for _ in range(max_jobs):
        if folder := _logs_folder(pop):
            return folder, pop
        job = _job_folder(pop)
        if not job:
            break
        _, options = _job_options(job)
        inputs = [v for v in options.values() if v.endswith('.population')]
        if not inputs:
            break
        pop = os.path.join(os.path.dirname(os.path.dirname(job)), inputs[0])
        if not os.path.exists(pop):
            break
    return None, None


def _parse_refine_log(path):
    """ {'start', 'final', 'seconds', 'iterations'} of one refine_*.log. """
    start = final = seconds = None
    iterations = 0
    with open(path, errors='replace') as f:
        for line in f:
            if m := _SCORE_LINE.search(line):
                if start is None:
                    start = float(m.group(4))
                iterations = int(m.group(2))
            elif m := _FINAL_SCORE.search(line):
                final = float(m.group(1))
            elif m := _TOOK.search(line):
                seconds = float(m.group(1))
    return {'start': start, 'final': final, 'seconds': seconds, 'iterations': iterations}


def series_refinement(logs_folder, series_particles=None):
    """ One dict per tilt series refined by M: name, particles, start and
    final score, gain (%) and seconds. series_particles: {name.tomostar: n}. """
    series_particles = series_particles or {}
    rows = []
    for path in sorted(glob.glob(os.path.join(logs_folder, 'refine_*.log'))):
        name = os.path.basename(path)[len('refine_'):-len('.log')]
        r = _parse_refine_log(path)
        gain = None
        if r['start'] and r['final'] is not None:
            gain = (r['final'] - r['start']) / abs(r['start']) * 100
        rows.append(dict(r, name=name, gain=gain,
                         particles=series_particles.get(f'{name}.tomostar')))
    return rows
