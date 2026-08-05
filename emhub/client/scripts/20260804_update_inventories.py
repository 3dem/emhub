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
Replace all inventories from a grid-inventory CSV export.

The CSV is grouped into inventories as follows:

- Skip the header row (column names).
- A row with text only in the first column starts a new inventory when not
  already inside one (typically after a blank row), e.g. ``D1: GOLD Drawer 1``.
- If not inside an inventory yet, a row whose first column is non-empty starts
  a new inventory (using that column as the title) and is also parsed as the
  first item when other columns are filled (e.g. ``Misc to be filled``).
- Other non-empty rows (until a completely empty row) are items in the current
  inventory. While inside an inventory, a row with only the first column filled
  is treated as an item, not a new inventory title.
- Item title is built from: Grids Type, Support Layer, Foil type, Bar type,
  Hole size, Mesh Size (non-empty parts joined with ``", "``).
- Initial quantity comes from column ``total grids``.
- Description comes from column ``Location``.

Existing inventories are cleared first (all entries deleted, then all inventory
projects deleted), then recreated from the CSV.

Examples::

  python 20260804_update_inventories.py --csv grid_inventory.csv --dry-run
  python 20260804_update_inventories.py --csv grid_inventory.csv
  python 20260804_update_inventories.py --csv grid_inventory.csv --parse-only
"""

import argparse
import csv
import importlib.util
import os
import sys
from pathlib import Path

from emtools.utils import Pretty, Color

from emhub.client import open_client


TITLE_COLUMNS = (
    'Grids Type',
    'Support Layer',
    'Foil type',
    'Bar type',
    'Hole size',
    'Mesh Size',
)
QUANTITY_COLUMN = 'total grids'
DESCRIPTION_COLUMN = 'Location'

ITEM_TYPE = 'inventory_item'


def log(msg):
    print(f"{Pretty.now()}: {msg}", flush=True)


def _load_backup_module():
    path = Path(__file__).resolve().parent / '20260529_backup_inventories.py'
    spec = importlib.util.spec_from_file_location('backup_inventories', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _normalize_header(name):
    return (name or '').strip().casefold()


def _build_header_map(fieldnames):
    mapping = {}
    for name in fieldnames or []:
        key = _normalize_header(name)
        if key and key not in mapping:
            mapping[key] = name
    return mapping


def _cell(row, header_map, column):
    key = _normalize_header(column)
    field = header_map.get(key)
    if field is None:
        return ''
    return (row.get(field) or '').strip()


def _row_values(row, fieldnames):
    return [(row.get(name) or '').strip() for name in fieldnames]


def _is_empty_row(values):
    return all(not value for value in values)


def _is_first_column_only(values):
    return bool(values[0]) and all(not value for value in values[1:])


def _compose_item_title(row, header_map):
    parts = []
    for column in TITLE_COLUMNS:
        value = _cell(row, header_map, column)
        if value:
            parts.append(value)
    return ', '.join(parts)


def _parse_quantity(row, header_map, source_line):
    raw = _cell(row, header_map, QUANTITY_COLUMN)
    if not raw:
        return 0
    try:
        return int(float(raw))
    except ValueError as exc:
        raise ValueError(
            f'Line {source_line}: invalid {QUANTITY_COLUMN!r} value {raw!r}'
        ) from exc


def _item_spec_from_row(row, header_map, source_line):
    title = _compose_item_title(row, header_map)
    if not title:
        raise ValueError(f'Line {source_line}: item has empty title')

    quantity = _parse_quantity(row, header_map, source_line)
    description = _cell(row, header_map, DESCRIPTION_COLUMN)

    return {
        'type': ITEM_TYPE,
        'title': title,
        'description': description,
        'extra': {
            'data': {
                'quantity': str(quantity),
            },
        },
    }


def parse_inventories_csv(path):
    """Parse the grid inventory CSV into inventory blocks."""
    inventories = []
    current = None

    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError(f'CSV {path!r} has no header row')

        header_map = _build_header_map(reader.fieldnames)
        fieldnames = list(reader.fieldnames)

        for line_no, row in enumerate(reader, start=2):
            values = _row_values(row, fieldnames)

            if _is_empty_row(values):
                current = None
                continue

            if current is None:
                if not values[0]:
                    raise ValueError(
                        f'Line {line_no}: row has no inventory title or item data'
                    )
                current = {
                    'title': values[0],
                    'description': '',
                    'extra': {},
                    'items': [],
                }
                inventories.append(current)
                if _is_first_column_only(values):
                    continue

            current['items'].append(
                _item_spec_from_row(row, header_map, line_no)
            )

    if not inventories:
        raise ValueError(f'No inventories found in {path!r}')

    return inventories


def print_parsed_inventories(inventories):
    total_items = sum(len(inv['items']) for inv in inventories)
    log(Color.green(
        f'Parsed {len(inventories)} inventor(y/ies), {total_items} item(s).'
    ))
    for inv in inventories:
        log(f"  {inv['title']!r}: {len(inv['items'])} item(s)")
        for item in inv['items']:
            qty = item['extra']['data']['quantity']
            log(
                f"    - {item['title']!r} qty={qty} "
                f"desc={item['description']!r}"
            )


def update_inventories_from_csv(dc, path, dry_run=False):
    """Delete all inventories and recreate them from the CSV."""
    backup = _load_backup_module()
    inventories = parse_inventories_csv(path)

    log(Color.green(
        f'Loaded {len(inventories)} inventor(y/ies) from {path!r}'
    ))
    total_items = sum(len(inv['items']) for inv in inventories)
    log(f'Total items to create: {total_items}')

    backup.delete_entries_from_all_inventories(dc, dry_run=dry_run)
    backup.delete_all_inventory_projects(dc, dry_run=dry_run)

    log(Color.green(
        f'Create inventories and items from CSV ({len(inventories)})'
    ))
    for i, block in enumerate(inventories):
        log(Color.green(
            f'Inventory #{i + 1}/{len(inventories)} '
            f'title={block["title"]!r}: {len(block["items"])} item(s)'
        ))
        pid = backup.create_inventory_project(dc, block, dry_run=dry_run)
        if dry_run:
            backup.create_items(dc, 0, block['items'], dry_run=True)
            continue
        if pid is None:
            raise ValueError('create_project did not return a project id')
        backup.create_items(dc, pid, block['items'], dry_run=False)


def main():
    p = argparse.ArgumentParser(
        description=(
            'Delete all inventories and recreate them from a grid inventory CSV.'
        ),
    )
    p.add_argument(
        '--csv',
        metavar='PATH',
        required=True,
        help='Grid inventory CSV file to import',
    )
    p.add_argument(
        '--dry-run',
        action='store_true',
        help='Print actions without delete/create API calls',
    )
    p.add_argument(
        '--parse-only',
        action='store_true',
        help='Only parse and print the CSV (no API calls)',
    )

    args = p.parse_args()
    csv_path = os.path.expanduser(args.csv)

    if not os.path.isfile(csv_path):
        log(Color.red(f'CSV file not found: {csv_path!r}'))
        sys.exit(1)

    try:
        inventories = parse_inventories_csv(csv_path)
    except (ValueError, OSError, csv.Error) as e:
        log(Color.red(str(e)))
        sys.exit(1)

    if args.parse_only:
        print_parsed_inventories(inventories)
        return

    with open_client() as dc:
        try:
            update_inventories_from_csv(dc, csv_path, dry_run=args.dry_run)
        except (ValueError, OSError, csv.Error) as e:
            log(Color.red(str(e)))
            sys.exit(1)


if __name__ == '__main__':
    main()
