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
import datetime
from pprint import pprint
import uuid


from sqlalchemy import (create_engine, Column, Integer, String, JSON,
                        Boolean, Float, ForeignKey, Text, text)
from sqlalchemy.orm import scoped_session, sessionmaker, relationship
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy_utc import UtcDateTime, utcnow
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash


from .session_hdf5 import H5SessionData
from .data_test import TestData
from .data_models import create_data_models


class DataManager:
    """ Main class that will manage the sessions and their information.
    """
    def __init__(self, sqlitePath):
        is_dev = os.environ.get('FLASK_ENV', None) == 'development'

        engine = create_engine('sqlite:///' + sqlitePath,
                               convert_unicode=True,
                               echo=is_dev)
        self._db_session = scoped_session(sessionmaker(autocommit=False,
                                                       autoflush=False,
                                                       bind=engine))
        Base = declarative_base()
        Base.query = self._db_session.query_property()

        create_data_models(self, Base)

        # Create the database if it does not exists
        if not os.path.exists(sqlitePath):
            Base.metadata.create_all(bind=engine)
            # populate db with test data
            TestData(self)

        self._lastSessionId = None
        self._lastSession = None

    # ------------------------- USERS ----------------------------------
    def create_user(self, **attrs):
        """ Create a new user in the DB. """
        attrs['password_hash'] = self.User.create_password_hash(attrs['password'])
        del attrs['password']
        return self.__create_item(self.User, **attrs)

    def get_users(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.User,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_user_by(self, **kwargs):
        """ This should return a single user or None. """
        return self.__item_by(self.User, **kwargs)

    # ---------------------------- RESOURCES ---------------------------------
    def create_resource(self, **attrs):
        return self.__create_item(self.Resource, **attrs)

    def get_resources(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Resource,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    # ---------------------------- PROJECTS -----------------------------------
    def create_project(self, **attrs):
        return self.__create_item(self.Project, **attrs)

    def get_projects(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Project,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    # ---------------------------- BOOKINGS -----------------------------------
    def create_booking(self, **attrs):
        # We might create many bookings if repeat != 'no'
        repeat_value = attrs.get('repeat_value', 'no')
        bookings = []

        if repeat_value == 'no':
            bookings.append(self.__create_item(self.Booking, **attrs))
        else:
            days = {'weekly': 7, 'bi-weekly': 14}

            if repeat_value not in days:
                raise Exception('Unexpected repeat value of "%s"' % repeat_value)

            delta = dt.timedelta(days=days[repeat_value])

            uid = str(uuid.uuid4())
            # FIXME: Now only creating 10 events
            for i in range(10):
                start, end = attrs['start'], attrs['end']
                attrs['repeat_id'] = uid
                bookings.append(self.__create_item(self.Booking, **attrs))
                attrs['start'] = start + delta
                attrs['end'] = end + delta

        return bookings

    def get_bookings(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Booking,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def delete_booking(self, booking_id):
        booking = self.get_bookings(condition='id="%s"' % booking_id)[0]
        rid = booking.repeat_id
        print("Deleting booking, repeat_id: ", rid)
        if rid is not None:
            deleted = []
            bookings = self.get_bookings(condition='repeat_id="%s"' % rid)
            for b in bookings:
                deleted.append(b.id)
                self._db_session.delete(b)
        else:
            deleted = [booking_id]
            self._db_session.delete(booking)

        self._db_session.commit()

        return deleted

    # ---------------------------- SESSIONS -----------------------------------
    def get_sessions(self, condition=None, orderBy=None, asJson=False):
        """ Returns a list.
        condition example: text("id<:value and name=:name")
        """
        return self.__items_from_query(self.Session,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def create_session(self, **attrs):
        """ Add a new session row. """
        return self.__create_item(self.Session, **attrs)

    def update_session(self, sessionId, **attrs):
        """ Update session attrs. """
        session = self.Session.query.get(sessionId)

        # TODO: Check the following lines
        # for attr in attrs:
        #     session.attr = attrs[attr]

        self._db_session.commit()

    def delete_session(self, sessionId):
        """ Remove a session row. """
        session = self.Session.query.get(sessionId)
        self._db_session.delete(session)
        self._db_session.commit()

    def load_session(self, sessionId):
        if sessionId == self._lastSessionId:
            session = self._lastSession
        else:
            session = self.Session.query.get(sessionId)
            session.data = H5SessionData(session.sessionData, 'r')
            self._lastSessionId = sessionId
            self._lastSession = session

        return session

    def close(self):
        # if self._lastSession is not None:
        #     self._lastSession.data.close()

        self._db_session.remove()

    # --------------- Internal implementation methods --------------------
    def __create_item(self, ModelClass, **attrs):
        new_item = ModelClass(**attrs)
        self._db_session.add(new_item)
        self._db_session.commit()
        return new_item

    def __items_from_query(self, ModelClass,
                           condition=None, orderBy=None, asJson=False):
        query = self._db_session.query(ModelClass)

        if condition is not None:
            query = query.filter(text(condition))

        if orderBy is not None:
            query = query.order_by(orderBy)

        result = query.all()
        return [s.json() for s in result] if asJson else result

    def __item_by(self, ModelClass, **kwargs):
        query = self._db_session.query(ModelClass)
        return query.filter_by(**kwargs).one_or_none()

    def __matching_project(self, projects, auth_json):
        """ Return True if there is a project code in auth_json. """
        if not auth_json or 'projects' not in auth_json:
            return False

        json_codes = auth_json['projects']

        return any(p.code in json_codes for p in projects)

    def is_user_auth(self, user, auth_json):
        """ Return True if the user is authorized (i.e any of the project
        codes appears in auth_json['projects'].
        """
        if user is None or not auth_json:
            return False

        if user.is_manager or 'any' in auth_json.get('users', []):
            return True

        return self.__matching_project(self.get_user_projects(user), auth_json)

    def get_user_pi(self, user):
        # FIXME There is a problem with User.pi relation...
        return user if user.is_pi else self.get_user_by(id=user.pi_id)

    def get_user_projects(self, user):
        # FIXME There is a problem with User.pi relation...
        pi = self.get_user_pi(user)

        return [] if pi is None else pi.projects

