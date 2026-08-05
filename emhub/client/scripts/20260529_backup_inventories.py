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
List inventory projects (``status="special:inventory"``), save them (with all
items and add/remove operations) to a JSON file, or restore from such a file.

Backups do **not** include database project or entry ids (portable across
environments). ``inventory_add`` / ``inventory_remove`` entries store
``item_index`` (position in the ``items`` list) instead of ``data.item``.
Each inventory, item, and operation may include ``creation_user_id``;
restore passes it on ``create_project`` / ``create_entry``.

Item icon filenames in ``extra.data`` are backed up; image files on disk are
**not** embedded (copy entry files separately if needed).

Restore runs in order: (1) delete every entry on each inventory project,
(2) delete all inventory projects, (3) create inventories, items, then
operations (chronological) from the JSON.

Uses the REST API (same pattern as other ``emhub.client.scripts``).

Examples::

  python 20260529_backup_inventories.py --list
  python 20260529_backup_inventories.py --list --verbose
  python 20260529_backup_inventories.py --save inventories_backup.json
  python 20260529_backup_inventories.py --restore inventories_backup.json
  python 20260529_backup_inventories.py --restore inventories_backup.json --dry-run
"""

import argparse
import json
import sys

from emtools.utils import Pretty, Color

from emhub.client import open_client


INVENTORY_STATUS = 'special:inventory'
ITEM_TYPE = 'inventory_item'
OPERATION_TYPES = ('inventory_add', 'inventory_remove')

BACKUP_FORMAT = 'emhub_inventories_backup'
BACKUP_VERSION = 1

BACKUP_KEYS_REQUIRED = ('format', 'version', 'inventories')


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


def _operation_for_backup(entry, item_id_to_index):
    """Serialize an add/remove operation using ``item_index`` instead of item id."""
    out = _entry_for_backup(entry)
    data = dict((out.get('extra') or {}).get('data') or {})
    item_id = data.pop('item', None)
    if item_id in (None, ''):
        raise ValueError(f'Operation missing data.item: {entry!r}')
    item_id = int(item_id)
    if item_id not in item_id_to_index:
        raise ValueError(
            f'Operation id={entry.get("id")!r} references unknown item id {item_id}'
        )
    data['item_index'] = item_id_to_index[item_id]
    out['extra'] = {'data': data}
    return out


def _operation_create_attrs(spec, project_id, index_to_item_id):
    """Build create_entry attrs for an operation, remapping ``item_index`` → ``item``."""
    attrs = _entry_create_attrs(dict(spec), project_id)
    data = dict(attrs['extra'].get('data') or {})
    item_index = data.pop('item_index', None)
    if item_index in (None, ''):
        raise ValueError(f'Operation missing item_index: {spec!r}')
    item_index = int(item_index)
    if item_index not in index_to_item_id:
        raise ValueError(
            f'Operation references unknown item_index {item_index} '
            f'(have {len(index_to_item_id)} item(s))'
        )
    data['item'] = index_to_item_id[item_index]
    attrs['extra']['data'] = data
    return attrs


def get_inventory_projects(dc):
    """Return all ``special:inventory`` projects (sorted by id), no printing."""
    r = dc.request(
        'get_projects',
        jsonData={'condition': f'status="{INVENTORY_STATUS}"'},
    )
    inventories = r.json()
    inventories.sort(key=lambda x: x.get('id') or 0)
    return inventories


def _get_project_entries(dc, project_id):
    r = dc.request(
        'get_entries',
        jsonData={'condition': f'project_id={int(project_id)}'},
    )
    return r.json()


def _partition_inventory_entries(entries):
    """Split entries into items and operations; warn on unexpected types."""
    items = []
    operations = []
    other = []
    for e in entries:
        etype = e.get('type')
        if etype == ITEM_TYPE:
            items.append(e)
        elif etype in OPERATION_TYPES:
            operations.append(e)
        else:
            other.append(e)
    items.sort(key=lambda x: x.get('id') or 0)
    operations.sort(key=lambda x: (x.get('date') or '', x.get('id') or 0))
    return items, operations, other


def list_inventories(dc, verbose=False):
    inventories = get_inventory_projects(dc)
    log(Color.green(f'Found {len(inventories)} inventor(y/ies).'))
    for inv in inventories:
        line = (
            f"  id={inv['id']!r} title={inv.get('title', '')!r} "
            f"user_id={inv.get('user_id')}"
        )
        if verbose:
            entries = _get_project_entries(dc, inv['id'])
            items, operations, other = _partition_inventory_entries(entries)
            line += (
                f" items={len(items)} operations={len(operations)}"
                f" other_entries={len(other)}"
            )
        log(line)
    return inventories


def delete_all_entries(dc, project_id, dry_run=False):
    """Remove all entries for a single project (by ``project_id``)."""
    entries = _get_project_entries(dc, project_id)
    log(f'Project {project_id}: deleting {len(entries)} existing entr(y/ies).')
    if dry_run:
        for e in entries:
            log(f'  [dry-run] would delete_entry id={e["id"]} type={e.get("type")!r}')
        return
    for e in entries:
        dc.request('delete_entry', jsonData={'attrs': {'id': e['id']}})
        log(f'  deleted entry id={e["id"]} type={e.get("type")!r}')


def delete_entries_from_all_inventories(dc, dry_run=False):
    """Step 1 of restore: remove all entries from every inventory project."""
    invs = list(get_inventory_projects(dc))
    log(Color.red(
        f'(1) Remove all entries from inventories ({len(invs)} project(s)).'
    ))
    if dry_run:
        for inv in invs:
            entries = _get_project_entries(dc, inv['id'])
            log(
                f'  [dry-run] would delete {len(entries)} entr(y/ies) on '
                f'inventory id={inv["id"]} title={inv.get("title", "")!r}'
            )
        return
    for inv in invs:
        delete_all_entries(dc, inv['id'], dry_run=False)


def create_entry(dc, attrs, dry_run=False, label='entry'):
    if dry_run:
        cuid = attrs.get('creation_user_id')
        suffix = f' creation_user_id={cuid}' if cuid is not None else ''
        log(
            f'  [dry-run] would create_{label}: '
            f'{attrs.get("type")!r} title={attrs.get("title")!r}{suffix}'
        )
        return None
    cr = dc.request('create_entry', jsonData={'attrs': attrs})
    body = cr.json()
    ent = body.get('entry', body)
    eid = ent.get('id') if isinstance(ent, dict) else None
    log(f'  created {label} id={eid} type={attrs.get("type")!r}')
    return eid


def create_items(dc, project_id, item_specs, dry_run=False):
    """Create inventory items; return ``{index: new_entry_id}``."""
    index_to_item_id = {}
    for i, spec in enumerate(item_specs):
        attrs = _entry_create_attrs(dict(spec), project_id)
        if dry_run:
            create_entry(dc, attrs, dry_run=True, label='item')
            continue
        eid = create_entry(dc, attrs, dry_run=False, label='item')
        if eid is None:
            raise ValueError(f'create_entry did not return an id for item #{i + 1}')
        index_to_item_id[i] = eid
    return index_to_item_id


def create_operations(dc, project_id, operation_specs, index_to_item_id, dry_run=False):
    for i, spec in enumerate(operation_specs):
        attrs = _operation_create_attrs(dict(spec), project_id, index_to_item_id)
        if dry_run:
            item_idx = (spec.get('extra') or {}).get('data', {}).get('item_index')
            log(
                f'  [dry-run] would create_operation #{i + 1}: '
                f'{attrs.get("type")!r} item_index={item_idx!r}'
            )
            continue
        create_entry(dc, attrs, dry_run=False, label='operation')


def delete_all_inventory_projects(dc, dry_run=False):
    """Step 2 of restore: remove every project with status ``special:inventory``."""
    invs = list(get_inventory_projects(dc))
    log(Color.red(f'(2) Remove all inventory projects ({len(invs)}).'))
    if dry_run:
        for inv in invs:
            log(
                f'  [dry-run] would delete_project id={inv["id"]} '
                f'title={inv.get("title", "")!r}'
            )
        return
    for inv in invs:
        dc.request('delete_project', jsonData={'attrs': {'id': inv['id']}})
        log(f'  deleted inventory project id={inv["id"]}')


def _project_attrs_for_create(block):
    """Attrs for ``create_project`` from one backup block (no project id)."""
    if not isinstance(block, dict):
        raise ValueError('Each inventory must be a JSON object')
    title = (block.get('title') or '').strip() or 'Inventory'
    attrs = {
        'status': INVENTORY_STATUS,
        'title': title,
        'description': block.get('description') if block.get('description') is not None else '',
        'extra': dict(block.get('extra') or {}),
        'validate': False,
    }
    if block.get('user_id') is not None:
        attrs['user_id'] = int(block['user_id'])
    if block.get('creation_user_id') is not None:
        attrs['creation_user_id'] = int(block['creation_user_id'])
    return attrs


def create_inventory_project(dc, block, dry_run=False):
    """Create one inventory project from a backup block; return new project id or None."""
    attrs = _project_attrs_for_create(block)
    if dry_run:
        cuid = attrs.get('creation_user_id')
        suffix = f' creation_user_id={cuid}' if cuid is not None else ''
        log(f'  [dry-run] would create_project title={attrs["title"]!r}{suffix}')
        return None
    r = dc.request('create_project', jsonData={'attrs': attrs})
    body = r.json()
    proj = body.get('project', body)
    if not isinstance(proj, dict) or 'id' not in proj:
        raise ValueError(f'Unexpected create_project response: {body!r}')
    pid = proj['id']
    log(f'  created inventory project id={pid} title={attrs["title"]!r}')
    return pid


def build_inventories_backup(dc):
    """Collect all inventory projects, items, and operations into a serializable dict."""
    inventories = get_inventory_projects(dc)
    log(Color.green(
        f'Collecting {len(inventories)} inventor(y/ies) and their entries...'
    ))
    blocks = []
    for inv in inventories:
        raw_entries = _get_project_entries(dc, inv['id'])
        items_raw, operations_raw, other = _partition_inventory_entries(raw_entries)
        if other:
            log(Color.red(
                f'  warning: skipping {len(other)} non-inventory entr(y/ies) on '
                f'title={inv.get("title", "")!r}: '
                f'{sorted({e.get("type") for e in other})}'
            ))
        items = [_entry_for_backup(e) for e in items_raw]
        item_id_to_index = {e['id']: i for i, e in enumerate(items_raw)}
        operations = [
            _operation_for_backup(e, item_id_to_index) for e in operations_raw
        ]
        blocks.append({
            'title': inv.get('title'),
            'description': inv.get('description'),
            'extra': inv.get('extra') or {},
            'user_id': inv.get('user_id'),
            'creation_user_id': inv.get('creation_user_id'),
            'items': items,
            'operations': operations,
        })
        log(
            f"  snapshot title={inv.get('title', '')!r} "
            f"items={len(items)} operations={len(operations)}"
        )
    return {
        'format': BACKUP_FORMAT,
        'version': BACKUP_VERSION,
        'inventories': blocks,
    }


def save_inventories_json(dc, path, indent=2):
    """Write inventory projects and entries to ``path`` as JSON (no ids)."""
    log(Color.green(f'Building backup → {path!r}'))
    payload = build_inventories_backup(dc)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=indent, ensure_ascii=False, default=str)
    n = len(payload['inventories'])
    total_items = sum(len(b['items']) for b in payload['inventories'])
    total_ops = sum(len(b['operations']) for b in payload['inventories'])
    log(Color.green(
        f'Wrote {n} inventor(y/ies), {total_items} item(s), '
        f'{total_ops} operation(s) total.'
    ))


def restore_inventories_from_json(dc, path, dry_run=False):
    """Clear inventory entries, delete inventory projects, recreate from backup."""
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
    if ver != BACKUP_VERSION:
        raise ValueError(
            f'Unsupported backup version {data["version"]!r} '
            f'(expected {BACKUP_VERSION})'
        )

    inventories = data['inventories']
    if not isinstance(inventories, list):
        raise ValueError('"inventories" must be a list')

    log(Color.green(
        f'Restoring from {path!r} ({len(inventories)} inventor(y/ies) in file)'
    ))
    delete_entries_from_all_inventories(dc, dry_run=dry_run)
    delete_all_inventory_projects(dc, dry_run=dry_run)

    log(Color.green(
        f'(3) Create inventories, items, and operations from backup '
        f'({len(inventories)})'
    ))
    for i, block in enumerate(inventories):
        if not isinstance(block, dict):
            raise ValueError(f'inventories[{i}] must be an object')
        item_specs = block.get('items') or []
        operation_specs = block.get('operations') or []
        if not isinstance(item_specs, list):
            raise ValueError(f'inventories[{i}].items must be a list')
        if not isinstance(operation_specs, list):
            raise ValueError(f'inventories[{i}].operations must be a list')

        log(Color.green(
            f'Inventory #{i + 1}/{len(inventories)} '
            f'title={(block.get("title") or "")!r}: '
            f'{len(item_specs)} item(s), {len(operation_specs)} operation(s)'
        ))
        pid = create_inventory_project(dc, block, dry_run=dry_run)
        if dry_run:
            create_items(dc, 0, item_specs, dry_run=True)
            create_operations(dc, 0, operation_specs, {}, dry_run=True)
            continue
        if pid is None:
            raise ValueError('create_project did not return a project id')
        index_to_item_id = create_items(dc, pid, item_specs, dry_run=False)
        create_operations(
            dc, pid, operation_specs, index_to_item_id, dry_run=False,
        )


def main():
    p = argparse.ArgumentParser(
        description=(
            'List inventories, save them to JSON, or restore '
            '(clear entries, delete inventories, import).'
        ),
    )
    p.add_argument(
        '--list',
        action='store_true',
        help='List projects with status special:inventory',
    )
    p.add_argument(
        '--verbose',
        action='store_true',
        help='With --list, include per-inventory item and operation counts',
    )
    p.add_argument(
        '--save',
        metavar='PATH',
        default=None,
        help='Write all inventories and their entries to this JSON file (no ids)',
    )
    p.add_argument(
        '--restore',
        metavar='PATH',
        default=None,
        help=(
            'Clear all inventory entries, delete inventory projects, '
            'then recreate from this JSON file'
        ),
    )
    p.add_argument(
        '--dry-run',
        action='store_true',
        help='With --restore, print actions without delete/create API calls',
    )

    args = p.parse_args()

    if not args.list and args.save is None and args.restore is None:
        p.error('Specify --list and/or --save PATH and/or --restore PATH')

    if args.dry_run and args.restore is None:
        p.error('--dry-run only applies with --restore')

    with open_client() as dc:
        if args.list:
            list_inventories(dc, verbose=args.verbose)

        if args.save is not None:
            save_inventories_json(dc, args.save)

        if args.restore is not None:
            try:
                restore_inventories_from_json(dc, args.restore, dry_run=args.dry_run)
            except (ValueError, OSError, json.JSONDecodeError) as e:
                log(Color.red(str(e)))
                sys.exit(1)


if __name__ == '__main__':
    main()
