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

from sqlalchemy import Column, Integer, String, JSON
from sqlalchemy_utc import UtcDateTime

from .data_db import DbManager


class DataLog(DbManager):
    """ Main class that will manage the logs about data operations.
    """
    def __init__(self, dbPath, cleanDb=False):
        self.init_db(dbPath, cleanDb=cleanDb)

    def _create_models(self):
        """ Function called from the init_db method. """

        class Log(self.Base):
            """Model for user accounts."""
            __tablename__ = 'logs'

            id = Column(Integer,
                        primary_key=True)

            user_id = Column(Integer,
                             nullable=True)

            # type log
            type = Column(String(16),
                          nullable=False)

            name = Column(String(256),
                          nullable=False)

            timestamp = Column(UtcDateTime,
                               nullable=False)

            # positional args
            args = Column(JSON, default=[])

            # keywork args
            kwargs = Column(JSON, default={})

        self.Log = Log

    def log(self, log_user_id, log_type, log_name,
            *args, **kwargs):

        log = self.Log(
            user_id=log_user_id,
            type=log_type,
            name=log_name,
            timestamp=self.now(),
            args=args,
            kwargs=kwargs)

        self._db_session.add(log)
        self.commit()

        return log

    def get_logs(self):
        return self._db_session.query(self.Log).all()

