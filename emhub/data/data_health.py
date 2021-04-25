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

import sqlalchemy
from sqlalchemy import Column, Integer, String, Float
from sqlalchemy_utc import UtcDateTime
from datetime import datetime, timezone, timedelta

from .data_db import DbManager


TZ_DELTA = 0  # Define timezone, UTC '0'
tzinfo = timezone(timedelta(hours=TZ_DELTA))


class DataHealth(DbManager):
    """ Main class that will manage the health info about microscopes.
    """
    def __init__(self, dbPath, cleanDb=False):
        self.init_db(dbPath, cleanDb=cleanDb)

    def _create_models(self):
        """ Function called from the init_db method. """

        class HealthTable(self.Base):
            """Model for health information of a resource."""
            __tablename__ = 'health'
            id = Column(Integer, primary_key=True)
            # Microscope used
            resource_id = Column(Integer, default=1, index=True)

            # FIXME: should be unique
            timestamp = Column(UtcDateTime, unique=False, index=True)

            vpp_slot = Column(Integer, nullable=True)
            vpp_position = Column(Integer, nullable=True)
            acq_count = Column(Integer, nullable=True)
            acq_mode = Column(String(256), nullable=True)
            frac_fmt = Column(String(256), nullable=True)
            cartridge_count = Column(Integer, nullable=True)
            cassette_count = Column(Integer, nullable=True)
            al_dewar_usage = Column(Float, default=0, nullable=True)
            col_dewar_usage = Column(Float, default=0, nullable=True)
            emission_current = Column(Integer, nullable=True)
            gun_lens = Column(Integer, nullable=True)
            spot_size = Column(Integer, nullable=True)
            mag = Column(Integer, nullable=True)
            eftem_mode = Column(String(256), nullable=True)
            illum_mode = Column(String(256), nullable=True)
            column_valves = Column(String(256), nullable=True)
            memory_load = Column(String(256), nullable=True)
            afis = Column(String(256), nullable=True)
            camera_mode = Column(String(256), nullable=True)
            num_exp = Column(Integer, nullable=True)
            img_per_hole = Column(Integer, nullable=True)
            dose_rate = Column(Float, default=0, nullable=True)

            def json(self):
                return DbManager.json_from_object(self)

        self.HealthTable = HealthTable

    def create_rows(self, **kwargs):
        items = {'items': []}
        for row_dict in kwargs['items']:
            # FIXME: remove this date hack
            stamp = row_dict['timestamp']
            if isinstance(stamp, str):
                row_dict['timestamp'] = self._datetime(2020, 5, 8, 9, 30, 10)
            row = self.HealthTable(**row_dict)
            items['items'].append(row.json())
            self._db_session.add(row)
        self.commit()

        return items

    def update_rows(self, **kwargs):
        query = self._db_session.query(self.HealthTable)
        items_list = kwargs['attrs']
        ids = [item['id'] for item in items_list]

        items_db = [query.filter(query.id.in_(ids))]
        if not items_db:
            raise Exception("Found no items %s with ids %s"
                            % (self.HealthTable.__name__,
                               ids))

        for item_dict, item_db in zip(items_list, items_db):
            for attr, value in item_dict.items():
                if attr != 'id':
                    setattr(item_db, attr, value)
        self.commit()

        return items_db

    def items_from_query(self, condition=None, orderBy=None, asJson=False):
        query = self._db_session.query(self.HealthTable)

        if condition is not None:
            query = query.filter(sqlalchemy.text(condition))

        if orderBy is not None:
            query = query.order_by(orderBy)

        result = query.all()
        return [s.json() for s in result] if asJson else result

    def _datetime(self, *args):
        return datetime(*args, tzinfo=tzinfo)
