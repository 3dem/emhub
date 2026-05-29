# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *              Grigory Sharov (gsharov@mrc-lmb.cam.ac.uk) [2]
# *
# * [1] SciLifeLab, Stockholm University
# * [2] MRC Laboratory of Molecular Biology (MRC-LMB)
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
This module define the `DataClient` class to communicate with an existing
EMHub server via its REST API.

By default, the `DataClient` class will use the configuration read from
`os.environ` in the `config` class.

A helper function `open_client` is provided for creating a context
where a `DataClient` instance is created, logged in and out.
"""
import os
import sys
import json
import copy
import argparse
from datetime import datetime
from pprint import pprint

from .data_client import open_client, config

from emtools.utils import Pretty, Color, Path, FolderManager
from emtools.metadata import MovieFiles, StarFile


def date_str(datetimeStr):
    """ Helper to retrieve the date. """
    return datetimeStr.split('T')[0]


def date(datetimeStr):
    dateStr = datetimeStr.split('T')[0]
    return datetime.strptime(dateStr, '%Y-%m-%d')


def _booking_days(start_iso, end_iso):
    """Days spanned by a booking (inclusive); start/end are API ISO strings."""
    start = datetime.fromisoformat(start_iso.replace('Z', '+00:00'))
    end = datetime.fromisoformat(end_iso.replace('Z', '+00:00'))
    return max(1, (end.date() - start.date()).days + 1)


def _resource_daily_cost(res):
    """Daily cost from resource.extra (0 if missing)."""
    return int((res.get('extra') or {}).get('daily_cost', 0))


def parse_booking_filters(filter_strings):
    """
    Parse -f/--filter arguments into a dict for retrieve_bookings_list.

    Syntax (space-separated key=value; multiple -f flags are merged):
      user=ID       — owner_id must equal ID (integer)
      resource=...  — resource_id or resource name (comma-separated); each token
                      is either an integer id or a name, e.g. resource=Krios01,3
      pi=ID         — booking included if owner's pi_id == ID, or application's
                      first PI id == ID (lab / application PI match)

    Example:
      -f "user=120 resource=1,3"
      -f "resource=Krios01,3"
      -f "pi=123"
    """
    out = {}
    if not filter_strings:
        return out
    for part in filter_strings:
        for token in part.split():
            if '=' not in token:
                continue
            key, val = token.split('=', 1)
            key = key.strip().lower()
            val = val.strip()
            if key == 'user':
                out['user'] = int(val)
            elif key == 'resource':
                out['resource'] = [x.strip() for x in val.split(',') if x.strip()]
            elif key == 'pi':
                out['pi'] = int(val)
    return out


def retrieve_bookings_list(start_str, end_str, filters=None):
    """
    Fetch bookings in [start_str, end_str] via get_bookings_range (func=to_json)
    and return a list of display dicts: date, user, pi_name, app_code, days,
    resource, total (cost = days * daily_cost per resource).

    filters: optional dict from parse_booking_filters(); all given criteria
    must match (AND). Empty filters dict means no filtering.
    """
    filters = filters or {}
    with open_client() as dc:
        r = dc.request('get_users', jsonData={})
        r.raise_for_status()
        users_by_id = {u['id']: u for u in r.json()}

        r = dc.request('get_resources', jsonData={})
        r.raise_for_status()
        resources_list = r.json()
        resources_by_id = {res['id']: res for res in resources_list}
        resource_lookup = {}
        for res in resources_list:
            rid = res['id']
            resource_lookup[str(rid)] = rid
            if res.get('name'):
                resource_lookup[res['name'].lower()] = rid

        allowed_resource_ids = None
        tokens = filters.get('resource') or []
        if tokens:
            allowed_resource_ids = set()
            for t in tokens:
                key = t if t.isdigit() else t.lower()
                rid = resource_lookup.get(key)
                if rid is not None:
                    allowed_resource_ids.add(rid)

        r = dc.request('get_applications', jsonData={})
        r.raise_for_status()
        applications_by_id = {a['id']: a for a in r.json()}

        r = dc.request(
            'get_bookings_range',
            jsonData={'start': start_str, 'end': end_str, 'func': 'to_json'},
        )
        r.raise_for_status()
        bookings = r.json()

    rows = []
    for b in bookings:
        resource_id = b.get('resource_id')
        application_id = b.get('application_id')
        owner_id = b.get('owner_id')
        start_iso = b.get('start') or ''
        end_iso = b.get('end') or ''

        # --- apply filters (AND) ---
        if filters.get('user') is not None:
            if owner_id != filters['user']:
                continue
        if allowed_resource_ids is not None:
            if resource_id is None or resource_id not in allowed_resource_ids:
                continue
        if filters.get('pi') is not None:
            owner = users_by_id.get(owner_id) if owner_id else None
            owner_pi = owner.get('pi_id') if owner else None
            app_pi_id = None
            if application_id:
                app = applications_by_id.get(application_id)
                if app:
                    pi_list = app.get('pi_list') or []
                    app_pi_id = pi_list[0] if pi_list else app.get('creator_id')
            pi_match = (owner_pi == filters['pi']) or (app_pi_id == filters['pi'])
            if not pi_match:
                continue

        resource = resources_by_id.get(resource_id) if resource_id else None
        resource_name = resource.get('name', '?') if resource else '?'
        daily_cost = _resource_daily_cost(resource) if resource else 0
        days = _booking_days(start_iso, end_iso)
        total_cost = days * daily_cost

        pi_name = ''
        app_code = ''
        pi_id_resolved = None
        if application_id:
            app = applications_by_id.get(application_id)
            if app:
                app_code = app.get('code') or app.get('alias') or str(application_id)
                pi_list = app.get('pi_list') or []
                pi_id_resolved = pi_list[0] if pi_list else app.get('creator_id')
                if pi_id_resolved is not None:
                    u = users_by_id.get(pi_id_resolved)
                    if u:
                        label = u.get('name') or u.get('email') or str(pi_id_resolved)
                        pi_name = '%s (%s)' % (label, pi_id_resolved)
        if not pi_name and owner_id:
            owner = users_by_id.get(owner_id)
            if owner and owner.get('pi_id'):
                pi_id_resolved = owner['pi_id']
                u = users_by_id.get(pi_id_resolved)
                if u:
                    label = u.get('name') or u.get('email') or '?'
                    pi_name = '%s (%s)' % (label, pi_id_resolved)
                else:
                    pi_name = '? (%s)' % pi_id_resolved
            elif owner:
                # No PI link; show owner as fallback with owner id
                label = owner.get('name') or owner.get('email') or '?'
                pi_name = '%s (%s)' % (label, owner_id)

        owner = users_by_id.get(owner_id) if owner_id else None
        if owner:
            label = owner.get('name') or owner.get('email') or '?'
            user_name = '%s (%s)' % (label, owner_id)
        else:
            user_name = '—'

        rows.append({
            'id': b.get('id'),
            'date': start_iso[:10] if start_iso else '',
            'user': user_name,
            'pi_name': pi_name or '—',
            'app_code': app_code or '—',
            'days': days,
            'resource': resource_name,
            'total': total_cost,
        })
    return rows


def print_bookings_list(rows, start_str, end_str):
    """Print bookings rows as a column-aligned table to stdout."""
    # wu/wp wider to fit "Name (id)" for user and PI
    wd, wu, wp, wa, wdays, wr, wc = 12, 30, 30, 14, 5, 16, 10
    fmt = (
        '{date:<{wd}} {user:<{wu}} {pi_name:<{wp}} {app_code:<{wa}} '
        '{days:>{wdays}} {resource:<{wr}} {total:>{wc}}'
    )
    header = fmt.format(
        date='Date', user='User', pi_name='PI', app_code='Application',
        days='Days', resource='Resource', total='Cost',
        wd=wd, wu=wu, wp=wp, wa=wa, wdays=wdays, wr=wr, wc=wc,
    )
    print('Bookings ({} – {})'.format(start_str, end_str))
    print('-' * len(header))
    print(header)
    print('-' * len(header))
    for row in rows:
        print(fmt.format(
            date=row['date'],
            user=(row['user'] or '—')[:wu],
            pi_name=(row['pi_name'] or '—')[:wp],
            app_code=(row['app_code'] or '—')[:wa],
            days=row['days'],
            resource=(row['resource'] or '?')[:wr],
            total=row['total'],
            wd=wd, wu=wu, wp=wp, wa=wa, wdays=wdays, wr=wr, wc=wc,
        ))
    print('-' * len(header))
    print('Total: {} bookings, grand total cost: {}'.format(
        len(rows), sum(r['total'] for r in rows)))


def delete_bookings_list(rows):
    """
    Delete each booking by id via delete_booking API.
    Bookings with sessions cannot be deleted (server error).
    """
    deleted = 0
    errors = []
    with open_client() as dc:
        for row in rows:
            bid = row.get('id')
            if bid is None:
                continue
            r = dc.request('delete_booking', jsonData={'attrs': {'id': bid}})
            result = r.json()
            if result.get('error'):
                errors.append((bid, result['error']))
            else:
                deleted += 1
                print('Deleted booking id=%s' % bid)
    print('Deleted %d booking(s).' % deleted)
    if errors:
        print(Color.red('%d failed:' % len(errors)))
        for bid, err in errors:
            print(Color.red('  id=%s: %s' % (bid, err)))


def process_booking(args):
    """booking subparser: list or delete bookings in date range (with filters)."""
    filters = parse_booking_filters(args.filter or [])
    if getattr(args, 'delete', False):
        # Avoid deleting entire range by mistake
        if not filters and not getattr(args, 'force', False):
            print(Color.red(
                'Refusing to delete with no filters (would delete all in range). '
                'Add -f filters or pass --force.'
            ))
            sys.exit(1)
    rows = retrieve_bookings_list(args.start, args.end, filters=filters)
    if getattr(args, 'delete', False):
        if not rows:
            print('No bookings match; nothing to delete.')
            return
        print('About to delete %d booking(s) in %s – %s.' % (
            len(rows), args.start, args.end))
        delete_bookings_list(rows)
    else:
        print_bookings_list(rows, args.start, args.end)


def process_users(args):
    with open_client() as dc:
        if jsonFile := args.update:
            with open(jsonFile) as f:
                userJson = json.load(f)

            action = 'update' if 'id' in userJson else 'create'
            r = dc.request(f'{action}_user', jsonData={'attrs': userJson})
            print(r.json())
            return
        else:
            r = dc.request('get_users', jsonData={})
            usersDict = {u['id']: u for u in r.json()}

    if args.list:  # Print detailed info about specific users
        for uid in args.list:
            print(json.dumps(usersDict[int(uid)], indent=4))

    elif args.list is not None:  # Print all in a table
        headers = ["USERID", "USERNAME", "EMAIL", "PI", "ROLES"]
        format_str = u'{:<10}{:<40}{:<30}{:<20}{:<20}'

        print(format_str.format(*headers))

        def _filter(f, user):
            return eval(f, {}, {'u': user})

        filters = args.filters or []

        # filters = [
        #     lambda u: u['pi_id'] == 76 or u['id'] == 76
        # ]

        for user in usersDict.values():
            if pid := user['pi_id']:
                piStr = "%s (%d)" % (usersDict[pid]['name'], pid)
            else:
                piStr = 'None'

            if not all(_filter(f, user) for f in filters):
                continue

            print(format_str.format(user['id'], user['email'], user['name'],
                                    piStr, str(user['roles'])))


def process_forms(args):
    with open_client() as dc:
        forms = dc.request('get_forms', jsonData=None).json()
        form_ids = set(f['id'] for f in forms)
        form_dict = {f['id']: f for f in forms}

        if args.list and args.list != 'all':
            list_ids = [int(id) for id in args.list.split()]
            forms = [form_dict[id] for id in list_ids]

    if jsonForms := args.update:
        print(f"Loading Forms from json: {jsonForms}...")
        with open(jsonForms) as f:
            formList = json.load(f)
            with open_client() as dc:
                for f in formList:
                    if 'id' not in f or f['id'] not in form_ids:
                        print(f">>> Creating new form\t {f['name']}")
                        dc.request('create_form', jsonData={'attrs': f})
                    else:
                        print(f">>> Updating form ID={f['id']}\t {f['name']}")
                        dc.request('update_form', jsonData={'attrs': f})

    elif jsonForms := args.save:
        print(f"Writing Forms to json: {jsonForms}...")
        with open(jsonForms, 'w') as f:
            fields = ['name', 'definition'] if args.no_ids else ['id', 'name', 'definition']
            formList = [{field: f[field] for field in fields} for f in forms]
            json.dump(formList, f, indent=4)

    elif args.list:
        if len(forms) > 1:
            row_format = u"{:<10}{:<35}"
            print(row_format.format("Form ID", "Name"))
            for f in forms:
                print(row_format.format(f['id'], f['name']))
        else:
            f = forms[0]
            print(json.dumps(f, indent=4))


def process_sessions(args):
    with open_client() as dc:
        def _request(method, attrs):
            r = dc.request(method, jsonData={'attrs': attrs})
            rjson = r.json()
            if 'error' in rjson:
                print(Color.red(rjson['error']))
            else:
                print(rjson)
            return rjson

        def _session_create_or_update(s):
            if 'owner_id' in s:
                del s['owner_id']  # This is from booking, not session

            if 'id' not in s:
                print(">>> Creating NEW session")
                url_prefix = 'create'
            else:
                print(f">>> Updating session ID={s['id']}")
                url_prefix = 'update'

            _request(f'{url_prefix}_session', s)

        if update := args.update:
            if os.path.exists(update):  # Update sessions from a JSON file
                print(f"Loading session from json: {update}...")
                with open(update) as f:
                    _session_create_or_update(json.load(f))

            else:  # An id should be provided
                session_id = int(args.update)
                r = dc.request('get_sessions', jsonData={'condition': 'id=%s' % session_id})
                s = r.json()[0]
                extra = s['extra']
                raw = s['extra']['raw']
                cwd = os.path.abspath(os.getcwd())
                rawPath = os.path.realpath(os.path.join(cwd, 'data'))
                #rawPath = raw['path']
                raw['path'] = rawPath
                extra['otf'] = {
                    "cryolo_model": "",
                    "host": "cryo-em-wkst04.stjude.org",
                    "path": cwd,
                    "status": "running",
                    "workflow": "emwrap"
                }
                if os.path.exists(rawPath):
                    mf = MovieFiles()
                    mf.scan(rawPath)
                    raw.update(mf.info())
                    _request('update_session', {'id': session_id, 'extra': extra})
                    #print(json.dumps(extra, indent=4))
            return

        sessions = dc.request('get_sessions', jsonData=None).json()
        filters = args.filters or []

        print(filters)

        def _filter(f, session):
            return eval(f, {}, {'s': session})

        def _all(session):
            if args.from_date:
                print("Checking start date: ", date(session['start']) >= date(args.from_date))
                return date(session['start']) >= date(args.from_date)

            if filters:
                return all(_filter(f, session) for f in filters)
            return True

        sessions_dict = {s['id']: s for s in sessions if _all(s)}

        ids = args.list
        if ids is not None:
            if len(ids):
                selected_sessions = [sessions_dict[int(sid)] for sid in ids]
                for s in selected_sessions:
                    print(json.dumps(s, indent=4))
            else:
                row_format = u"{:<6}{:<12}{:<6}{:<35}"
                print(row_format.format("ID", "Date", "OwnerId", "Name"))
                for s in sessions_dict.values():
                    print(row_format.format(s['id'],
                                            date_str(s['start']),
                                            s['owner_id'],
                                            s['name']))

        elif args.create:
            with open(args.create) as f:
                session_json = json.load(f)
                # Drop id field in case it is present
                session_json.pop('id', None)
                _session_create_or_update(session_json)


def process_pucks(args):
    with open_client() as dc:
        pucks = dc.request('get_pucks', jsonData=None).json()
        # sessions_dict = {s['id']: s for s in sessions}

        if args.list:
            row_format = u"{:>6}  {:<20}{:>6}{:>6}{:>6}  {:<30}"
            print(row_format.format("ID", "Label", "Dewar", "Cane",
                                    "Pos", "Extra"))
            for p in pucks:
                print(row_format.format(p['id'], p['label'], p['dewar'],
                                        p['cane'], p['position'],
                                        json.dumps(p['extra'])))
        elif jsonFile := args.save:
            print(f"Writing Pucks Storage as JSON to file: {jsonFile}...")
            with open(jsonFile, 'w') as f:
                # Write one puck in each line
                f.write("[\n")
                n = len(pucks)
                for i, p in enumerate(pucks):
                    f.write("   ")
                    json.dump(p, f)
                    char = ',' if i < n - 1 else ''
                    f.write(f'{char}\n')
                f.write("]\n")

        elif jsonFile := args.update:
            if not os.path.exists(jsonFile):
                raise Exception("Input Pucks json file does not exist.")

            def _request(method, attrs, successLabel):
                req = dc.request(method, jsonData={'attrs': attrs})
                result = req.json()
                if 'puck' in result:
                    print(f"Puck {p['id']} {successLabel}.")
                else:
                    print(f"Puck {p['id']} Error: ", Color.red(result['error']))

            with open(jsonFile) as f:
                storage = json.load(f)
                # Delete all existing pucks before updating with new ones
                for p in pucks:
                    _request('delete_puck', {'id': p['id']}, 'DELETED')
                for p in storage:
                    _request('create_puck', p, 'CREATED')
        else:
            pass


def process_entries(args):
    with open_client() as dc:
        # sessions_dict = {s['id']: s for s in sessions}
        if arg := args.list:
            try:
                if arg.startswith('P:'):
                    input_id = int(arg.replace('P:', ''))
                    cond_str = 'project_id=%s' % input_id
                    print(f"Getting entry with ID: {input_id}")
                else:
                    input_id = int(arg)
                    cond_str = 'project_id=%s' % input_id
                    print(f"Getting entries from project: {input_id}")

                req = dc.request('get_entries', jsonData={'condition': cond_str})
                print(json.dumps(req.json(), indent=4))
                return
            except ValueError as e:
                print("Error: ", e)
                entries = dc.request('get_entries', jsonData=None).json()
                row_format = u"{:>6}   {:>6}   {:<25} {:<30}"
                print(row_format.format("ID", "ProjId", "Type", "Date"))
                for e in entries:
                    print(row_format.format(e['id'], "P:%04d" % e['project_id'],
                                            e['type'],
                                            date_str(e['date'])))


def _processing_path_key(e):
    """Full processing_path from extra['data'] (match key for restore)."""
    return ((e.get('extra') or {}).get('data') or {}).get('processing_path') or ''


def _entry_processing_path(e, max_len=72):
    """Path from extra['data']['processing_path'], truncated for terminal tables."""
    p = _processing_path_key(e)
    if len(p) > max_len:
        return p[: max_len - 3] + '...'
    return p


def _processing_delete_all():
    """Remove every tomo_processing entry."""
    cond = "type='tomo_processing'"
    deleted = 0
    errors = []
    with open_client() as dc:
        r = dc.request('get_entries', jsonData={'condition': cond})
        r.raise_for_status()
        entries = r.json()
        for e in entries:
            rid = e['id']
            r2 = dc.request('delete_entry', jsonData={'attrs': {'id': rid}})
            result = r2.json()
            if result.get('error'):
                errors.append((rid, result['error']))
            else:
                deleted += 1
                print('Deleted entry id=%s' % rid)
    print('Deleted %d tomo_processing entr%s.' % (
        deleted, 'y' if deleted == 1 else 'ies'))
    if errors:
        print(Color.red('%d failed:' % len(errors)))
        for rid, err in errors:
            print(Color.red('  id=%s: %s' % (rid, err)))


def _processing_restore(project_id, json_path):
    """Create/update tomo_processing entries under project_id from a --save JSON file."""
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        print(Color.red('Invalid PROJECT_ID: %r' % project_id))
        return

    if not os.path.isfile(json_path):
        print(Color.red('File not found: %s' % json_path))
        return

    with open(json_path) as f:
        file_entries = json.load(f)

    if not isinstance(file_entries, list):
        print(Color.red('JSON must be a list of entry objects (same format as --save).'))
        return

    cond = "project_id=%s and type='tomo_processing'" % pid
    created = updated = 0
    errors = []

    with open_client() as dc:
        r = dc.request('get_entries', jsonData={'condition': cond})
        r.raise_for_status()
        existing_list = r.json()

        by_path = {}
        for e in existing_list:
            k = _processing_path_key(e)
            if not k:
                continue
            if k in by_path:
                print(Color.red(
                    'Warning: duplicate processing_path %r in DB (ids %s and %s); '
                    'using the latter.' % (k, by_path[k]['id'], e['id'])))
            by_path[k] = e

        for item in file_entries:
            path_key = _processing_path_key(item)
            if not path_key:
                print('Skipping list item with no extra.data.processing_path')
                continue

            if path_key in by_path:
                ex = by_path[path_key]
                attrs = copy.deepcopy(item)
                attrs['id'] = ex['id']
                attrs['project_id'] = pid
                attrs['type'] = 'tomo_processing'
                attrs['validate'] = False
                r2 = dc.request('update_entry', jsonData={'attrs': attrs})
                result = r2.json()
                if result.get('error'):
                    errors.append((ex['id'], result['error']))
                    print(Color.red('Update id=%s failed: %s' % (ex['id'], result['error'])))
                else:
                    updated += 1
                    print('Updated entry id=%s path=%r' % (ex['id'], path_key))
            else:
                attrs = copy.deepcopy(item)
                attrs.pop('id', None)
                attrs.pop('validate', None)
                attrs['project_id'] = pid
                attrs['type'] = 'tomo_processing'
                r2 = dc.request('create_entry', jsonData={'attrs': attrs})
                result = r2.json()
                if result.get('error'):
                    errors.append((path_key, result['error']))
                    print(Color.red('Create failed for %r: %s' % (path_key, result['error'])))
                else:
                    created += 1
                    ent = result.get('entry') or result
                    new_id = ent.get('id') if isinstance(ent, dict) else None
                    print('Created entry id=%s path=%r' % (new_id, path_key))
                    if new_id and isinstance(ent, dict):
                        by_path[path_key] = ent

    print('Restore finished: %d created, %d updated.' % (created, updated))
    if errors:
        print(Color.red('%d operation(s) failed (see above).' % len(errors)))


def process_processing(args):
    """processing subparser: list, save, delete, or restore tomo_processing entries."""
    if getattr(args, 'delete', False):
        _processing_delete_all()
        return

    if getattr(args, 'restore', None):
        project_id, json_path = args.restore
        _processing_restore(project_id, json_path)
        return

    if not args.list and not args.save:
        print('Specify --list (-l) and/or --save (-s) JSON_FILE, '
              'or --delete (-d), or --restore (-r) PROJECT_ID JSON_FILE.')
        return

    cond = "type='tomo_processing'"
    with open_client() as dc:
        r = dc.request('get_entries', jsonData={'condition': cond})
        r.raise_for_status()
        entries = r.json()

    if args.list:
        wtype, wdate, wpath = 25, 12, 72
        row_format = u"{:>6}   {:>6}   {:<%d} {:<%d} {:%d}" % (wtype, wdate, wpath)
        print(row_format.format("ID", "ProjId", "Type", "Date", "Processing path"))
        for e in entries:
            print(row_format.format(
                e['id'],
                "P:%04d" % e['project_id'],
                e['type'],
                date_str(e['date']),
                _entry_processing_path(e, max_len=wpath),
            ))
        print('Total: %d tomo_processing entr%s.' % (
            len(entries), 'y' if len(entries) == 1 else 'ies'))

    if args.save:
        print('Writing %d entr%s to %s...' % (
            len(entries), 'y' if len(entries) == 1 else 'ies', args.save))
        with open(args.save, 'w') as f:
            json.dump(entries, f, indent=4)


def dump(keys, json_file):
    from emhub.client import open_client, config

    with open_client() as dc:
        json_data = {}

        if 'forms' in keys:
            forms = dc.request('get_forms').json()
            json_data['forms'] = [{
                'id': f['id'],
                'name': f['name'],
                'definition': f['definition']
            } for f in forms]

        if 'resources' in keys:
            json_data['resources'] = dc.request('get_resources').json()

        if 'users' in keys:
            json_data['users'] = dc.request('get_users').json()

        if json_data:
            with open(json_file, 'w') as f:
                json.dump(json_data, f, indent=4)


def main():
    p = argparse.ArgumentParser(prog='emh-client')
    p.add_argument('--url', '-u', default='')

    subparsers = p.add_subparsers(dest='entity')

    # ------------------------- USER subparser -------------------------------
    user_p = subparsers.add_parser("user")

    g = user_p.add_mutually_exclusive_group()
    g.add_argument('--update', '-u', metavar='USER_JSON_STR',
                   help="Update user with the given JSON")
    g.add_argument('--list', '-l', nargs='*', metavar='USER_ID')
    user_p.add_argument('--filters', '-f', nargs='*', metavar='FILTER',
                        help="Filter string to be used with list option."
                             "For example: ")

    # ------------------------- Form subparser -------------------------------
    form_p = subparsers.add_parser("form")

    g = form_p.add_mutually_exclusive_group()
    # g.add_argument('--method', '-m', nargs=2, metavar=('METHOD', 'JSON'),
    #                help='Execute a method from the client')

    g.add_argument('--save', metavar='FORMS_JSON_FILE',
                   help="Store forms definition in a json file. ")
    g.add_argument('--update', metavar='FORMS_JSON_FILE',
                   help="Update forms with data from the json file. ")
    form_p.add_argument('--list', '-l', nargs='?', const='all', default='')
    form_p.add_argument('--no-ids', '-n', action='store_true', default=False,
                        help="Do not include IDs in the saved JSON file.")

    # ------------------------- Session subparser -------------------------------
    session_p = subparsers.add_parser("session")

    g = session_p.add_mutually_exclusive_group()
    # g.add_argument('--method', '-m', nargs=2, metavar=('METHOD', 'JSON'),
    #                help='Execute a method from the client')
    g.add_argument('--list', '-l', nargs='*',
                   help="List sessions, leave it empty to list all.")
    g.add_argument('--create', '-c', metavar='SESSION_JSON',
                   help='Create a session from the json file. ')
    g.add_argument('--update', '-u', metavar='JSON_FILE_OR_ID',
                   help="Update forms with data from the json file. "
                        "A session ID can also be passed and then"
                        "it will be updated reading files from raw. ")
    session_p.add_argument('--filters', '-f', nargs='*', metavar='FILTER',
                           help="Filter string to be used with list option.")
    session_p.add_argument('--from_date', metavar='FROM_DATE',
                           help="Retrieve sessions starting from this date onwards."
                                "Format: YYYY-MM-DD. ")

    # ------------------------- Booking subparser -------------------------------
    booking_p = subparsers.add_parser(
        "booking",
        help="List or delete bookings in a date range (table: date, user, PI, "
             "application, days, resource, cost). Use -d to delete matches; "
             "requires -f filters unless --force.",
    )
    booking_p.add_argument(
        'start',
        help='Start date (YYYY-MM-DD)',
    )
    booking_p.add_argument(
        'end',
        help='End date (YYYY-MM-DD)',
    )
    booking_p.add_argument(
        '--filter', '-f',
        action='append',
        metavar='EXPR',
        help='Filter bookings (space-separated key=value; repeat -f to add). '
             'user=ID — owner user id; resource=1,Krios01 — resource id(s) and/or '
             'name(s), comma-separated; pi=ID — owner pi_id or application PI. '
             'Example: -f "user=120 resource=Krios01,3"',
    )
    booking_p.add_argument(
        '--delete', '-d',
        action='store_true',
        help='Delete bookings that match the date range and filters (same selection '
             'as listing). Requires at least one -f unless --force.',
    )
    booking_p.add_argument(
        '--force',
        action='store_true',
        help='With --delete, allow deleting all bookings in range when no -f filters '
             'are given (dangerous).',
    )

    # ------------------------- Puck subparser -------------------------------
    puck_p = subparsers.add_parser("puck")

    g = puck_p.add_mutually_exclusive_group()
    g.add_argument('--save', metavar='PUCKS_JSON_FILE',
                   help="Store pucks storage into a a JSON file. ")
    g.add_argument('--update', metavar='PUCKS_JSON_FILE',
                   help="Update pucks storage info from a JSON file. "
                        "Be careful that this option will delete existing "
                        "pucks. ")
    g.add_argument('--list', '-l', action="store_true")

    # ------------------------- Entry subparser -------------------------------
    entry_p = subparsers.add_parser("entry")

    g = entry_p.add_mutually_exclusive_group()
    g.add_argument('--list', '-l')

    # ------------------------- Processing subparser -------------------------------
    processing_p = subparsers.add_parser(
        "processing",
        help="List, export, delete, or restore tomography processing entries "
             "(type tomo_processing).",
    )
    processing_p.add_argument(
        '--list', '-l',
        action='store_true',
        help='List all tomo_processing entries (table: id, project, type, date, '
             'processing path).',
    )
    processing_p.add_argument(
        '--save', '-s',
        metavar='JSON_FILE',
        help='Save all tomo_processing entries as JSON to this file.',
    )
    processing_p.add_argument(
        '--delete', '-d',
        action='store_true',
        help='Delete all tomo_processing entries.',
    )
    processing_p.add_argument(
        '--restore', '-r',
        nargs=2,
        metavar=('PROJECT_ID', 'JSON_FILE'),
        help='Restore entries from a --save JSON file into PROJECT_ID: match by '
             'processing_path, update existing or create new.',
    )

    # ------------------------- Mail subparser -------------------------------
    mail_p = subparsers.add_parser("email")
    mail_p.add_argument('dst', help="Destination email. ", nargs='+')
    mail_p.add_argument('subject', help="Mail subject. ")
    mail_p.add_argument('body', help="Mail body text. ")

    # ------------------------- Method subparser -------------------------------
    method_p = subparsers.add_parser("method")
    method_p.add_argument('method', metavar='METHOD_NAME')
    method_p.add_argument('data', metavar='JSON_DATA', nargs='*',
                          help="You can pass ATTRS and CONDITION as json string.")
    method_p.add_argument('--extra', action="store_true")

    # ------------------------- Dump subparser -------------------------------
    dump_p = subparsers.add_parser("dump")

    dump_p.add_argument('keys', metavar='KEYS',
                        help="Dump data related to an Entity in the data model. "
                             "Keys should be provided in a comma separated list.\n"
                             "Example: "
                             "emh-client dump forms,resources,users backup.json")
    dump_p.add_argument('jsonfile', metavar='JSON_FILE')

    args = p.parse_args()

    if args.url:
        config.EMHUB_SERVER_URL = args.url
        os.environ['EMHUB_SERVER_URL'] = args.url

    if args.entity == 'user':
        process_users(args)

    elif args.entity == 'form':
        process_forms(args)

    elif args.entity == 'session':
        process_sessions(args)

    elif args.entity == 'booking':
        process_booking(args)

    elif args.entity == 'puck':
        process_pucks(args)

    elif args.entity == 'email':
        with open_client() as dc:
            result = dc.send_email(args.dst, args.subject, args.body)
            pprint(result)

    elif args.entity == 'entry':
        process_entries(args)

    elif args.entity == 'processing':
        process_processing(args)

    elif args.entity == 'method':
        print("method: ", args.method)
        n = len(args.data)
        attrs = {}
        cond = None
        if n:
            attrs = json.loads(args.data[0])
            if n > 1:
                cond = args.data[1]

        with open_client() as dc:
            r = dc.request(args.method,
                           jsonData={'attrs': attrs, 'condition': cond})
            result = r.json()

            if isinstance(result, list):
                for item in result:
                    if 'extra' in item and not args.extra:
                        del item['extra']
                    pprint(item)
            else:
                pprint(result)

    elif args.entity == 'dump':
        dump(args.keys, args.jsonfile)

    else:
        for k, v in os.environ.items():
            if k.startswith('EMHUB_'):
                print(f"export {k}={v}")


if __name__ == '__main__':
    main()
