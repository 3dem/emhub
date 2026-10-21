# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (josemiguel.delarosatrevin@stjude.org)
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
# **************************************************************************

import unittest

import sqlalchemy
from sqlalchemy import Column, Integer, String, Table, MetaData

from emhub.utils import parse_int_range
from emhub.data.data_manager import DataManager, SqlFilterError

parse_condition = DataManager.parse_condition
parse_order_by = DataManager.parse_order_by


def _sql(clause):
    return str(clause)


def _params(clause):
    return clause.compile().params


class TestParseCondition(unittest.TestCase):
    def test_empty(self):
        for c in [None, '', '   ']:
            self.assertIsNone(parse_condition(c))

    def test_valid(self):
        cases = [
            ('id=5', 'id = :p0', {'p0': 5}),
            ('id==5', 'id = :p0', {'p0': 5}),
            ('status="active"', 'status = :p0', {'p0': 'active'}),
            ("type='tomo_processing'", 'type = :p0',
             {'p0': 'tomo_processing'}),
            ("project_id=3 and type='tomo_processing'",
             'project_id = :p0 AND type = :p1',
             {'p0': 3, 'p1': 'tomo_processing'}),
            ('id>=1 AND id<=999', 'id >= :p0 AND id <= :p1',
             {'p0': 1, 'p1': 999}),
            ('status="special:news"', 'status = :p0',
             {'p0': 'special:news'}),
            ('x != -1.5', 'x != :p0', {'p0': -1.5}),
            ('x <> 2', 'x != :p0', {'p0': 2}),
            ('owner_id IN (1, 2,3)', 'owner_id IN (:p0, :p1, :p2)',
             {'p0': 1, 'p1': 2, 'p2': 3}),
            ("type not in ('a', 'b')", 'type NOT IN (:p0, :p1)',
             {'p0': 'a', 'p1': 'b'}),
            ("(a=1 OR b=2) and c='x'", '(a = :p0 OR b = :p1) AND c = :p2',
             {'p0': 1, 'p1': 2, 'p2': 'x'}),
            ("start>='2026-10-20T00:00:00Z'", 'start >= :p0',
             {'p0': '2026-10-20T00:00:00Z'}),
        ]
        for condition, sql, params in cases:
            with self.subTest(condition=condition):
                clause = parse_condition(condition)
                self.assertEqual(sql, _sql(clause))
                self.assertEqual(params, _params(clause))

    def test_injection_is_rejected(self):
        cases = [
            "id=1; DROP TABLE users",
            "id=1 -- comment",
            "id=1 /* x */",
            "1=1",
            "id=1 OR 1=1",
            "id=(SELECT id FROM users)",
            "id IN (SELECT id FROM users)",
            "id=1 UNION SELECT * FROM users",
            "lower(name)='x'",
            "name=lower('x')",
            "id=name",
            "id",
            "id=",
            "id=1 and",
            "(id=1",
            "id=1)",
            "id=1 id=2",
            "and=1",
            "id NOT = 1",
            "id IN ()",
            "name='unterminated",
            "name=\"it\"s\"",
            "password_hash>'a'",
            "PASSWORD_HASH='x'",
            "id=0x10",
            "id=1e5",
            "x" * 3000 + "=1",
        ]
        for condition in cases:
            with self.subTest(condition=condition[:50]):
                with self.assertRaises(SqlFilterError):
                    parse_condition(condition)

    def test_not_a_string(self):
        for c in [5, ['id=1'], {'id': 1}]:
            with self.assertRaises(SqlFilterError):
                parse_condition(c)


class TestParseOrderBy(unittest.TestCase):
    def test_valid(self):
        cases = [
            (None, None),
            ('', None),
            ('id', 'id ASC'),
            ('start desc', 'start DESC'),
            ('project_id, id DESC', 'project_id ASC, id DESC'),
        ]
        for orderBy, sql in cases:
            with self.subTest(orderBy=orderBy):
                clause = parse_order_by(orderBy)
                self.assertEqual(sql, None if clause is None else _sql(clause))

    def test_invalid(self):
        cases = ['id; DROP TABLE users', 'id desc nulls first',
                 '(SELECT 1)', 'lower(name)', 'id up', '1', 'id,',
                 'password_hash', "'id'"]
        for orderBy in cases:
            with self.subTest(orderBy=orderBy):
                with self.assertRaises(SqlFilterError):
                    parse_order_by(orderBy)


class TestQueryDb(unittest.TestCase):
    """ Run parsed conditions on a sqlite db. """
    def setUp(self):
        self.engine = sqlalchemy.create_engine('sqlite://')
        meta = MetaData()
        self.entries = Table('entries', meta,
                             Column('id', Integer, primary_key=True),
                             Column('project_id', Integer),
                             Column('type', String(64)))
        meta.create_all(self.engine)
        rows = [{'id': i, 'project_id': i % 3,
                 'type': 'tomo_processing' if i % 2 else 'note'}
                for i in range(1, 11)]
        with self.engine.begin() as conn:
            conn.execute(self.entries.insert(), rows)

    def _ids(self, condition, orderBy=None):
        query = sqlalchemy.select(self.entries.c.id)
        clause = parse_condition(condition)
        if clause is not None:
            query = query.where(clause)
        order = parse_order_by(orderBy)
        if order is not None:
            query = query.order_by(order)
        with self.engine.connect() as conn:
            return [r[0] for r in conn.execute(query)]

    def test_queries(self):
        self.assertEqual([4], self._ids('id=4'))
        self.assertEqual([1, 3, 5, 7, 9], self._ids("type='tomo_processing'", 'id'))
        self.assertEqual([7, 1], self._ids(
            "project_id=1 and type=\"tomo_processing\"", 'id desc'))
        self.assertEqual([2, 3, 9, 10], self._ids(
            "(id<4 or id>8) and id!=1", 'id'))
        self.assertEqual([2, 5], self._ids('id in (2, 5, 99)', 'id'))

    def test_values_are_not_sql(self):
        # Quotes inside the value do not close the string
        self.assertEqual([], self._ids("type=\"x' OR '1'='1\""))
        self.assertEqual([], self._ids("type='note\" OR \"1\"=\"1'"))

    def test_unknown_column_fails_in_db(self):
        with self.assertRaises(sqlalchemy.exc.OperationalError):
            self._ids('missing=1')


class TestParseIntRange(unittest.TestCase):
    def test_parse(self):
        default = (1, 9999)
        cases = [
            ('1-999', (1, 999)),
            ('10-10', (10, 10)),
            (' 5 - 20 ', (5, 20)),
            (None, default),
            ('', default),
            ('1-999 or 1=1', default),
            ('1-2-3', default),
            ('abc', default),
            ('20-5', default),
            ('-5', default),
        ]
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(expected, parse_int_range(value, default))


if __name__ == '__main__':
    unittest.main()
