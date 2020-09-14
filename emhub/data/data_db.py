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
import uuid
from collections import defaultdict

from sqlalchemy import create_engine, text
from sqlalchemy.orm import scoped_session, sessionmaker
from sqlalchemy.ext.declarative import declarative_base

from .data_session import H5SessionData
from .data_models import create_data_models


class DbManager:
    """ Helper class to deal with DB stuff
    """
    def init_db(self, dbPath, cleanDb=False):
        do_echo = os.environ.get('SQLALCHEMY_ECHO', '0') == '1'

        if cleanDb and os.path.exists(dbPath):
            os.remove(dbPath)

        engine = create_engine('sqlite:///' + dbPath,
                               convert_unicode=True,
                               echo=do_echo)
        self._db_session = scoped_session(sessionmaker(autocommit=False,
                                                       autoflush=False,
                                                       bind=engine))
        self.Base = declarative_base()
        self.Base.query = self._db_session.query_property()

        self._create_models()

        # Create the database if it does not exists
        if not os.path.exists(dbPath):
            self.Base.metadata.create_all(bind=engine)

    def commit(self):
        self._db_session.commit()

    def delete(self, item, commit=True):
        self._db_session.delete(item)
        if commit:
            self.commit()

    def close(self):
        self._db_session.remove()
