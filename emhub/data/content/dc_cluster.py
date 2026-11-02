# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@gmail.com)
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
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
Register content functions related to Cluster monitoring
"""

import os
from glob import glob
import json
import datetime as dt
import statistics
from collections import defaultdict

from emtools.utils import Pretty, Path, Timer
from emhub.utils import datetime_from_isoformat


def _load_cluster_queues(jsonfile):
    """Load cluster JSON (old single-dict or new list-of-queues format)."""
    with open(jsonfile) as f:
        data = json.load(f)

    if isinstance(data, list):
        return {entry['queue']: entry for entry in data}
    return {None: data}


def _iter_cluster_jobs(queues_data, jobsJson, queue_names=None):
    """Iterate jobs from selected queues, filtering by configured hosts."""
    if queue_names is None:
        queue_names = list(queues_data.keys())

    for queue_name in queue_names:
        queue_data = queues_data.get(queue_name)
        if not queue_data:
            continue

        for job in queue_data.get('jobs', []):
            host = job['compute_nodes_list']
            if host not in jobsJson:
                continue

            yield (job['jobID'], job['account_name'],
                   job['cpu_used'], job['gpu_used'], host)


def _iter_cluster_jobs_old(jsonfile, jobsJson):
    with open(jsonfile) as f:
        clusterJson = json.load(f)

    for job in clusterJson['RECORDS']:
        execHost = job['EXEC_HOST']
        if '*' in execHost:
            parts = execHost.split('*')
            cores = int(parts[0])
            host = parts[1]
        else:
            cores = 1
            host = execHost

        if not host:
            continue  # FIXME: PENDING JOBS

        if host not in jobsJson:
            continue

        gpus = int(job['GPU_NUM'] or 0)
        user = job['USER']
        jobid = job['JOBID']

        yield jobid, user, cores, gpus, host


# Default name of the JSON files (per queue) in the cluster data folder
DATA_FILES_PATTERN = '{queue}_lsf_{kind}_infor.json'


def _new_host(status='ok', used_cores=0, max_cores=0, used_gpus=0,
              max_gpus=0, jobs=0, **kwargs):
    """ Host dict as used in the cluster_queues templates. """
    host = {
        "status": status,
        "used_cores": used_cores,
        "max_cores": max_cores,
        "used_gpus": used_gpus,
        "max_gpus": max_gpus,
        "usage": 0,
        "users": defaultdict(lambda: []),
        "color": "transparent",
        "jobs": jobs
    }
    host.update(kwargs)
    return host


def _update_host_usage(hostJson):
    """ Compute the host usage (max of cores and gpus usage) and its color. """
    usageCores = (hostJson['used_cores'] / hostJson['max_cores']
                  if hostJson['max_cores'] else 0)
    usageGpu = (hostJson['used_gpus'] / hostJson['max_gpus']
                if hostJson['max_gpus'] else 0)
    usage = max(usageGpu, usageCores) * 100
    hostJson['usage'] = usage
    if usage >= 100:
        hostJson['status'] = 'closed_FULL'
        hostJson['color'] = '#eec2c8' #c53648'
    elif usage >= 50:
        hostJson['color'] = '#fcd7bf'  #'#f57b2a'
    elif usage > 0 or hostJson['jobs']:
        hostJson['color'] = '#fcf6ec'  # '#f4e1c1'

    if hostJson['status'] != 'ok' and usage < 100:
        hostJson['color'] = '#fbd9d3'  # closed or unavailable


def _load_cluster_folder(queuesConf):
    """ Load nodes and accounts usage from the JSON files (one set per
    queue) in the configured 'data_folder'. Each layout group defines
    the 'queues' whose nodes are shown in it.

    Returns: (layout, jobsJson, usersData, files)
    """
    folder = queuesConf['data_folder']
    pattern = queuesConf.get('data_files', DATA_FILES_PATTERN)

    def _load(queue, kind):
        fn = os.path.join(folder, pattern.format(queue=queue, kind=kind))
        if not os.path.exists(fn):
            return fn, []
        with open(fn) as f:
            return fn, json.load(f)

    files = []
    jobsJson = {}
    usersData = defaultdict(lambda: {'jobs': 0, 'pending': 0,
                                     'cores': 0, 'gpus': 0})
    layout = []

    for group in queuesConf['layout']:
        group = dict(group)
        nodes = []
        nodeQueues = {}
        gpuTypes = []

        for queue in group.get('queues', []):
            fn, nodesInfo = _load(queue, 'nodes')
            fnj, nodesJobs = _load(queue, 'nodes_with_jobs')
            fna, accounts = _load(queue, 'accounts')
            files.extend(fn for fn in [fn, fnj, fna] if os.path.exists(fn))

            # Nodes usage, from nodes_with_jobs, or nodes if not there
            queueNodes = {}
            for n in nodesInfo:
                queueNodes[n['name']] = _new_host(
                    status=n.get('status', 'ok'),
                    max_cores=n.get('ncpus', 0),
                    max_gpus=max(n.get('ngpus', 0), 0),
                    max_mem=n.get('mem_in_gb', 0),
                    gpu_type=n.get('gpu_type', 'none'))
            for n in nodesJobs:
                queueNodes[n['node_name']] = _new_host(
                    status=n.get('status', 'ok'),
                    used_cores=n.get('ncpus_in_use', 0),
                    max_cores=n.get('total_cpus', 0),
                    used_gpus=n.get('ngpus_in_use', 0),
                    max_gpus=max(n.get('total_gpus', 0), 0),
                    used_mem=n.get('memory_in_use', 0),
                    max_mem=n.get('total_mem_in_gb', 0),
                    gpu_type=n.get('gpu_type', 'none'),
                    jobs=n.get('njobs', 0))

            for name in sorted(queueNodes):
                if name in nodeQueues:
                    continue
                hostJson = queueNodes[name]
                _update_host_usage(hostJson)
                hostJson['queue'] = queue
                hostJson['accounts'] = {}
                jobsJson[name] = hostJson
                nodes.append(name)
                nodeQueues[name] = queue
                if hostJson['gpu_type'] not in gpuTypes:
                    gpuTypes.append(hostJson['gpu_type'])

            # Accounts (users) usage, the jobs per node are not known
            # but only the nodes where the account has jobs running
            for a in accounts:
                account = a['account_name']
                accountNodes = (a.get('compute_nodes_list') or '').split()
                accountJson = {
                    'queue': queue,
                    'jobs': a.get('n_running_jobs', 0),
                    'pending': a.get('n_pending_jobs', 0),
                    'cores': a.get('n_cpus_used', 0),
                    'gpus': a.get('n_gpus_used', 0),
                    'parent': a.get('parent_account', ''),
                    'nodes': accountNodes
                }
                userJson = usersData[account]
                for k in ['jobs', 'pending', 'cores', 'gpus']:
                    userJson[k] += accountJson[k]
                for host in accountNodes:
                    if nodeQueues.get(host) == queue:
                        hostJson = jobsJson[host]
                        hostJson['users'].setdefault(account, [])
                        hostJson['accounts'][account] = accountJson

        hosts = [jobsJson[n] for n in nodes]
        usage = sum(h['usage'] for h in hosts)
        group.update({
            'nodes': nodes,
            'node_queues': nodeQueues,
            'usage': f"{usage / len(nodes) if nodes else 0:0.2f}",
            'gpu_types': [t for t in gpuTypes if t != 'none'],
            'total_cores': sum(h['max_cores'] for h in hosts),
            'total_gpus': sum(h['max_gpus'] for h in hosts)
        })
        layout.append(group)

    return layout, jobsJson, usersData, files


def _load_cluster_json(queuesConf, kwargs):
    """ Load the jobs from a single JSON file for the nodes defined in
    the layout of the cluster config.

    Returns: (layout, jobsJson, usersData, jsonfile)
    """
    queuesLayout = queuesConf['layout']

    # Initialize jobs dict based on the Layout
    jobsJson = {}
    for layout in queuesLayout:
        specs = layout['specs']
        max_cores = specs['CPUs']
        max_gpus = 0
        for gpu in specs['GPUs'].values():
            max_gpus = gpu['count']

        for node in layout['nodes']:
            jobsJson[node] = _new_host(max_cores=max_cores, max_gpus=max_gpus)

    usersData = defaultdict(lambda : {'jobs': 0, 'cores': 0, 'gpus': 0, 'usage': 0})

    if 'old' in kwargs:
        jsonfile = '/Users/jdela80/work/development/emhub-otf/sample_scripts/emgoat-data/OLD_cryoem_jobs.json'
        iter_cluster_jobs = _iter_cluster_jobs_old(jsonfile, jobsJson)
    else:
        jsonfile = queuesConf['json']
        queues_data = _load_cluster_queues(jsonfile)
        queue_names = {layout['queue'] for layout in queuesLayout
                       if layout.get('queue')} or None
        iter_cluster_jobs = _iter_cluster_jobs(
            queues_data, jobsJson, queue_names)

    for jobid, user, cores, gpus, host in iter_cluster_jobs:
        hostJson = jobsJson[host]
        hostJson['jobs'] += 1
        hostJson['users'][user].append({
            "jobid": jobid,
            "cores": cores,
            "gpus": gpus})
        hostJson['used_cores'] += cores
        hostJson['used_gpus'] += gpus
        userJson = usersData[user]
        userJson['jobs'] += 1
        userJson['cores'] += cores
        userJson['gpus'] += gpus
        _update_host_usage(hostJson)

    # Let's update some stats for each group
    for layout in queuesLayout:
        usage = sum(jobsJson[node]['usage'] for node in layout['nodes'])
        layout['usage'] = f"{usage / len(layout['nodes']):0.2f}"

    return queuesLayout, jobsJson, usersData, jsonfile


SPARC_SUFFIX = '_sparc'


def _build_cluster_lab_maps(dm):
    """Build lookups to resolve cluster account names to EMhub PI labs."""
    by_username = {u.username: u for u in dm.get_users()}

    group_to_lab = {}
    for email, group in dm.get_config('sessions').get('groups', {}).items():
        user = dm.get_user_by(email=email)
        if user is None:
            continue
        pi = user.get_pi()
        group_to_lab[group] = pi.name if pi else user.name

    account_to_lab = {}
    for account, email in dm.get_config('computing').get('accounts', {}).items():
        user = dm.get_user_by(email=email)
        if user is None:
            continue
        pi = user.get_pi()
        account_to_lab[account] = pi.name if pi else user.name

    return by_username, group_to_lab, account_to_lab


def _lab_label_for_account(account, by_username, group_to_lab, account_to_lab):
    user = by_username.get(account)
    if user is not None:
        pi = user.get_pi()
        return pi.name if pi else user.name

    group_name = account
    if account.endswith(SPARC_SUFFIX):
        group_name = account[:-len(SPARC_SUFFIX)]

    if group_name in group_to_lab:
        return group_to_lab[group_name]

    if account in account_to_lab:
        return account_to_lab[account]

    if group_name in account_to_lab:
        return account_to_lab[group_name]

    return account


def _aggregate_labs_usage(usersData, dm):
    by_username, group_to_lab, account_to_lab = _build_cluster_lab_maps(dm)
    labsData = defaultdict(lambda: {'jobs': 0, 'cores': 0, 'gpus': 0})

    for account, stats in usersData.items():
        label = _lab_label_for_account(
            account, by_username, group_to_lab, account_to_lab)
        lab = labsData[label]
        lab['jobs'] += stats['jobs']
        lab['cores'] += stats['cores']
        lab['gpus'] += stats['gpus']
        if 'pending' in stats:
            lab['pending'] = lab.get('pending', 0) + stats['pending']

    labs = []
    for name, stats in labsData.items():
        stats['name'] = name
        labs.append(stats)

    labs.sort(key=lambda l: l['cores'], reverse=True)
    return labs


def _compute_overall_stats(jobsJson, usersData):
    usages = [h['usage'] for h in jobsJson.values()]
    avg_usage = sum(usages) / len(usages) if usages else 0

    return {
        'users': len(usersData),
        'jobs': sum(h['jobs'] for h in jobsJson.values()),
        'cpus': sum(h['used_cores'] for h in jobsJson.values()),
        'gpus': sum(h['used_gpus'] for h in jobsJson.values()),
        'usage': f"{avg_usage:0.2f}",
        # Pending jobs are only known when loading from a data folder
        'pending': (sum(u['pending'] for u in usersData.values())
                    if any('pending' in u for u in usersData.values())
                    else None)
    }


def register_content(dc):

    @dc.content
    def cluster_queues(**kwargs):
        dm = dc.app.dm
        queuesConfig = dm.get_config('queues')
        clusterName = kwargs.get('cluster_name') or next(iter(queuesConfig))
        queuesConf = queuesConfig[clusterName]

        if 'data_folder' in queuesConf:
            queuesLayout, jobsJson, usersData, files = \
                _load_cluster_folder(queuesConf)
            updated = (Pretty.modified(max(files, key=os.path.getmtime))
                       if files else 'never')
        else:
            queuesLayout, jobsJson, usersData, jsonfile = \
                _load_cluster_json(queuesConf, kwargs)
            updated = Pretty.modified(jsonfile)

        users = []
        for k, u in usersData.items():
            u['name'] = k
            users.append(u)

        users.sort(key=lambda u: u['cores'], reverse=True)
        labMaps = _build_cluster_lab_maps(dm)
        labs = _aggregate_labs_usage(usersData, dm)
        overall = _compute_overall_stats(jobsJson, usersData)
        accountLabs = {u['name']: _lab_label_for_account(u['name'], *labMaps)
                       for u in users}

        return {
            'queues': queuesLayout,
            'jobs': jobsJson,
            'updated': updated,
            'tab': kwargs.get('tab', 'nodes'),
            'users': users,
            'labs': labs,
            'overall': overall,
            'account_labs': accountLabs,
            'mode': kwargs.get('mode', 'compact'),
            'cluster_name': clusterName
        }

    @dc.content
    def cluster_queues_content(**kwargs):
        return cluster_queues(**kwargs)
