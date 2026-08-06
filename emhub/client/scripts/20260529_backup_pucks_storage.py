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
List pucks (with gridbox usage), save them to a JSON file, or restore from such
a file.

Gridboxes are stored in each puck's ``extra.gridboxes`` and are included in the
backup. Backups do **not** include database puck ids (portable across
environments).

Restore runs in order: (1) delete every existing puck, (2) create pucks from
the JSON (including ``extra`` with gridboxes).

Uses the REST API (same pattern as other ``emhub.client.scripts``).

Examples::

  python 20260529_backup_pucks_storage.py --list
  python 20260529_backup_pucks_storage.py --list --verbose
  python 20260529_backup_pucks_storage.py --save pucks_backup.json
  python 20260529_backup_pucks_storage.py --restore pucks_backup.json
  python 20260529_backup_pucks_storage.py --restore pucks_backup.json --dry-run
"""

import argparse
import json
import sys

from emtools.utils import Pretty, Color

from emhub.client import open_client


BACKUP_FORMAT = 'emhub_pucks_storage_backup'
BACKUP_VERSION = 1

BACKUP_KEYS_REQUIRED = ('format', 'version', 'pucks')

PUCK_BACKUP_FIELDS = (
    'code', 'label', 'color', 'dewar', 'cane', 'position', 'extra',
)


def log(msg):
    print(f"{Pretty.now()}: {msg}", flush=True)


def _puck_sort_key(puck):
    return (
        puck.get('dewar') or 0,
        puck.get('cane') or 0,
        puck.get('position') or 0,
        puck.get('label') or '',
    )


def _gridbox_count(puck):
    extra = puck.get('extra') or {}
    gridboxes = extra.get('gridboxes') or {}
    if not isinstance(gridboxes, dict):
        return 0
    return len(gridboxes)


def _max_gridboxes(puck):
    extra = puck.get('extra') or {}
    try:
        return int(extra.get('max_gridboxes', 12))
    except (TypeError, ValueError):
        return 12


def get_pucks(dc):
    """Return all pucks (sorted by location), no printing."""
    r = dc.request('get_pucks', jsonData={})
    pucks = r.json()
    pucks.sort(key=_puck_sort_key)
    return pucks


def list_pucks(dc, verbose=False):
    pucks = get_pucks(dc)
    log(Color.green(f'Found {len(pucks)} puck(s).'))
    for puck in pucks:
        used = _gridbox_count(puck)
        max_gb = _max_gridboxes(puck)
        line = (
            f"  id={puck['id']!r} label={puck.get('label', '')!r} "
            f"D{puck.get('dewar')}C{puck.get('cane')}P{puck.get('position')} "
            f"gridboxes={used}/{max_gb}"
        )
        if verbose:
            extra = puck.get('extra') or {}
            gridboxes = extra.get('gridboxes') or {}
            if isinstance(gridboxes, dict) and gridboxes:
                slots = ', '.join(str(k) for k in sorted(gridboxes, key=str))
                line += f" slots=[{slots}]"
        log(line)
    return pucks


def _puck_for_backup(puck):
    """Keep only fields needed to recreate a puck via the API (no id)."""
    if not isinstance(puck, dict):
        raise ValueError('Each puck must be a JSON object')
    out = {k: puck[k] for k in PUCK_BACKUP_FIELDS if k in puck}
    if 'label' not in out:
        raise ValueError(f'Puck missing label: {puck!r}')
    extra = out.get('extra')
    if extra is None:
        out['extra'] = {}
    elif not isinstance(extra, dict):
        raise ValueError('"extra" must be an object')
    return out


def _puck_attrs_for_create(block):
    """Attrs for ``create_puck`` from one backup block (no puck id)."""
    if not isinstance(block, dict):
        raise ValueError('Each puck must be a JSON object')
    attrs = {k: block[k] for k in PUCK_BACKUP_FIELDS if k in block}
    if 'label' not in attrs:
        raise ValueError('Each puck must include "label"')
    extra = attrs.get('extra')
    if extra is None:
        extra = {}
    if not isinstance(extra, dict):
        raise ValueError('"extra" must be an object')
    attrs['extra'] = extra
    return attrs


def build_pucks_backup(dc):
    """Collect all pucks (including gridboxes in extra) into a serializable dict."""
    pucks = get_pucks(dc)
    log(Color.green(f'Collecting {len(pucks)} puck(s)...'))
    blocks = []
    total_gb = 0
    for puck in pucks:
        block = _puck_for_backup(puck)
        n_gb = _gridbox_count(block)
        total_gb += n_gb
        blocks.append(block)
        log(
            f"  snapshot label={block.get('label', '')!r} "
            f"D{block.get('dewar')}C{block.get('cane')}P{block.get('position')} "
            f"gridboxes={n_gb}"
        )
    return {
        'format': BACKUP_FORMAT,
        'version': BACKUP_VERSION,
        'pucks': blocks,
    }


def save_pucks_json(dc, path, indent=2):
    """Write all pucks (with gridboxes) to ``path`` as JSON (no puck ids)."""
    log(Color.green(f'Building backup → {path!r}'))
    payload = build_pucks_backup(dc)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=indent, ensure_ascii=False, default=str)
    n = len(payload['pucks'])
    total_gb = sum(_gridbox_count(p) for p in payload['pucks'])
    log(Color.green(
        f'Wrote {n} puck(s), {total_gb} gridbox(es) total.'
    ))


def delete_all_pucks(dc, dry_run=False):
    """Step 1 of restore: remove every puck."""
    pucks = list(get_pucks(dc))
    log(Color.red(f'(1) Remove all pucks ({len(pucks)}).'))
    if dry_run:
        for puck in pucks:
            log(
                f'  [dry-run] would delete_puck id={puck["id"]} '
                f'label={puck.get("label", "")!r}'
            )
        return
    for puck in pucks:
        dc.request('delete_puck', jsonData={'attrs': {'id': puck['id']}})
        log(f'  deleted puck id={puck["id"]} label={puck.get("label", "")!r}')


def create_puck_from_block(dc, block, dry_run=False):
    """Create one puck from a backup block; return new puck id or None."""
    attrs = _puck_attrs_for_create(block)
    n_gb = _gridbox_count(block)
    if dry_run:
        log(
            f'  [dry-run] would create_puck label={attrs["label"]!r} '
            f'D{attrs.get("dewar")}C{attrs.get("cane")}P{attrs.get("position")} '
            f'gridboxes={n_gb}'
        )
        return None
    r = dc.request('create_puck', jsonData={'attrs': attrs})
    body = r.json()
    if 'error' in body:
        raise ValueError(
            f'create_puck failed for label={attrs["label"]!r}: {body["error"]}'
        )
    puck = body.get('puck', body)
    if not isinstance(puck, dict) or 'id' not in puck:
        raise ValueError(f'Unexpected create_puck response: {body!r}')
    pid = puck['id']
    log(
        f'  created puck id={pid} label={attrs["label"]!r} '
        f'gridboxes={n_gb}'
    )
    return pid


def _load_backup(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if isinstance(data, list):
        log(Color.red(
            'Warning: legacy backup (bare JSON array); puck ids in file are ignored.'
        ))
        pucks = data
        for i, block in enumerate(pucks):
            if not isinstance(block, dict):
                raise ValueError(f'pucks[{i}] must be an object')
        return pucks

    if not isinstance(data, dict):
        raise ValueError('Backup root must be a JSON object or array')

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

    pucks = data['pucks']
    if not isinstance(pucks, list):
        raise ValueError('"pucks" must be a list')
    return pucks


def restore_pucks_from_json(dc, path, dry_run=False):
    """Delete all pucks, then recreate storage from backup (no ids)."""
    pucks = _load_backup(path)

    log(Color.green(
        f'Restoring from {path!r} ({len(pucks)} puck(s) in file)'
    ))
    delete_all_pucks(dc, dry_run=dry_run)

    log(Color.green(f'(2) Create pucks from backup ({len(pucks)})'))
    for i, block in enumerate(pucks):
        if not isinstance(block, dict):
            raise ValueError(f'pucks[{i}] must be an object')
        log(Color.green(
            f'Puck #{i + 1}/{len(pucks)} label={(block.get("label") or "")!r}: '
            f'{_gridbox_count(block)} gridbox(es)'
        ))
        create_puck_from_block(dc, block, dry_run=dry_run)


def main():
    p = argparse.ArgumentParser(
        description='List pucks, save storage (with gridboxes) to JSON, or restore (delete all, import).',
    )
    p.add_argument(
        '--list',
        action='store_true',
        help='List all pucks with gridbox usage',
    )
    p.add_argument(
        '--verbose',
        action='store_true',
        help='With --list, show occupied gridbox slot numbers',
    )
    p.add_argument(
        '--save',
        metavar='PATH',
        default=None,
        help='Write all pucks (including extra.gridboxes) to this JSON file (no puck ids)',
    )
    p.add_argument(
        '--restore',
        metavar='PATH',
        default=None,
        help='Delete all pucks, then recreate storage from this JSON file',
    )
    p.add_argument(
        '--dry-run',
        action='store_true',
        help='With --restore, print actions without delete_puck / create_puck',
    )

    args = p.parse_args()

    if not args.list and args.save is None and args.restore is None:
        p.error('Specify --list and/or --save PATH and/or --restore PATH')

    if args.dry_run and args.restore is None:
        p.error('--dry-run only applies with --restore')

    with open_client() as dc:
        if args.list:
            list_pucks(dc, verbose=args.verbose)

        if args.save is not None:
            save_pucks_json(dc, args.save)

        if args.restore is not None:
            try:
                restore_pucks_from_json(dc, args.restore, dry_run=args.dry_run)
            except (ValueError, OSError, json.JSONDecodeError) as e:
                log(Color.red(str(e)))
                sys.exit(1)


if __name__ == '__main__':
    main()
