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


from sqlalchemy import (create_engine, Column, Integer, String, JSON,
                        Boolean, Float, ForeignKey, Text, text)
from sqlalchemy.orm import scoped_session, sessionmaker, relationship
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy_utc import UtcDateTime, utcnow
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash


from .session_hdf5 import H5SessionData
from .data_test import TestData
from emhub.utils import datetime_to_isoformat, datetime_from_isoformat


class DataManager:
    """ Main class that will manage the sessions and their information.
    """
    def __init__(self, sqlitePath):
        engine = create_engine('sqlite:///' + sqlitePath,
                               convert_unicode=True,
                               echo=True)
        self._db_session = scoped_session(sessionmaker(autocommit=False,
                                                       autoflush=False,
                                                       bind=engine))
        Base = declarative_base()
        Base.query = self._db_session.query_property()

        self.__createModels(Base)

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
        return self.__create_item(self.Booking, **attrs)

    def get_bookings(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Booking,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

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

    def __createModels(self, Base):

        def _json(obj):
            """ Return row info as json dict. """
            def jsonattr(k):
                v = getattr(obj, k)
                if isinstance(v, datetime.date):
                    return v.isoformat()
                elif isinstance(v, decimal.Decimal):
                    return float(v)
                else:
                    return v

            return {c.key: jsonattr(c.key) for c in obj.__table__.c}

        class Resource(Base):
            """ Representation of different type of Resources.
            (e.g Micrographs, other instruments or services.
            """
            __tablename__ = 'resources'

            id = Column(Integer,
                        primary_key=True)
            name = Column(String(64),
                          index=True,
                          unique=True,
                          nullable=False)

            tags = Column(String(256),
                          nullable=False)

            image = Column(String(64),
                           nullable=False)

            color = Column(String(16),
                           nullable=False)

            # Booking authorization, who can book within this slot
            booking_auth = Column(JSON)

        class User(UserMixin, Base):
            """Model for user accounts."""
            __tablename__ = 'users'

            id = Column(Integer,
                        primary_key=True)
            username = Column(String(64),
                              index=True,
                              unique=True,
                              nullable=False)
            email = Column(String(80),
                           index=False,
                           unique=True,
                           nullable=False)

            name = Column(String(256),
                          nullable=False)

            created = Column(UtcDateTime,
                             index=False,
                             unique=False,
                             nullable=False,
                             default=utcnow())

            pi_id = Column(Integer, ForeignKey('users.id'),
                           nullable=True)
            pi = relationship("User", foreign_keys=[pi_id], back_populates="lab_members")

            lab_members = relationship("User")

            # Default role should be: 'user'
            # more roles can be comma separated: 'user,admin,manager'
            roles = Column(String(128),
                           nullable=False,
                           default='user')

            password_hash = Column(String(256),
                                   unique=True,
                                   nullable=False)

            # one user to many sessions, bidirectional
            sessions = relationship('Session', back_populates="users")

            @staticmethod
            def create_password_hash(password):
                return generate_password_hash(password, method='sha256')

            def set_password(self, password):
                """Create hashed password."""
                self.password_hash = self.create_password_hash(password)

            def check_password(self, password):
                """Check hashed password."""
                return check_password_hash(self.password_hash, password)

            def __repr__(self):
                return '<User {}>'.format(self.username)

            def json(self):
                return _json(self)

            @property
            def is_developer(self):
                return 'developer' in self.roles

            @property
            def is_admin(self):
                return 'admin' in self.roles or self.is_developer

            @property
            def is_manager(self):
                return 'manager' in self.roles or self.is_admin

            @property
            def is_pi(self):
                return 'pi' in self.roles

            def same_pi(self, other):
                """ Return if the same pi. """
                pi_id = self.id if self.is_pi else self.pi_id
                return pi_id == other.pi_id

        class Booking(Base):
            """Model for user accounts."""
            __tablename__ = 'bookings'

            id = Column(Integer,
                        primary_key=True)

            title = Column(String(256),
                           nullable=False)

            start = Column(UtcDateTime,
                           nullable=False)

            end = Column(UtcDateTime,
                         nullable=False)

            # booking, slot or downtime
            type = Column(String(16),
                          nullable=False)

            # slot authorization, who can book within this slot
            slot_auth = Column(JSON)

            description = Column(Text,
                                 nullable=True)

            resource_id = Column(Integer, ForeignKey('resources.id'))
            resource = relationship("Resource")

            creator_id = Column(Integer, ForeignKey('users.id'),
                                nullable=False)
            creator = relationship("User", foreign_keys=[creator_id])

            owner_id = Column(Integer, ForeignKey('users.id'),
                              nullable=False)
            owner = relationship("User", foreign_keys=[owner_id])

            def __repr__(self):
                return '<Booking {}>'.format(self.title)

            def json(self):
                return _json(self)

        class Project(Base):
            """
            Project that applies for access to the facility.
            Usually many principal investigators are associated to a project.
            """
            __tablename__ = 'projects'

            id = Column(Integer,
                        primary_key=True)

            code = Column(String(32),
                          nullable=False,
                          unique=True)

            alias = Column(String(32))

            title = Column(String(256),
                           nullable=False)

            description = Column(Text,
                                 nullable=True)

            invoice_reference = Column(String(256),
                                       nullable=False)

            invoice_address = Column(Text,
                                     nullable=True)

            pi_id = Column(Integer, ForeignKey('users.id'),
                           nullable=False)
            pi = relationship("User", foreign_keys=[pi_id], backref="projects")

            def __repr__(self):
                return '<Project code=%s, alias=%s>' % (self.code, self.alias)

            def json(self):
                return _json(self)

        class Session(Base):
            """Model for sessions."""
            __tablename__ = 'sessions'

            id = Column(Integer,
                        primary_key=True)
            sessionData = Column(String(80),
                                 index=False,
                                 unique=True,
                                 nullable=False)
            sessionName = Column(String(80),
                                 index=True,
                                 unique=False,
                                 nullable=False)
            dateStarted = Column(UtcDateTime,
                                 index=False,
                                 unique=False,
                                 nullable=False)
            description = Column(Text,
                                 index=False,
                                 unique=False,
                                 nullable=True)
            status = Column(String(20),
                            index=False,
                            unique=False,
                            nullable=False)
            microscope = Column(String(64),
                                index=False,
                                unique=False,
                                nullable=False)
            voltage = Column(Integer,
                             index=False,
                             unique=False,
                             nullable=False)
            cs = Column(Float,
                        index=False,
                        unique=False,
                        nullable=False)
            phasePlate = Column(Boolean,
                                index=False,
                                unique=False,
                                nullable=False)
            detector = Column(String(64),
                              index=False,
                              unique=False,
                              nullable=False)
            detectorMode = Column(String(64),
                                  index=False,
                                  unique=False,
                                  nullable=False)
            pixelSize = Column(Float,
                               index=False,
                               unique=False,
                               nullable=False)
            dosePerFrame = Column(Float,
                                  index=False,
                                  unique=False,
                                  nullable=False)
            totalDose = Column(Float,
                               index=False,
                               unique=False,
                               nullable=False)
            exposureTime = Column(Float,
                                  index=False,
                                  unique=False,
                                  nullable=False)
            numOfFrames = Column(Integer,
                                 index=False,
                                 unique=False,
                                 nullable=False)
            numOfMovies = Column(Integer,
                                 index=False,
                                 unique=False,
                                 nullable=False)
            numOfMics = Column(Integer,
                               index=False,
                               unique=False,
                               nullable=False)
            numOfCtfs = Column(Integer,
                               index=False,
                               unique=False,
                               nullable=False)
            numOfPtcls = Column(Integer,
                                index=False,
                                unique=False,
                                nullable=False)
            numOfCls2D = Column(Integer,
                                index=False,
                                unique=False,
                                nullable=False)
            ptclSizeMin = Column(Integer,
                                 index=False,
                                 unique=False,
                                 nullable=False)
            ptclSizeMax = Column(Integer,
                                 index=False,
                                 unique=False,
                                 nullable=False)

            # one user to many sessions, bidirectional
            userid = Column(Integer, ForeignKey('users.id'),
                            nullable=False)
            users = relationship("User", back_populates="sessions")

            def __repr__(self):
                return '<Session {}>'.format(self.sessionName)

            def json(self):
                return _json(self)

        self.User = User
        self.Resource = Resource
        self.Booking = Booking
        self.Session = Session
        self.Project = Project

