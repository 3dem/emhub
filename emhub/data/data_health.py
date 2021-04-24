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

from .data_db import DbManager


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

            timestamp = Column(UtcDateTime, unique=True, index=True)

            vpp_slot = Column(Integer, nullable=True)
            vpp_position = Column(Integer, nullable=True)
            acq_count = Column(Integer, nullable=True)
            acq_mode = Column(String(256), nullable=True)
            frac_fmt = Column(String(256), nullable=True)
            cartridge_count = Column(Integer, nullable=True)
            cassette_count = Column(Integer, nullable=True)
            emission_current = Column(Integer, nullable=True)
            gun_lens = Column(Integer, nullable=True)
            spot_size = Column(Integer, nullable=True)
            column_valves = Column(String(256), nullable=True)
            al_dewar_usage = Column(Float, default=0, nullable=True)
            col_dewar_usage = Column(Float, default=0, nullable=True)

            # Microscope used
            resource_id = Column(Integer, index=True)

            #def json(self):
            #    return self.json_from_object(self)

        self.HealthTable = HealthTable

    def create_row(self, **attrs):
        row = self.HealthTable(**attrs)
        self._db_session.add(row)
        self.commit()

        return row

    def update_row(self, **kwargs):
        query = self._db_session.query(self.HealthTable)
        item = query.filter_by(id=kwargs['id']).one_or_none()

        if item is None:
            raise Exception("Not found item %s with id %s"
                            % (self.HealthTable.__name__,
                               kwargs['id']))

        for attr, value in kwargs.items():
            if attr != 'id':
                setattr(item, attr, value)
        self.commit()

        return item

    def items_from_query(self, condition=None, orderBy=None, asJson=False):
        query = self._db_session.query(self.HealthTable)

        if condition is not None:
            query = query.filter(sqlalchemy.text(condition))

        if orderBy is not None:
            query = query.order_by(orderBy)

        result = query.all()
        return [s.json() for s in result] if asJson else result
