#!/usr/bin/env python
# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin
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
# *  e-mail address 'delarosatrevin@gmail.com'
# *
# **************************************************************************

"""
List logbook projects (``status="special:logbook"``), save them (with all
entries) to a JSON file, or restore from such a file.

Backups do **not** include database project ids (portable across environments).
Each logbook and entry may include ``creation_user_id`` (backup version 3+);
restore passes it on ``create_project`` / ``create_entry`` (managers may set
another user; invalid or non-manager override falls back to the API user).

Restore runs in order: (1) delete every entry on each logbook project,
(2) delete all logbook projects, (3) create logbooks and entries from the JSON.

Uses the REST API (same pattern as other ``emhub.client.scripts``).

Examples::

  python 20260512_update_logbook_entries.py --list
  python 20260512_update_logbook_entries.py --list --verbose
  python 20260512_update_logbook_entries.py --save logbooks_backup.json
  python 20260512_update_logbook_entries.py --restore logbooks_backup.json
  python 20260512_update_logbook_entries.py --restore logbooks_backup.json --dry-run
"""

import argparse
import json
import sys

from emtools.utils import Pretty, Color

from emhub.client import open_client


BACKUP_FORMAT = 'emhub_logbooks_backup'
BACKUP_VERSION = 3

BACKUP_KEYS_REQUIRED = ('format', 'version', 'logbooks')


def log(msg):
    print(f"{Pretty.now()}: {msg}", flush=True)


def _entry_create_attrs(spec, project_id):
    """Build ``attrs`` for ``create_entry`` from one stored entry dict."""
    if not isinstance(spec, dict):
        raise ValueError('Each entry must be a JSON object')
    row = {k: spec[k] for k in ('type', 'title', 'description', 'date', 'extra',
                                'creation_user_id')
           if k in spec}

    if 'creation_user_id' in row:
        row['creation_user_id'] = int(row['creation_user_id'])

    if 'desc' in spec and 'description' not in row:
        row['description'] = spec['desc']

    if 'type' not in row:
        raise ValueError('Each entry must include "type"')

    extra = row.pop('extra', None)
    if extra is None:
        extra = {}
    if not isinstance(extra, dict):
        raise ValueError('"extra" must be an object')
    data = extra.get('data')
    if data is None:
        extra['data'] = {}
    elif not isinstance(data, dict):
        raise ValueError('"extra.data" must be an object when present')

    row['project_id'] = project_id
    row['extra'] = extra

    if 'title' not in row:
        row['title'] = ''
    if 'description' not in row:
        row['description'] = ''

    return row


def _entry_for_backup(entry):
    """Keep only fields needed to recreate an entry via the API."""
    out = {}
    for k in ('type', 'title', 'description', 'date', 'extra', 'creation_user_id'):
        if k in entry:
            out[k] = entry[k]
    if 'type' not in out:
        raise ValueError(f'Entry missing type: {entry!r}')
    extra = out.get('extra')
    if extra is None:
        out['extra'] = {'data': {}}
    elif isinstance(extra, dict) and 'data' not in extra:
        extra = dict(extra)
        extra['data'] = {}
        out['extra'] = extra
    return out


def get_logbook_projects(dc):
    """Return all ``special:logbook`` projects (sorted by id), no printing."""
    r = dc.request(
        'get_projects',
        jsonData={'condition': 'status="special:logbook"'},
    )
    logbooks = r.json()
    logbooks.sort(key=lambda x: x.get('id') or 0)
    return logbooks


def list_logbooks(dc, verbose=False):
    logbooks = get_logbook_projects(dc)
    log(Color.green(f'Found {len(logbooks)} logbook(s).'))
    for lb in logbooks:
        rid = (lb.get('extra') or {}).get('resource_id', '')
        line = (
            f"  id={lb['id']!r} title={lb.get('title', '')!r} "
            f"resource_id={rid!r} user_id={lb.get('user_id')}"
        )
        if verbose:
            er = dc.request(
                'get_entries',
                jsonData={'condition': f"project_id={lb['id']}"},
            )
            ents = er.json()
            line += f" entries={len(ents)}"
        log(line)
    return logbooks


def delete_all_entries(dc, project_id, dry_run=False):
    """Remove all entries for a single project (by ``project_id``)."""
    r = dc.request(
        'get_entries',
        jsonData={'condition': f'project_id={int(project_id)}'},
    )
    entries = r.json()
    log(f'Project {project_id}: deleting {len(entries)} existing entr(y/ies).')
    if dry_run:
        for e in entries:
            log(f'  [dry-run] would delete_entry id={e["id"]}')
        return
    for e in entries:
        dc.request('delete_entry', jsonData={'attrs': {'id': e['id']}})
        log(f'  deleted entry id={e["id"]}')


def delete_entries_from_all_logbooks(dc, dry_run=False):
    """Step 1 of restore: remove all entries from every ``special:logbook`` project."""
    lbs = list(get_logbook_projects(dc))
    log(Color.red(
        f'(1) Remove all entries from logbooks ({len(lbs)} project(s)).'
    ))
    if dry_run:
        for lb in lbs:
            r = dc.request(
                'get_entries',
                jsonData={'condition': f"project_id={lb['id']}"},
            )
            n = len(r.json())
            log(
                f'  [dry-run] would delete {n} entr(y/ies) on '
                f'logbook id={lb["id"]} title={lb.get("title", "")!r}'
            )
        return
    for lb in lbs:
        delete_all_entries(dc, lb['id'], dry_run=False)


def create_entries(dc, project_id, entries_specs, dry_run=False):
    for i, spec in enumerate(entries_specs):
        attrs = _entry_create_attrs(dict(spec), project_id)
        if dry_run:
            cuid = attrs.get('creation_user_id')
            suffix = f' creation_user_id={cuid}' if cuid is not None else ''
            log(
                f'  [dry-run] would create_entry #{i + 1}: '
                f'{attrs.get("type")!r} title={attrs.get("title")!r}{suffix}'
            )
            continue
        cr = dc.request('create_entry', jsonData={'attrs': attrs})
        body = cr.json()
        ent = body.get('entry', body)
        eid = ent.get('id') if isinstance(ent, dict) else None
        log(f'  created entry id={eid} type={attrs.get("type")!r}')


def delete_all_logbook_projects(dc, dry_run=False):
    """Step 2 of restore: remove every project with status ``special:logbook``."""
    lbs = list(get_logbook_projects(dc))
    log(Color.red(f'(2) Remove all logbook projects ({len(lbs)}).'))
    if dry_run:
        for lb in lbs:
            log(f'  [dry-run] would delete_project id={lb["id"]} title={lb.get("title", "")!r}')
        return
    for lb in lbs:
        dc.request('delete_project', jsonData={'attrs': {'id': lb['id']}})
        log(f'  deleted logbook project id={lb["id"]}')


def _project_attrs_for_create(block):
    """Attrs for ``create_project`` from one backup block (no project id)."""
    if not isinstance(block, dict):
        raise ValueError('Each logbook must be a JSON object')
    extra = dict(block.get('extra') or {})
    if 'entries_menu' not in extra:
        extra['entries_menu'] = []
    title = (block.get('title') or '').strip() or 'Logbook'
    attrs = {
        'status': 'special:logbook',
        'title': title,
        'description': block.get('description') if block.get('description') is not None else '',
        'extra': extra,
        'validate': False,
    }
    if block.get('user_id') is not None:
        attrs['user_id'] = int(block['user_id'])
    if block.get('creation_user_id') is not None:
        attrs['creation_user_id'] = int(block['creation_user_id'])
    return attrs


def create_logbook_project(dc, block, dry_run=False):
    """Create one logbook project from a backup block; return new project id or None."""
    attrs = _project_attrs_for_create(block)
    if dry_run:
        cuid = attrs.get('creation_user_id')
        suffix = f' creation_user_id={cuid}' if cuid is not None else ''
        log(
            f'  [dry-run] would create_project title={attrs["title"]!r} '
            f'entries_menu_len={len(attrs["extra"].get("entries_menu") or [])}{suffix}'
        )
        return None
    r = dc.request('create_project', jsonData={'attrs': attrs})
    body = r.json()
    proj = body.get('project', body)
    if not isinstance(proj, dict) or 'id' not in proj:
        raise ValueError(f'Unexpected create_project response: {body!r}')
    pid = proj['id']
    log(f'  created logbook project id={pid} title={attrs["title"]!r}')
    return pid


def build_logbooks_backup(dc):
    """Collect all logbook projects and their entries into a serializable dict."""
    logbooks = get_logbook_projects(dc)
    log(Color.green(f'Collecting {len(logbooks)} logbook(s) and their entries...'))
    blocks = []
    for lb in logbooks:
        er = dc.request(
            'get_entries',
            jsonData={'condition': f"project_id={lb['id']}"},
        )
        raw_entries = er.json()
        entries = [_entry_for_backup(e) for e in raw_entries]
        blocks.append({
            'title': lb.get('title'),
            'description': lb.get('description'),
            'extra': lb.get('extra') or {},
            'user_id': lb.get('user_id'),
            'creation_user_id': lb.get('creation_user_id'),
            'entries': entries,
        })
        log(
            f"  snapshot title={lb.get('title', '')!r} "
            f"entries={len(entries)}"
        )
    return {
        'format': BACKUP_FORMAT,
        'version': BACKUP_VERSION,
        'logbooks': blocks,
    }


def save_logbooks_json(dc, path, indent=2):
    """Write logbook projects and entries to ``path`` as JSON (no project ids)."""
    log(Color.green(f'Building backup → {path!r}'))
    payload = build_logbooks_backup(dc)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=indent, ensure_ascii=False, default=str)
    n = len(payload['logbooks'])
    total_e = sum(len(b['entries']) for b in payload['logbooks'])
    log(Color.green(f'Wrote {n} logbook(s), {total_e} entr(y/ies) total.'))


def restore_logbooks_from_json(dc, path, dry_run=False):
    """Clear logbook entries, delete logbook projects, recreate from backup (no ids)."""
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError('Backup root must be a JSON object')
    for k in BACKUP_KEYS_REQUIRED:
        if k not in data:
            raise ValueError(f'Backup missing key {k!r}')
    if data['format'] != BACKUP_FORMAT:
        raise ValueError(
            f'Unexpected format {data["format"]!r} (expected {BACKUP_FORMAT!r})'
        )
    ver = int(data['version'])
    if ver not in (1, 2, 3):
        raise ValueError(
            f'Unsupported backup version {data["version"]!r} '
            f'(expected 1, 2, or 3)'
        )
    if ver < BACKUP_VERSION:
        log(Color.red(
            f'Warning: backup version is {ver} (current export is {BACKUP_VERSION}); '
            f'creation_user_id may be missing; v1 project ids are ignored on restore.'
        ))

    logbooks = data['logbooks']
    if not isinstance(logbooks, list):
        raise ValueError('"logbooks" must be a list')

    log(Color.green(
        f'Restoring from {path!r} ({len(logbooks)} logbook(s) in file)'
    ))
    delete_entries_from_all_logbooks(dc, dry_run=dry_run)
    delete_all_logbook_projects(dc, dry_run=dry_run)

    log(Color.green(f'(3) Create logbooks and entries from backup ({len(logbooks)})'))
    for i, block in enumerate(logbooks):
        if not isinstance(block, dict):
            raise ValueError(f'logbooks[{i}] must be an object')
        specs = block.get('entries') or []
        if not isinstance(specs, list):
            raise ValueError(f'logbooks[{i}].entries must be a list')

        log(Color.green(
            f'Logbook #{i + 1}/{len(logbooks)} title={(block.get("title") or "")!r}: '
            f'{len(specs)} entr(y/ies)'
        ))
        pid = create_logbook_project(dc, block, dry_run=dry_run)
        if pid is not None:
            create_entries(dc, pid, specs, dry_run=False)
        elif dry_run:
            create_entries(dc, 0, specs, dry_run=True)


def main():
    p = argparse.ArgumentParser(
        description='List logbooks, save them to JSON, or restore (clear entries, delete logbooks, import).',
    )
    p.add_argument(
        '--list',
        action='store_true',
        help='List projects with status special:logbook',
    )
    p.add_argument(
        '--verbose',
        action='store_true',
        help='With --list, include per-logbook entry counts (extra API calls)',
    )
    p.add_argument(
        '--save',
        metavar='PATH',
        default=None,
        help='Write all logbooks and their entries to this JSON file (no project ids)',
    )
    p.add_argument(
        '--restore',
        metavar='PATH',
        default=None,
        help='Clear all logbook entries, delete logbook projects, then recreate from this JSON file',
    )
    p.add_argument(
        '--dry-run',
        action='store_true',
        help='With --restore, print actions without delete_entry / delete_project / '
        'create_project / create_entry',
    )

    args = p.parse_args()

    if not args.list and args.save is None and args.restore is None:
        p.error('Specify --list and/or --save PATH and/or --restore PATH')

    if args.dry_run and args.restore is None:
        p.error('--dry-run only applies with --restore')

    with open_client() as dc:
        if args.list:
            list_logbooks(dc, verbose=args.verbose)

        if args.save is not None:
            save_logbooks_json(dc, args.save)

        if args.restore is not None:
            try:
                restore_logbooks_from_json(dc, args.restore, dry_run=args.dry_run)
            except (ValueError, OSError, json.JSONDecodeError) as e:
                log(Color.red(str(e)))
                sys.exit(1)


if __name__ == '__main__':
    main()
