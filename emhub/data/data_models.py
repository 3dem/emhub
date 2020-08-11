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


from sqlalchemy import (Column, Integer, String, JSON, Boolean, Float,
                        ForeignKey, Text, Table)
from sqlalchemy.orm import relationship
from sqlalchemy_utc import UtcDateTime, utcnow
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash


def create_data_models(dm, Base):
    """ Define the Data Models that will be use by the Data Manager. """

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
        #booking_auth = Column(JSON, default={'applications': [], 'users': []})
        requires_slot = Column(Boolean, default=False)

        # Latest number of hours that a booking can be canceled
        # for this resource (e.g until 48h for a booking in Krios)
        # If 0, means that the booking can be cancelled at any time
        latest_cancellation = Column(Integer, default=0)

        @property
        def is_microscope(self):
            return 'microscope' in self.tags


    ApplicationUser = Table('application_user', Base.metadata,
                            Column('application_id', Integer,
                                   ForeignKey('applications.id')),
                            Column('user_id', Integer,
                                   ForeignKey('users.id')))

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

        phone = Column(String(80))

        name = Column(String(256),
                      nullable=False)

        created = Column(UtcDateTime,
                         index=False,
                         unique=False,
                         nullable=False,
                         default=utcnow())

        # Default role should be: 'user'
        # more roles can defined in a json list: ['user', 'admin', 'manager']
        roles = Column(JSON, nullable=False, default=['user'])

        password_hash = Column(String(256),
                               unique=True,
                               nullable=False)

        # ---------------- RELATIONS ----------------------------

        # Pi and Lab_members relation
        lab_members = relationship("User", back_populates='pi')

        pi_id = Column(Integer, ForeignKey('users.id'),
                       nullable=True)
        pi = relationship("User",
                          foreign_keys=[pi_id],
                          remote_side=[id],
                          back_populates="lab_members")

        # one user to many sessions, bidirectional
        sessions = relationship('Session', back_populates="users")

        created_applications = relationship("Application",
                                            back_populates="creator")

        # many to many relation with Application
        applications = relationship("Application",
                                    secondary=ApplicationUser,
                                    back_populates="users")

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

        @property
        def is_application_manager(self):
            return len(self.created_applications) > 0

        def get_pi(self):
            """ Return the PI of this users. PI are consider PI of themselves.
            """
            return self if self.is_pi else self.pi

        def same_pi(self, other):
            """ Return if the same pi. """
            return self.get_pi() == other.get_pi()

        def get_applications(self):
            """ Return the applications that this users is involved,
            via its PI.
            """
            pi = self.get_pi()
            if pi is None:
                return []
            else:
                applications = list(pi.created_applications)
                applications.extend(pi.applications)
                return applications

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
        slot_auth = Column(JSON, default={'applications': [], 'users': []})

        description = Column(Text,
                             nullable=True)

        resource_id = Column(Integer, ForeignKey('resources.id'))
        resource = relationship("Resource")

        # This is reference to the user that created the Booking
        creator_id = Column(Integer, ForeignKey('users.id'),
                            nullable=False)
        creator = relationship("User", foreign_keys=[creator_id])

        # And this is the user that "owns" the Booking
        owner_id = Column(Integer, ForeignKey('users.id'),
                          nullable=False)
        owner = relationship("User", foreign_keys=[owner_id])

        # Related to the Owner, we also keep the Application to which
        # this booking is associated
        application_id = Column(Integer, ForeignKey('applications.id'),
                                nullable=True)
        application = relationship("Application")

        repeat_id = Column(String(256), nullable=True)

        repeat_value = Column(String(32), nullable=False, default='no')

        @property
        def days(self):
            """ Count how many days these bookings spans.
            (It is not strictly necessary the total amount of time in in
            units of 24h.
            """
            td = self.end.date() - self.start.date() + dt.timedelta(days=1)
            return td.days

        def __repr__(self):
            def _timestr(dt):
                return dt.strftime('%Y/%m/%d')

            return ('<Booking: %s, owner=%s, dates: %s - %s>'
                    % (self.title, self.owner.name,
                       _timestr(self.start), _timestr(self.end)))

        def json(self):
            return _json(self)

    class Template(Base):
        """ Classes used as template to create Applications.
        Template instances that are 'active' will allow to
        create new applications from it. Otherwise, templates can be
        closed and will not be visible when creating a new application. """
        __tablename__ = 'templates'

        id = Column(Integer,
                    primary_key=True)

        # Possible statuses of a Template:
        #   - preparation: when it has been created and it under preparation
        #   - active: it has been activated for operation
        #   - closed: it has been closed and it becomes inactive
        status = Column(String(32), default='preparation')

        title = Column(String(256), nullable=False)

        description = Column(Text, nullable=True)

        # This will be data in json form to describe extra parameters defined
        # in this template for all the Applications created from this.
        form_schema = Column(JSON, nullable=True)

        applications = relationship("Application", back_populates='template')

        def json(self):
            return _json(self)

    class Application(Base):
        """
        Application that applies for access to the facility.
        Usually many principal investigators are associated to a project.
        """
        __tablename__ = 'applications'

        id = Column(Integer,
                    primary_key=True)

        code = Column(String(32),
                      nullable=False,
                      unique=True)

        created = Column(UtcDateTime,
                         index=False,
                         unique=False,
                         nullable=False,
                         default=utcnow())

        alias = Column(String(32))

        # Possible statuses of an Application:
        #   - preparation: when it has been created and it under preparation
        #   - submitted: the application has been submitted for review
        #   - rejected: if for some reason the application is rejected
        #   - accepted: the application has been accepted after evaluation
        #   - active: it has been activated for operation
        #   - closed: it has been closed and it becomes inactive
        status = Column(String(32), default='preparation')

        title = Column(String(256),
                       nullable=False)

        description = Column(Text,
                             nullable=True)

        invoice_reference = Column(String(256),
                                   nullable=False)

        invoice_address = Column(Text,
                                 nullable=True)

        DEFAULT_ALLOCATION = {'quota': {'krios': 0, 'talos': 0},
                              'noslot': []}
        # This is the maximum amount of days allocated per type of resource
        # {'krios': 20} means that this application can book max to 20 days
        # for any resource with tag 'krios' (i.e Titan Krios scopes)
        resource_allocation = Column(JSON, default=DEFAULT_ALLOCATION)

        # ID of the user that created the Application, it should be a PI
        creator_id = Column(Integer, ForeignKey('users.id'), nullable=False)
        creator = relationship("User", foreign_keys=[creator_id],
                               back_populates="created_applications")

        users = relationship("User",
                             secondary=ApplicationUser,
                             back_populates="applications")

        # Link to the template used to create the form
        template_id = Column(Integer, ForeignKey('templates.id'), nullable=False)
        template = relationship("Template", foreign_keys=[template_id],
                                back_populates="applications")

        def __repr__(self):
            return '<Application code=%s, alias=%s>' % (self.code, self.alias)

        def json(self):
            return _json(self)

        @property
        def is_active(self):
            return self.status == 'active'

        def get_quota(self, key):
            """ Return the quota (in days) for this application.
            Args:
                key: the key representing either a resource id or a tag (e.g 1 or 'krios')
            Return:
                the number of days that this application can use a resource or a groups
                resources with the same tag. It will return None if there is no quota for
                such resource.
            """
            return self.resource_allocation['quota'].get(key, None)

        def no_slot(self, resourceKey):
            """ Return True if this application is not force to create bookings within
            a given slot for certain resource.
             For example, some applications might be required to book Krios1 only on specific
             slots, while others will be able to book in free days.
            """
            return resourceKey in self.resource_allocation['noslot']

        @property
        def pi_list(self):
            """ Return the list of PI. """
            # Since we are importing data now from the Portal, some application
            # have the creator of the application as one of the users, so we want
            # to avoid duplicated entries
            pi_list = [self.creator]
            for u in self.users:
                if u.id != self.creator.id:
                    pi_list.append(u)
            return pi_list

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
            return '<Session {}>'.format(self.dataName)

        def json(self):
            return _json(self)

    dm.User = User
    dm.Resource = Resource
    dm.Booking = Booking
    dm.Session = Session
    dm.Template = Template
    dm.Application = Application

