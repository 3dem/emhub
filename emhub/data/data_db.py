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

import os
import datetime as dt
import decimal

import sqlalchemy
from sqlalchemy.orm import scoped_session, sessionmaker
from sqlalchemy.ext.declarative import declarative_base


class DbManager:
    """ Helper class to deal with DB stuff
    """
    def init_db(self, dbPath, cleanDb=False, create=True):
        do_echo = os.environ.get('SQLALCHEMY_ECHO', '0') == '1'

        if cleanDb and os.path.exists(dbPath):
            os.remove(dbPath)

        engine = sqlalchemy.create_engine('sqlite:///' + dbPath, echo=do_echo)

        self._db_session = scoped_session(sessionmaker(autocommit=False,
                                                       autoflush=False,
                                                       bind=engine))
        self.Base = declarative_base()
        self.Base.query = self._db_session.query_property()

        self._create_models()

        # Create the database if it does not exists
        if not os.path.exists(dbPath) and create:
            self.Base.metadata.create_all(bind=engine)

    def commit(self):
        self._db_session.commit()

    def delete(self, item, commit=True):
        self._db_session.delete(item)
        if commit:
            self.commit()

    def close(self):
        self._db_session.remove()

    # ------------------- Some utility methods --------------------------------
    def now(self):
        from tzlocal import get_localzone
        # get local timezone
        local_tz = get_localzone()
        return dt.datetime.now(local_tz)

    @staticmethod
    def json_from_value(v):
        if isinstance(v, dt.date) or isinstance(v, dt.datetime):
            return v.isoformat()
        elif isinstance(v, decimal.Decimal):
            return float(v)
        else:
            return v

    @staticmethod
    def json_from_object(obj):
        """ Return row info as json dict. """
        return {c.key: DbManager.json_from_value(getattr(obj, c.key))
                for c in obj.__table__.c}

    @staticmethod
    def json_from_dict(d):
        """ Return row info as json dict. """
        return {k: DbManager.json_from_value(v) for k, v in d.items()}
