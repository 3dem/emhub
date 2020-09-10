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


class DataManager:
    """ Main class that will manage the sessions and their information.
    """
    def __init__(self, dataPath, dbName='emhub.sqlite', user=None, cleanDb=False):
        do_echo = os.environ.get('SQLALCHEMY_ECHO', '0') == '1'

        self._dataPath = dataPath
        self._sessionsPath = os.path.join(dataPath, 'sessions')

        sqlitePath = os.path.join(dataPath, dbName)

        if cleanDb and os.path.exists(sqlitePath):
            os.remove(sqlitePath)

        engine = create_engine('sqlite:///' + sqlitePath,
                               convert_unicode=True,
                               echo=do_echo)
        self._db_session = scoped_session(sessionmaker(autocommit=False,
                                                       autoflush=False,
                                                       bind=engine))
        Base = declarative_base()
        Base.query = self._db_session.query_property()

        create_data_models(self, Base)

        self._lastSession = None
        self._user = user  # Logged user

        # Create sessions dir if not exists
        os.makedirs(self._sessionsPath, exist_ok=True)

        # Create the database if it does not exists
        if not os.path.exists(sqlitePath):
            Base.metadata.create_all(bind=engine)

    def commit(self):
        self._db_session.commit()

    def delete(self, item, commit=True):
        self._db_session.delete(item)
        if commit:
            self.commit()

    def close(self):
        #if self._lastSession is not None:
        #    self._lastSession.data.close()

        self._db_session.remove()

    # ------------------------- USERS ----------------------------------
    def create_admin(self, password='admin'):
        """ Create special user 'admin'. """
        admin = self.create_user(username='admin',
                                 email='admin@emhub.org',
                                 password=password,
                                 name='admin',
                                 roles='dev, admin',
                                 pi_id=None)
        if self._user is None:
            self._user = admin

    def create_user(self, **attrs):
        """ Create a new user in the DB. """
        attrs['password_hash'] = self.User.create_password_hash(attrs['password'])
        del attrs['password']
        return self.__create_item(self.User, **attrs)

    def update_user(self, **attrs):
        """ Update an existing user. """
        if 'password' in attrs:
            attrs['password_hash'] = self.User.create_password_hash(attrs['password'])
            del attrs['password']

        return self.__update_item(self.User, **attrs)

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

    def update_resource(self, **attrs):
        return self.__update_item(self.Resource, **attrs)

    def get_resources(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Resource,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_resource_by(self, **kwargs):
        """ This should return a single Resource or None. """
        return self.__item_by(self.Resource, **kwargs)

    # ---------------------------- APPLICATIONS --------------------------------
    def create_template(self, **attrs):
        return self.__create_item(self.Template, **attrs)

    def get_templates(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Template,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def update_template(self, **attrs):
        return self.__update_item(self.Template, **attrs)

    def delete_template(self, **attrs):
        template = self.__item_by(self.Template, id=attrs['id'])
        self.delete(template)
        return template

    def create_application(self, **attrs):
        return self.__create_item(self.Application, **attrs)

    def get_applications(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Application,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_application_by(self, **kwargs):
        """ This should return a single user or None. """
        return self.__item_by(self.Application, **kwargs)

    def update_application(self, **attrs):
        return self.__update_item(self.Application, **attrs)

    # ---------------------------- BOOKINGS -----------------------------------
    def create_booking(self,
                       check_min_booking=True,
                       check_max_booking=True,
                       **attrs):
        # We might create many bookings if repeat != 'no'
        repeat_value = attrs.get('repeat_value', 'no')
        attrs.pop('modify_all', None)
        bookings = []

        def _add_booking(attrs):
            b = self.__create_booking(attrs,
                                      check_min_booking=check_min_booking,
                                      check_max_booking=check_max_booking)
            bookings.append(b)

        if repeat_value == 'no':
            _add_booking(attrs)
        else:
            repeat_stop = attrs.pop('repeat_stop')
            repeater = RepeatRanges(repeat_value, attrs)
            uid = str(uuid.uuid4())

            while attrs['end'] < repeat_stop:
                attrs['repeat_id'] = uid
                _add_booking(attrs)
                repeater.move()  # will move next start,end in attrs

        # Validate and insert all created bookings
        for b in bookings:
            self._db_session.add(b)
        self.commit()

        return bookings

    def update_booking(self, **attrs):
        """ Update one or many bookings (in case of repeating events)

        Keyword Args:
            id: the of the booking to be updated
            modify_all: Boolean flag in case the booking is a repeating event.
                If True, all bookings from this one, will be also updated.
        """
        repeat = attrs.get('repeat_value', 'no')
        repeater = RepeatRanges(repeat, attrs) if repeat != 'no' else None

        def update(b):
            self.__check_cancellation(b)

            for attr, value in attrs.items():
                if attr != 'id':
                    setattr(b, attr, value)
            if repeater:
                repeater.move()  # move start, end for repeating bookings

        return self._modify_bookings(attrs, update)

    def get_bookings(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Booking,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def delete_booking(self, **attrs):
        """ Delete one or many bookings (in case of repeating events)

        Keyword Args:
            id: the of the booking to be deleted
            modify_all: Boolean flag in case the booking is a repeating event.
                If True, all bookings from this one, will be also deleted.
        """
        def delete(b):
            self.__check_cancellation(b)
            self.delete(b, commit=False)

        return self._modify_bookings(attrs, delete)

    def get_application_bookings(self, applications,
                                resource_ids=None, resource_tags=None):
        pass

    def count_booking_resources(self, applications,
                                resource_ids=None, resource_tags=None):
        """ Count how many days has been used by applications from the
        current bookings. The count can be done by resources or by tags.
        """
        application_ids = set(a for a in applications)
        count_dict = defaultdict(lambda: defaultdict(lambda: 0))

        for b in self.get_bookings():
            #print("Booking: ", b, "\n   - Application: ", b.application)

            if b.application is None:
                continue

            baid = b.application.id
            if baid in application_ids:
                rid = b.resource.id
                if resource_tags is not None:
                    for tag in resource_tags:
                        if tag in b.resource.tags:
                            count_dict[baid][tag] += b.days
                elif not resource_ids or rid in resource_ids:
                    count_dict[baid][rid] += b.days

        return count_dict

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
        session = self.__create_item(self.Session, **attrs)
        # Let's update the data path after we know the id
        print("Creating session id=%s" % session.id)
        session.data_path = 'session_%06d.h5' % session.id
        self.commit()

        print("    session-data-path: ", session.data_path)
        print("    full-path: ", self._session_data_path(session))

        # Create empty hdf5 file
        data = H5SessionData(self._session_data_path(session), mode='a')
        data.close()

        return session

    def update_session(self, **attrs):
        """ Update session attrs. """
        from pprint import pprint
        pprint(attrs)
        attrs['id'] = attrs.pop('id')
        return self.__update_item(self.Session, **attrs)

    def delete_session(self, **attrs):
        """ Remove a session row. """
        sessionId = attrs['id']
        session = self.Session.query.get(sessionId)
        data_path = os.path.join(self._sessionsPath, session.data_path)
        print("Deleting session id=%s" % sessionId)
        self.delete(session)
        os.remove(data_path)
        return session

    def load_session(self, sessionId, mode="r"):
        # if self._lastSession is not None:
        #     if self._lastSession.id == sessionId:
        #         return self._lastSession
        #     self._lastSession.data.close()

        session = self.Session.query.get(sessionId)
        session.data = H5SessionData(self._session_data_path(session), mode)
        return session

    # ------------------- Some utility methods --------------------------------
    def now(self):
        from tzlocal import get_localzone
        # get local timezone
        local_tz = get_localzone()
        return dt.datetime.now(local_tz)

    # --------------- Internal implementation methods -------------------------
    def __create_item(self, ModelClass, **attrs):
        new_item = ModelClass(**attrs)
        self._db_session.add(new_item)
        self.commit()
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

    def __update_item(self, ModelClass, **kwargs):
        item = self.__item_by(ModelClass, id=kwargs['id'])
        print("Updating %s" % item)
        for attr, value in kwargs.items():
            if attr != 'id':
                setattr(item, attr, value)
                print("   setting: %s = %s" % (attr, value))
        self.commit()

        return item

    def __matching_project(self, applications, auth_json):
        """ Return True if there is a project code in auth_json. """
        if not auth_json or 'applications' not in auth_json:
            return False

        json_codes = auth_json['applications']

        return any(p.code in json_codes for p in applications)

    # ------------------- BOOKING helper functions -----------------------------
    def __create_booking(self, attrs, **kwargs):
        if 'application_id' not in attrs:
            owner = self.get_user_by(id=attrs['owner_id'])
            apps = owner.get_applications()
            n = len(apps)

            if n == 0 and not owner.is_manager:
                raise Exception("User %s has no active application"
                                % owner.name)

            # FIXME: Validate one application is selected when many are active
            # if n > 1:
            #     raise Exception("User %s has more than one active application"
            #                     % owner.name)
            # elif n == 1:
            #     attrs['application_id'] = apps[0].id
            if apps:
                attrs['application_id'] = apps[0].id

        b = self.Booking(**attrs)
        self.__validate_booking(b, **kwargs)
        return b

    def __validate_booking(self, booking, **kwargs):
        # Check the booking time is bigger than the minimum booking time
        # specified in the resource settings
        r = self.get_resource_by(id=booking.resource_id)
        check_min_booking = kwargs.get('check_min_booking', True)
        check_max_booking = kwargs.get('check_max_booking', True)

        if check_min_booking and r.min_booking > 0:
            mm = dt.timedelta(minutes=int(r.min_booking * 60))
            if booking.duration < mm:
                raise Exception("The duration of the booking is less that "
                                "the minimum specified for the resource. ")

        if check_max_booking and r.max_booking > 0:
            mm = dt.timedelta(minutes=int(r.max_booking * 60))
            if booking.duration > mm:
                raise Exception("The duration of the booking is greater that "
                                "the maximum allowed for the resource. ")

        if not self._user.is_manager and booking.start.date() < self.now().date():
            raise Exception("The booking start can not be in the past. ")

        app_id = booking.application_id
        if app_id is not None:
            a = self.get_application_by(id=app_id)

            count = self.count_booking_resources([app_id],
                                                 resource_tags=r.tags.split())
            for tagKey, tagCount in count[app_id]   .items():
                alloc = a.get_quota(tagKey)
                if alloc:  # if different from None or 0, then check
                    if tagCount + booking.days > alloc:
                        raise Exception("Exceeded number of allocated days "
                                        "for application %s on resource tag '%s'"
                                        % (a.code, tagKey))
        #raise Exception("No more bookings allowed now. ")

    def __check_cancellation(self, booking):
        """ Check if this booking can be updated or deleted.
        Normal users can only delete or modify the booking up to X hours
        before the starting time. The amount of hours is defined by the
        booking latest_cancellation property.
        Managers can change bookings even the same day and only
        Administrators can change past events.
        This function will raise an exception if a condition is not meet.
        """
        user = self._user
        if user.is_admin:
            return  # admin can cancel/modify at any time

        now = self.now()
        latest = booking.resource.latest_cancellation

        if user.is_manager:
            if booking.start.date() <= now.date():
                raise Exception('This booking can not be updated/deleted. \n'
                                'Even as Manager, it should be done at least '
                                'one day before. Contact an Administrator if '
                                'there is any problem with this booking. ')
        if booking.start - dt.timedelta(hours=latest) < now:
            raise Exception('This booking can not be updated/deleted. \n'
                            'Should be %d hours in advance. ' % latest)

    def _modify_bookings(self, attrs, modifyFunc):
        """ Return one or many bookings if repeating event.
        Keyword Args:
            id: Id of the main booking
            modify_all: If True, all repeating bookings from this one will be
                returned
        """
        booking_id = attrs['id']
        modify_all = attrs.pop('modify_all', False)

        # Get the booking with the given id
        bookings = self.get_bookings(condition='id="%s"' % booking_id)

        if not bookings:
            raise Exception("There is no booking with ID=%s" % booking_id)

        booking = bookings[0]
        rid = booking.repeat_id

        result = [booking]

        if rid is not None:
            repeats = [
                b for b in self.get_bookings(condition='repeat_id="%s"' % rid)
                if b.start > booking.start
            ]
            if modify_all:
                result.extend(repeats)
            else:
                # If not modify_all, we should detach this booking from the
                # repeating series by setting its repeat_id to None
                # and generating a new repeat_id for the future events of the
                # series
                booking.repeat_id = None
                uid = str(uuid.uuid4())
                for b in repeats:
                    b.repeat_id = uid

        for b in result:
            modifyFunc(b)

        self.commit()

        return result

    def _session_data_path(self, session):
        return os.path.join(self._sessionsPath, session.data_path)


class RepeatRanges:
    """ Helper class to generate a series of events with start, end. """
    OPTIONS = {'weekly': 7, 'bi-weekly': 14}

    def __init__(self, frequency, attrs):
        days = self.OPTIONS.get(frequency, None)

        if days is None:
            raise Exception("Invalid repeat value '%s'" % frequency)

        self._delta = dt.timedelta(days=days)
        self._attrs = attrs

    def move(self):
        """ Increase the start, end range by the interal delta. """
        self._attrs['start'] += self._delta
        self._attrs['end'] += self._delta

