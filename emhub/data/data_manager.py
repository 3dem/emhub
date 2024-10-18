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

import datetime as dt
import os
import uuid
import json
from collections import defaultdict

import sqlalchemy
from emtools.utils import Pretty

from emhub.utils import datetime_from_isoformat, datetime_to_isoformat
from .data_db import DbManager
from .data_log import DataLog
from .data_models import create_data_models
from .processing import get_processing_project


class DataManager(DbManager):
    """ Main class that will manage the sessions and their information.
    """
    def __init__(self, dataPath, dbName='emhub.sqlite',
                 user=None, cleanDb=False, create=True, redis=None):
        self._dataPath = dataPath
        self._sessionsPath = os.path.join(dataPath, 'sessions')
        self._entryFiles = os.path.join(dataPath, 'entry_files')
        self._resourceFiles = os.path.join(dataPath, 'resource_files')

        # Initialize main database
        dbPath = os.path.join(dataPath, dbName)
        self.init_db(dbPath, cleanDb=cleanDb, create=create)

        self._lastSession = None
        self._user = user  # Logged user

        if create:
            # Create a separate database for logs
            logDbPath = dbPath.replace('.sqlite', '-logs.sqlite')
            self._db_log = DataLog(logDbPath, cleanDb=cleanDb)

            # Create sessions dir if not exists
            os.makedirs(self._sessionsPath, exist_ok=True)

        self.r = redis

    def _create_models(self):
        """ Function called from the init_db method. """
        create_data_models(self)

    def log(self, log_type, log_name, *args, **kwargs):
        log_user_id = None if self._user is None else self._user.id

        self._db_log.log(log_user_id, log_type, log_name,
                         *args, **kwargs)

    def get_logs(self):
        return self._db_log.get_logs()

    # ------------------------- USERS ----------------------------------
    def get_user_extra_roles(self):
        return self.get_config('users').get('extra_roles', [])

    def get_staff_units(self):
        for role in self.get_user_extra_roles():
            if role.startswith('staff-'):
                yield role.replace('staff-', '')

    @property
    def USER_ROLES(self):
        roles = list(self.User.ROLES)
        roles.extend(self.get_user_extra_roles())
        return roles

    def create_admin(self, password='admin'):
        """ Create special user 'admin'. """
        admin = self.create_user(username='admin',
                                 email='admin@emhub.org',
                                 password=password,
                                 name='admin',
                                 roles=['admin'],
                                 pi_id=None)

        if self._user is None:
            self._user = admin

    def create_basic_users(self):
        users = []
        for user in ['admin', 'manager', 'user']:
            users.append(self.create_user(
                username=user,
                email=user + '@emhub.org',
                password=user,
                name=user,
                roles=[user],
                pi_id=None
            ))
        if self._user is None:
            self._user = users[0]


    def create_user(self, **attrs):
        """ Create a new user in the DB. """
        if self._user is not None and not self._user.is_manager:
            raise Exception("Only 'managers' or 'admins' can register new users.")

        def __check_uniq(attrName):
            attr = attrs.get(attrName, None)
            if not attr or not attr.strip():
                raise Exception(f"Input '{attrName}' should have a value")
            if self.get_user_by(**{attrName: attr}) is not None:
                raise Exception(f"There is already an existing user with "
                                f"'{attrName}={attr}' and it should be unique.")

        __check_uniq('email')
        __check_uniq('username')

        #self.get_user_by(id=attrs['id'])
        attrs['password_hash'] = self.User.create_password_hash(attrs['password'])
        del attrs['password']

        user = self.__create_item(self.User, **attrs)
        return user

    def update_user(self, **attrs):
        """ Update an existing user. """
        if 'password' in attrs:
            attrs['password_hash'] = self.User.create_password_hash(attrs['password'])
            del attrs['password']

        if 'roles' in attrs and not self._user.is_admin:
            # Only 'admin' users can add or remove 'admin' role
            if 'admin' in attrs['roles']:
                raise Exception("Only 'admin' users can assign 'admin' role.")
            else:
                user = self.get_user_by(id=attrs['id'])
                if user.is_admin:
                    raise Exception("Only 'admin' users can remove 'admin' role.")

        return self.__update_item(self.User, **attrs)

    def delete_user(self, **attrs):
        """ Delete a given user. """
        uid = attrs['id']

        # Check that there are not bookings related to this user
        bookings = self.get_user_bookings(uid)

        def _error(msg):
            raise Exception(f"This user can not be deleted, {msg}.")

        if bookings:
            _error("deleted, there are associated bookings. ")

        user = self.get_user_by(id=uid)

        if user.lab_members:
            _error("there are associated lab members.")

        self.delete(user)
        return user

    def get_users(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.User,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_user_by(self, **kwargs):
        """ This should return a single user or None. """
        return self.__item_by(self.User, **kwargs)

    def get_user_group(self, user):
        pi = user.get_pi()
        user_groups = self.get_config('sessions')['groups']
        return user_groups.get(pi.email, 'No-group')

    # ---------------------------- FORMS ---------------------------------
    def create_form(self, **attrs):
        return self.__create_item(self.Form, **attrs)

    def update_form(self, **attrs):
        cache = attrs.pop('cache', True)
        form = self.__update_item(self.Form, **attrs)
        # Check if we need to update Redis cache
        if cache and self.r is not None and form.name.startswith('config:'):
            configName = form.name.replace('config:', '')
            self.set_rconfig(configName, form.definition)

        return form

    def delete_form(self, **attrs):
        form = self.__item_by(self.Form, id=attrs['id'])
        self.delete(form)
        return form

    def get_forms(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Form,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_form_by(self, **kwargs):
        """ This should return a single Form or None. """
        return self.__item_by(self.Form, **kwargs)

    def get_form_by_name(self, formName):
        """ Shortcut method to load a form from db given its name.
        If the form does not exist, an Exception is thrown.
        """
        form = self.get_form_by(name=formName)
        if form is None:
            print(">>>>> ERROR: Missing Form '%s' from the database!!!" % formName)
        return form

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

    def delete_resource(self, **attrs):
        resource = self.__item_by(self.Resource, id=attrs['id'])

        for b in self.get_bookings():
            if b.resource_id == resource.id:
                raise Exception("Can not delete resource, there are existing "
                                "bookings.")
        self.delete(resource)
        return resource

    def get_resource_image_path(self, resource, filename=None):
        fn = filename or resource.image
        return os.path.join(self._resourceFiles,
                            'resource-image-%06d-%s' % (resource.id, fn))

    # ---------------------------- APPLICATIONS --------------------------------
    def create_template(self, **attrs):
        return self.__create_item(self.Template, **attrs)

    def get_templates(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Template,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_template_by(self, **kwargs):
        """ Return a single Template or None. """
        return self.__item_by(self.Template, **kwargs)

    def update_template(self, **attrs):
        return self.__update_item(self.Template, **attrs)

    def delete_template(self, **attrs):
        template = self.__item_by(self.Template, id=attrs['id'])
        self.delete(template)
        return template

    def create_application(self, **attrs):
        def __create(attrs):
            pi_to_add = attrs.pop('pi_to_add', [])
            pi_to_remove = attrs.pop('pi_to_remove', [])
            application = self.Application(**attrs)
            self.__update_application_pi(application, pi_to_add, pi_to_remove)
            return application

        attrs['special_create'] = __create
        attrs['created'] = self.now()
        attrs['invoice_reference'] = ''  #FIXME
        if 'creator' not in attrs:
            attrs['creator_id'] = self._user.id
        return self.__create_item(self.Application, **attrs)

    def get_applications(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Application,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_visible_applications(self):
        return [a for a in self.get_applications()
                if a.allows_access(self._user)]

    def get_application_by(self, **kwargs):
        """ Return a single Application or None. """
        return self.__item_by(self.Application, **kwargs)

    def delete_application(self, **attrs):
        application = self.__item_by(self.Application, id=attrs['id'])
        self.delete(application)
        return application

    def __update_application_pi(self, application, pi_to_add, pi_to_remove):
        errorMsg = ""
        pi_list = application.pi_list

        def _get_pi(pid):
            pi = self.get_user_by(id=int(pid))

            if pi is None:
                errorMsg += "\nInvalid user id: %s" % pid
            elif not pi.is_pi:
                errorMsg += "\nUser %s is not " % pid
            else:
                return pi
            return None

        to_add = []
        for pid in pi_to_add:
            pi = _get_pi(pid)

            if pi is None:
                continue

            if pi in pi_list:
                errorMsg += "\nPI %s is already in the Application" % pi.name
                continue

            to_add.append(pi)

        to_remove = []
        for pid in pi_to_remove:
            pi = _get_pi(pid)

            if pi is None:
                continue

            if pi not in pi_list:
                errorMsg += "\nPI %s is not in the Application" % pi.name
                continue

            to_remove.append(pi)

        if errorMsg:
            raise Exception(errorMsg)

        for pi in to_remove:
            application.users.remove(pi)

        for pi in to_add:
            application.users.append(pi)

    def __preprocess_application(self, application, attrs):
        pi_to_add = attrs.pop('pi_to_add', [])
        pi_to_remove = attrs.pop('pi_to_remove', [])
        self.__update_application_pi(application, pi_to_add, pi_to_remove)

    def update_application(self, **attrs):
        """ Update a given Application with new attributes.

        Keyword arguments:
            pi_to_add: ids of PI users to add to the Application.
            pi_to_remove: ids of PI users to remove from the Application
        """
        attrs['special_update'] = self.__preprocess_application
        return self.__update_item(self.Application, **attrs)

    # ---------------------------- BOOKINGS -----------------------------------
    def create_booking(self,
                       check_min_booking=True,
                       check_max_booking=True,
                       **attrs):
        # We might create many bookings if repeat != 'no'
        repeat_value = attrs.get('repeat_value', 'no')
        modify_all = attrs.pop('modify_all', None)
        # We should accept empty title for booking
        attrs['title'] = attrs.get('title', None) or ''
        bookings = []

        def _add_booking(attrs):
            b = self.create_basic_booking(attrs)
            self.__validate_booking(b,
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

        # Insert all created bookings
        for b in bookings:
            self._db_session.add(b)
        self.commit()

        # Log operations after create
        self.log('operation', 'create_Booking',
                 check_min_booking=check_min_booking,
                 check_max_booking=check_max_booking,
                 modify_all=modify_all,
                 repeat_stop=repeat_value,
                 attrs=self.json_from_dict(attrs))

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
            self.__check_cancellation(b, attrs)
            for attr, value in attrs.items():
                if attr != 'id':
                    setattr(b, attr, value)
            if repeater:
                repeater.move()  # move start, end for repeating bookings

            self.__validate_booking(b)

        result = self._modify_bookings(attrs, update)

        self.log('operation', 'update_Booking',
                 attrs=self.json_from_dict(attrs))

        return result

    def get_booking_by(self, **kwargs):
        """ Return a single Application or None. """
        return self.__item_by(self.Booking, **kwargs)

    def get_bookings(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Booking,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_bookings_range(self, start, end, resource=None):
        """ Shortcut function to retrieve a range of bookings. """
        # JMRT: We need to convert the start and end to UTC before getting the range
        newStart = self.date(start.date()).astimezone(dt.timezone.utc)
        newEnd = self.date(end.date()).astimezone(dt.timezone.utc) + dt.timedelta(days=1)
        rangeStr = datetime_to_isoformat(newStart), datetime_to_isoformat(newEnd)
        startBetween = "(start>='%s' AND start<='%s')" % rangeStr
        endBetween = "(end>='%s' AND end<='%s')" % rangeStr
        rangeOver = "(start<='%s' AND end>='%s')" % rangeStr
        conditionStr = "(%s OR %s OR %s)" % (startBetween, endBetween, rangeOver)

        if resource is not None:
            conditionStr += " AND resource_id=%s" % resource.id

        def in_range(b):
            s, e = b.start, b.end
            return ((s >= newStart and s <= newEnd) or
                    (e >= newStart and e <= newEnd) or
                    (s <= newStart and e >= newEnd))

        bookings = [b for b in self.get_bookings(condition=conditionStr, orderBy='start')
                    if in_range(b)]

        return bookings

    def get_user_bookings(self, uid):
        """ Return bookings related to this user.
        User might be creator, owner or operator of the booking.
        """
        condStr = f"owner_id={uid} OR operator_id={uid} OR creator_id={uid}"
        return self.get_bookings(condition=condStr)

    def get_next_bookings(self, user):
        """ Retrieve upcoming (from now) bookings for this user. """
        conditionStr = "start>='%s'" % datetime_to_isoformat(self.now())
        if user:
            conditionStr += " AND owner_id=%s" % user.id

        return self.get_bookings(condition=conditionStr, orderBy='start')

    def delete_booking(self, **attrs):
        """ Delete one or many bookings (in case of repeating events).

        Keyword Args:
            id: the of the booking to be deleted
            modify_all: Boolean flag in case the booking is a repeating event.
                If True, all bookings from this one, will be also deleted.
        """
        def delete(b):
            self.__check_cancellation(b)
            if b.session:
                raise Exception("Can not delete Booking, there are existing "
                                "sessions.")
            self.delete(b, commit=False)

        result = self._modify_bookings(attrs, delete)

        self.log('operation', 'delete_Booking',
                 attrs=self.json_from_dict(attrs))

        return result

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
    def __get_section(self, sectionName):
        form = self.get_form_by(name='sessions_config')
        if form:
            formDef = form.definition
            for s in formDef['sections']:
                if s['label'] == sectionName:
                    return formDef, s
        return None

    def __iter_config_params(self, configName):
        section = self.__get_section(configName)
        if section:
            for p in section[1]['params']:
                yield p

    def __get_session_dict(self, section):
        return {p['label']: p['value']
                for p in self.__iter_config_params(section)}

    def get_session_counter(self, group_code):
        return int(self.__get_session_dict('counters').get(group_code, 1))

    def update_session_counter(self, group_code, new_counter):
        # Update counter for this session group
        formDef, section = self.__get_section('counters')

        found = False
        for p in section['params']:
            if p['label'] == group_code:
                p['value'] = new_counter
                found = True
        if not found:
            section['params'].append({'label': group_code,
                                      'value': new_counter})

        form = self.get_form_by_name('sessions_config')
        self.update_form(id=form.id, definition=formDef, cache=False)

    def get_session_cameras(self, resourceId):
        cameras = []
        for p in self.__iter_config_params('cameras'):
            if int(p['id']) == resourceId:
                cameras = p['enum']['choices']

        return cameras

    def get_session_folders(self):
        return self.__get_session_dict('folders')

    def get_session_data_deletion(self, group_code):
        return int(self.__get_session_dict('data_deletion').get(group_code, 0))

    def get_session_data_path(self, session):
        return os.path.join(self._sessionsPath, session.data_path)

    def get_new_session_info(self, booking_id):
        # FIXME: This is specific to SLL and needs cleanup/refactoring
        """ Return the name for the new session, base on the booking and
        the previous sessions counter (stored in Form 'counters').
        """
        b = self.get_bookings(condition="id=%s" % booking_id)[0]
        a = b.application
        code = 'fac' if a is None else a.code.lower()
        sep = '' if len(code) == 3 else '_'
        c = self.get_session_counter(code)

        return {
            'code': code,
            'counter': c,
            'name': '%s%s%05d' % (code, sep, c)
        }

    def get_sessions(self, condition=None, orderBy=None, asJson=False):
        """ Returns a list.
        condition example: text("id<:value and name=:name")
        """
        return self.__items_from_query(self.Session,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_session_by(self, **kwargs):
        """ This should return a single Session or None. """
        return self.__item_by(self.Session, **kwargs)

    def create_session(self, **attrs):
        """ Add a new session row. """
        create_data = attrs.pop('create_data', False)
        check_raw = attrs.pop('check_raw', True)
        tasks = attrs.pop('tasks', [])

        b = self.get_booking_by(id=int(attrs['booking_id']))
        attrs['resource_id'] = b.resource.id
        attrs['operator_id'] = b.owner.id if b.operator is None else b.operator.id

        if 'start' not in attrs:
            attrs['start'] = b.start

        if 'status' not in attrs:
            attrs['status'] = 'active'

        # If the session name is not provided,
        # it will be picked from the booking/group/application
        if 'name' not in attrs:
            session_info = self.get_new_session_info(b.id)
            attrs['name'] = session_info['name']
        else:
            session_info = None

        s = self.get_session_by(name=attrs['name'])
        if s is not None:
            raise Exception("Session name already exist, "
                            "choose a different one.")

        extra = attrs.get('extra', {})
        raw_folder = extra['raw'].get('path', '')
        if check_raw and raw_folder and not os.path.exists(raw_folder):
            raise Exception(f"Missing Raw data folder '{raw_folder}'")

        otf = extra['otf']
        otf_folder = otf.get('path', '')
        if otf_folder:
            data_path = otf_folder
            extra['otf'] = {'path': otf_folder}

        session = self.__create_item(self.Session, **attrs)

        # Update counter for this session group
        if session_info:
            self.update_session_counter(session_info['code'],
                                        session_info['counter'] + 1)

        for worker, args in tasks:
            args['session_id'] = session.id
            # Update some values for the task
            task = {
                'name': 'session',
                'args': args
            }
            self.get_worker_stream(worker).create_task(task)

        return session

    def update_session(self, **attrs):
        """ Update session attrs. """
        otf_path = attrs.get('extra', {}).get('otf', {}).get('path', None)
        if otf_path:
            attrs['data_path'] = otf_path
        session = self.__update_item(self.Session, **attrs)

        # Update the session counter if it was modified
        name = session.name

        if session.is_code_counted:
            if '_' in name:
                code, counterStr = name.split('_')
            else:
                code = name[:3]
                counterStr = name[3:]

            c = self.get_session_counter(code)
            counter = int(counterStr)
            if c < counter:
                self.update_session_counter(code, counter + 1)

        return session

    def delete_session(self, **attrs):
        """ Remove a session row. """
        sessionId = attrs['id']
        session = self.Session.query.get(sessionId)
        data_path = self._session_data_path(session)
        self.delete(session)

        if os.path.exists(data_path) and os.path.isfile(data_path):
            os.remove(data_path)

        self.log("operation", "delete_Session",
                 attrs=self.json_from_dict(attrs))

        return session

    def get_processing_project(self, **kwargs):
        """ Create a Processing Project instance from a path.
        If entry_id is provided, we retrieve the path from there.
        """
        args = {}
        if 'path' in kwargs:
            project_path = kwargs['path']
            args['path'] = project_path
        elif 'entry_id' in kwargs:
            entry_id = int(kwargs['entry_id'])
            entry = self.get_entry_by(id=entry_id)
            project_path = entry.extra['data']['project_path']
            args = {'entry_id': entry_id}
        elif 'session_id' in kwargs:
            session_id = int(kwargs['session_id'])
            session = self.get_session_by(id=session_id)
            project_path = session.data_path
            args = {'session_id': session_id}
        else:
            raise Exception("Expecting either 'session_id', 'entry_id' or 'path'"
                            "to load a project.")

        pp = get_processing_project(project_path)
        result = {'project': pp, 'args': args}

        if 'run_id' in kwargs:
            run_id = kwargs['run_id']
            result['run'] = pp.get_run(run_id)
            args['run_id'] = run_id
            
        return result


    def clear_session_data(self, **attrs):
        session = self.get_session_by(id=attrs['id'])
        data_path = self._session_data_path(session)
        if os.path.exists(data_path):
            os.remove(data_path)
        return session

    def update_session_extra(self, **attrs):
        session = self.get_session_by(id=attrs['id'])
        extra = dict(session.extra)
        extra.update(attrs['extra'])
        attrs['extra'] = extra

        # We usually update the extra from workers notification and
        # it is preferable to avoid logging the operation, that can be too much
        attrs['log_operation'] = False

        return self.update_session(**attrs)

    # -------------------------- WORKERS AND TASKS ----------------------------


    # -------------------------- INVOICE PERIODS ------------------------------
    def get_invoice_periods(self, condition=None, orderBy=None, asJson=False):
        """ Returns a list.
        condition example: text("id<:value and name=:name")
        """
        return self.__items_from_query(self.InvoicePeriod,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def create_invoice_period(self, **attrs):
        """ Add a new session row. """
        return self.__create_item(self.InvoicePeriod, **attrs)

    def update_invoice_period(self, **attrs):
        """ Update session attrs. """
        return self.__update_item(self.InvoicePeriod, **attrs)

    def delete_invoice_period(self, **attrs):
        """ Remove a session row. """
        return self.__delete_item(self.InvoicePeriod, **attrs)

    def get_invoice_period_by(self, **kwargs):
        """ This should return a single user or None. """
        return self.__item_by(self.InvoicePeriod, **kwargs)

    # ---------------------------- TRANSACTIONS -------------------------------
    def get_transactions(self, condition=None, orderBy=None, asJson=False):
        """ Returns a list.
        condition example: text("id<:value and name=:name")
        """
        return self.__items_from_query(self.Transaction,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def create_transaction(self, **attrs):
        """ Add a new session row. """
        return self.__create_item(self.Transaction, **attrs)

    def update_transaction(self, **attrs):
        """ Update session attrs. """
        return self.__update_item(self.Transaction, **attrs)

    def delete_transaction(self, **attrs):
        """ Remove a session row. """
        return self.__delete_item(self.Transaction, **attrs)

    def get_transaction_by(self, **kwargs):
        """ This should return a single user or None. """
        return self.__item_by(self.Transaction, **kwargs)

    # ---------------------------- PROJECTS ---------------------------------
    def __check_project(self, **attrs):
        if 'title' in attrs:
            if not attrs['title'].strip():
                raise Exception("Project title can not be empty")

        if 'user_id' in attrs:
            if not attrs['user_id']:
                raise Exception("Provide a valid User ID for the Project.")

        if status := attrs.get('status', None):
            s = status.strip()
            if not (s.startswith('special:') or s in self.Project.STATUS):
                raise Exception("Provide a valid status: active/inactive")

    def create_project(self, **attrs):
        if validate := attrs.pop('validate', True):
            self.__check_project(**attrs)

        now = self.now()
        attrs.update({
            'date': now,
            'creation_date': now,
            'creation_user_id': self._user.id,
            'last_update_date': now,
            'last_update_user_id': self._user.id,
        })
        return self.__create_item(self.Project, **attrs)

    def update_project(self, **attrs):
        self.__check_project(**attrs)

        attrs.update({
            'last_update_date': self.now(),
            'last_update_user_id': self._user.id,
        })
        return self.__update_item(self.Project, **attrs)

    def delete_project(self, **attrs):
        """ Remove a project. """
        project = self.get_project_by(id=attrs['id'])
        # Delete all entries of this project
        # (since I haven't configured cascade-delete in SqlAlchemy models)
        for e in project.entries:
            self.delete(e, commit=False)

        return self.__delete_item(self.Project, **attrs)

    def get_projects(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Project,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_project_by(self, **kwargs):
        """ This should return a single Resource or None. """
        return self.__item_by(self.Project, **kwargs)

    # ---------------------------- ENTRIES ---------------------------------
    def set_rconfig(self, configName, configData):
        """ Update configuration entry in Redis. """
        self.r.set(f'config:{configName}', json.dumps(configData))

    def get_rconfig(self, configName):
        return json.loads(self.r.get(f'config:{configName}'))

    def get_config(self, configName, default={}, cache=True):
        """ Find a form named config:configName and return
        the associated JSON definition.

        Args:
            configName: name of the entry to load.
            default: default value if the entry does not exist.
            cache: If true, will use Redis cache
            """
        rcache = self.r is not None and cache

        if rcache and self.r.exists(f'config:{configName}'):
            return self.get_rconfig(configName)

        form = self.get_form_by_name(f'config:{configName}')
        if not form:
            return default

        configData = form.definition
        if rcache:  # update the cache if enabled
            self.set_rconfig(configName, configData)

        return configData

    def get_form_definition(self, formName, default={}):
        """ Find a form named entry_form:formName and return
        the associated JSON definition. """
        form = self.get_form_by_name(f'entry_form:{formName}')
        return form.definition if form else default

    def update_config(self, configName, definition, cache=False):
        form = self.get_form_by_name(f'config:{configName}')
        self.update_form(id=form.id, definition=definition, cache=cache)

    def get_entry_config(self, entry_type):
        return self.get_config('projects')['entries'][entry_type]

    def get_projects_config_permissions(self):
        return {e['label']: e['value']
                for e in self.__get_project_config_section('permissions')}

    def user_can_create_projects(self, user):
        if user.is_manager:
            return True

        permissions = self.get_config("permissions")['projects']
        value = permissions['can_create']

        if (value == 'all'
            or (value == 'independent' and user.is_independent)):
            return True

        return False

    # def __check_entry(self, **attrs):
    #     if 'title' in attrs:
    #         if not attrs['title'].strip():
    #             raise Exception("Entry title can not be empty")

    def _validate_access_microscopes(self, entry):
        data = entry.extra['data']
        micId = data.get('microscope_id', None)
        if not (micId and self.get_resource_by(id=micId)):
            raise Exception("Please select microscope")
        dstr = data.get('suggested_date', '')
        try:
            sdate = self.date(dt.datetime.strptime(dstr, '%Y/%m/%d'))
            now = self.now()
            nowDay = self.date(dt.datetime.now())
            monday = nowDay - dt.timedelta(days=nowDay.weekday())
            fridayNoon = monday + dt.timedelta(days=4, hours=12)
            start = monday + dt.timedelta(weeks=1 if now < fridayNoon else 2)
            end = start + dt.timedelta(days=4)

            if sdate < start or sdate > end:
                raise Exception(f"Now requests are allowed for the following "
                                f"period: </br>{self.local_weekday(start)} - "
                                f"{self.local_weekday(end)}")

        except ValueError:
            raise Exception("Provide a valid suggested date")

    def __validate_entry(self, attrs):
        entry = self.Entry(**attrs)
        t = attrs['type']
        formDef = self.get_form_by_name(f"entry_form:{t}").definition if t != 'note' else {}
        config = formDef.get('config', {})
        validate = config.get('validation', '')
        if validate:
            validateFunc = getattr(self, validate)
            validateFunc(entry)
        return entry

    def create_entry(self, **attrs):
        if 'title' not in attrs:
            attrs['title'] = ''

        def __create(attrs):
            return self.__validate_entry(attrs)

        now = self.now()
        attrs.update({
            'date': attrs.get('date', now),
            'creation_date': now,
            'creation_user_id': self._user.id,
            'last_update_date': now,
            'last_update_user_id': self._user.id,
            'special_create': __create
        })

        return self.__create_item(self.Entry, **attrs)

    def update_entry(self, **attrs):
        # In some special cases, update_entry is called after create_entry,
        # and we don't want to validate in this case
        validate = attrs.pop('validate', True)
        attrs.update({
            'last_update_date': self.now(),
            'last_update_user_id': self._user.id,
        })
        if validate:
            self.__validate_entry(attrs)

        return self.__update_item(self.Entry, **attrs)

    def delete_entry(self, **attrs):
        """ Remove a session row. """
        return self.__delete_item(self.Entry, **attrs)

    def get_entries(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Entry,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_entry_by(self, **kwargs):
        """ This should return a single Resource or None. """
        return self.__item_by(self.Entry, **kwargs)

    def get_entry_path(self, entry, filename):
        return os.path.join(self._entryFiles,
                            'entry-file-%06d-%s' % (entry.id, filename))

    def get_entry_file(self, entry, file_key):
        """ Return the fn associated with a given entry. """
        fn = entry.extra['data'].get(file_key, None)

        if fn is None:
            raise Exception("Can not retrieve file for key '%s'" % file_key)

        return self.get_entry_path(entry, fn)

    def get_entry_files(self, entry):
        """ Return all values from the extra dict that are files. """
        data = entry.extra['data']

        def _is_file(k):
            if k.endswith('_file'):
                return True
            return False

        files = []

        def _add_from_dict(d):
            if not isinstance(d, dict):
                return

            for k, v in d.items():
                if isinstance(v, list):
                    for row in v:
                        _add_from_dict(row)
                elif _is_file(k):
                    files.append(self.get_entry_path(entry, v))

        _add_from_dict(data)
        return files

    # ---------------------------- PUCKS ---------------------------------
    def create_puck(self, **attrs):
        return self.__create_item(self.Puck, **attrs)

    def update_puck(self, **attrs):
        return self.__update_item(self.Puck, **attrs)

    def delete_puck(self, **attrs):
        return self.__delete_item(self.Puck, **attrs)

    def get_pucks(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Puck,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_puck_by(self, **kwargs):
        return self.__item_by(self.Puck, **kwargs)

    # --------------- Internal implementation methods -------------------------
    def get_universities_dict(self):
        formDef = self.get_form_by_name('universities').definition
        return {p['value']: p['label'] for p in formDef['params']}

    def __create_item(self, ModelClass, **attrs):
        special_create = attrs.pop('special_create', None)
        jsonArgs = self.json_from_dict(attrs)

        new_item = special_create(attrs) if special_create else ModelClass(**attrs)

        self._db_session.add(new_item)
        self.commit()
        self.log('operation', 'create_%s' % ModelClass.__name__, attrs=jsonArgs)

        return new_item

    def __items_from_query(self, ModelClass,
                           condition=None, orderBy=None, asJson=False):
        query = self._db_session.query(ModelClass)

        if condition is not None:
            query = query.filter(sqlalchemy.text(condition))

        if orderBy is not None:
            query = query.order_by(orderBy)

        result = query.all()
        return [s.json() for s in result] if asJson else result

    def __item_by(self, ModelClass, **kwargs):
        query = self._db_session.query(ModelClass)
        return query.filter_by(**kwargs).one_or_none()

    def __update_item(self, ModelClass, **kwargs):
        special_update = kwargs.pop('special_update', None)

        # Allow to pass log_operation = False to avoid logging
        # This may be useful for workers notification that add too many
        # entries in the logs and are not necessary
        log_operation = kwargs.pop('log_operation', True)

        jsonArgs = self.json_from_dict(kwargs)

        item_id = kwargs.pop('id')
        extra_replace = kwargs.pop('extra_replace', False)

        item = self.__item_by(ModelClass, id=item_id)
        if item is None:
            raise Exception("Not found item %s with id %s"
                            % (ModelClass.__name__, kwargs['id']))

        if special_update:
            special_update(item, kwargs)

        for attr, value in kwargs.items():
            if attr == 'extra' and not extra_replace:
                extra = dict(item.extra)
                extra.update(value)
                value = extra

            setattr(item, attr, value)
        self.commit()

        if log_operation:
            self.log('operation', 'update_%s' % ModelClass.__name__, attrs=jsonArgs)

        return item

    def __delete_item(self, ModelClass, **kwargs):
        """ Remove an item from a Db model table. """
        item = self.__item_by(ModelClass, id=kwargs['id'])
        self.delete(item)

        self.log("operation", "delete_%s" % ModelClass.__name__,
                 attrs=self.json_from_dict(kwargs))

        return item

    def __matching_project(self, applications, auth_json):
        """ Return True if there is a project code in auth_json. """
        if not auth_json or 'applications' not in auth_json:
            return False

        json_codes = auth_json['applications']

        return any(p.code in json_codes for p in applications)

    # ------------------- PERMISSIONS helper functions -----------------------------
    def check_user_access(self, permissionKey):
        """ Return True if the current logged user has any of the roles
        defined in the config for 'permissionKey'.
        """
        perms = self.get_config('permissions').get('content', {})
        return self._user.has_any_role(perms.get(permissionKey, []))

    def check_resource_access(self, resource, permissionKey):
        """ Check if the user has permission to access bookings for this
        resource based on the resource tags and user's roles. """
        # FIXME: Now only checking if 'user' in permissions, not based on roles
        if self._user.is_manager:
            return True

        perms = self.get_config('permissions')
        return (self._user.can_book_resource(resource) or True and
                any(t in resource.tags and 'user' in u
                    for t, u in perms.get(permissionKey, {}).items()))

    # ------------------- BOOKING helper functions -----------------------------
    def create_basic_booking(self, attrs, **kwargs):
        if 'type' not in attrs:
            attrs['type'] = 'booking'

        b = self.Booking(**attrs)

        def _set_user(key):
            keyid = key + '_id'
            if keyid not in attrs:
                setattr(b, keyid, self._user.id)
                setattr(b, key, self._user)

        _set_user('creator')
        _set_user('owner')
        _set_user('operator')

        return b

    def __validate_booking(self, booking, **kwargs):
        r = self.get_resource_by(id=booking.resource_id)

        if r is None:
            raise Exception("Select a valid Resource for this booking.")

        check_min_booking = kwargs.get('check_min_booking', True)
        check_max_booking = kwargs.get('check_max_booking', True)

        # Booking starting date should be before ending date
        if booking.start >= booking.end:
            raise Exception("The booking 'end' should be after the 'start'. ")

        user = self._user
        # The following validations do not apply for managers
        if not user.is_manager:
            if not self.check_resource_access(r, 'create_booking'):
                raise Exception("Users can not create/modify bookings for "
                                "this type of resource.")

            # Selected resource should be active
            if not r.is_active:
                raise Exception("Selected resource is inactive now. ")

            # Booking can not be made in the past
            if (booking.start.date() < self.now().date() and
                    not self.check_resource_access(r, 'past_bookings')):
                raise Exception("The booking 'start' can not be in the past. ")

            # Booking time should be bigger than the minimum for this resource
            if check_min_booking and r.min_booking > 0:
                mm = dt.timedelta(minutes=int(r.min_booking * 60))
                if booking.duration < mm:
                    raise Exception("The duration of the booking is less that "
                                    "the minimum specified for the resource. ")

            # Booking time should be less than the maximum for this resource
            if booking.type == 'booking' and check_max_booking and r.max_booking > 0:
                mm = dt.timedelta(minutes=int(r.max_booking * 60))
                if booking.duration > mm:
                    raise Exception("The duration of the booking is greater that "
                                    "the maximum allowed for the resource. ")

            # Validate if there are restrictions in max number of bookings for
            # this type of resource or similar ones (same tags)
            pending = self.__get_session_dict('pending_bookings')
            nextBookings = None
            for tagName, maxPending in pending.items():
                m = int(maxPending)
                if m > 0 and tagName in r.tags:
                    # Only retrieve the next bookings when it is required
                    if nextBookings is None:
                        nextBookings = self.get_next_bookings(user)
                    count = sum(1 for b in nextBookings if tagName in b.resource.tags)
                    if count >= m:
                        raise Exception("You already reached the maximum number"
                                        " of pending bookings for resource tag "
                                        "'%s'" % tagName)

        s, e = booking.start, booking.end
        week = dt.timedelta(days=7)
        overlap = self.get_bookings_range(s - week, e + week, resource=r)

        app = None

        if not booking.is_slot:
            # Check there is not overlapping with other non-slot events
            overlap_noslots = [b for b in overlap
                               if not b.is_slot and booking.overlap(b)]
            if overlap_noslots:
                raise Exception("Booking is overlapping with other events: %s"
                                % overlap_noslots)

            overlap_slots = [b for b in overlap
                             if b.is_slot and booking.overlap_slot(b)]

            # Always try to find the Application to set in the booking unless
            # the owner is a manager
            owner = self.get_user_by(id=booking.owner_id)

            if not owner.is_manager:
                apps = owner.get_applications()
                n = len(apps)

                if n == 0 and r.requires_application:
                    raise Exception("User %s has no active application"
                                    % owner.name)

                # Let's try to find an application that allows the owner to book
                def find_app():
                    for b in overlap_slots:
                        for a in apps:
                            if b.application_in_slot(a):
                                return a

                    for a in apps:
                        if a.no_slot(r.id):
                            return a

                    return None

                app = find_app()

                # In the case of a manager updating a booking, the manager
                # can do the booking despise the SLOTs and Application rules
                if app is None and user.is_manager and apps:
                    app = apps[0]

                user_can_book = any(user.can_book_slot(s) for s in overlap_slots)

                if (app is None and not user.is_manager
                    and not user_can_book and r.requires_slot):
                    raise Exception("You do not have permission to book "
                                    "outside slots for this resource or have not "
                                    "access to the given slot. ")

        if app is not None:
            booking.application_id = app.id
            count = self.count_booking_resources([app.id],
                                                 resource_tags=r.tags.split())
            for tagKey, tagCount in count[app.id].items():
                alloc = app.get_quota(tagKey)
                if alloc:  # if different from None or 0, then check
                    if tagCount + booking.days > alloc:
                        raise Exception("Exceeded number of allocated days "
                                        "for application %s on resource tag '%s'"
                                        % (app.code, tagKey))
        else:
            booking.application_id = None

    def __check_cancellation(self, booking, attrs=None):
        """ Check if this booking can be updated or deleted.
        Normal users can only delete or modify the booking up to X hours
        before the starting time. The amount of hours is defined by the
        booking latest_cancellation property.
        Managers can change bookings even the same day and only
        Administrators can change past events.
        This function will raise an exception if a condition is not meet.
        """
        user = self._user
        if user.is_manager:
            return  # admin can cancel/modify at any time

        if not self.check_resource_access(booking.resource, 'delete_booking'):
            raise Exception("Users can not delete/modify bookings for "
                            "this type of resource.")

        # latest_cancellation might be defined as a measure to prevent users
        # to delete bookings before that amount of time
        # latest_cancellation = 0 means that there is not restriction
        if latest := booking.resource.latest_cancellation:
            def _error(action):
                raise Exception('This booking can not be %s. \n'
                                'Should be %d hours in advance. '
                                % (action, latest))

            start, end = booking.start, booking.end
            if start - dt.timedelta(hours=latest) < self.now():
                if attrs:  # Update case, where we allow modification except dates
                    if start != attrs['start'] or end != attrs['end']:
                       _error('updated')
                else:  # Delete case
                    _error('deleted')

    def _modify_bookings(self, attrs, modifyFunc):
        """ Return one or many bookings if repeating event.
        Params:
            attrs:
                id: Id of the main booking
                modify_all: If True, all repeating bookings from this one will be
                returned
        """
        booking_id = attrs['id']
        modify_all = attrs.pop('modify_all', 'no') == 'yes'

        # Get the booking with the given id
        booking = self.get_booking_by(id=booking_id)

        if not booking:
            raise Exception("There is no booking with ID=%s" % booking_id)

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
        if not session.data_path:
            return ''
        return os.path.join(self._sessionsPath, session.data_path)

    class WorkerStream:
        """ Helper class to centralize functions related to a
        Redis stream for a worker machine.
        """
        def __init__(self, worker, dm):
            self.worker = worker
            self.name = f"{worker}:tasks"
            self.dm = dm
            self.r = dm.r

        def stream_exists(self):
            return self.r.exists(self.name)

        def group_exists(self):
            groups = self.r.xinfo_groups(self.name)
            return len(groups) > 0 and groups[0]['name'] == 'group'

        def connect(self):
            # Create new group and stream for this worker if not exists
            if not self.stream_exists():
                return self.r.xgroup_create(self.name, 'group', mkstream=True)
            elif not self.group_exists():
                return self.r.xgroup_create(self.name, 'group')

            return True

        def create_task(self, task):
            task['args'] = json.dumps(task['args'])
            task_id = self.r.xadd(self.name, task)
            # Create a stream for this task history
            self.update_task(task_id, {'created': Pretty.now()})
            return task_id

        def update_task(self, task_id, event):
            self.r.xadd(f"task_history:{task_id}", event,
                        maxlen=event.get('maxlen', None))
            if 'done' in event:
                self.finish_task(task_id)

        def finish_task(self, task_id):
            self.r.xack(self.name, 'group', task_id)

        def delete_task(self, task_id):
            try:
                self.finish_task(task_id)
                self.r.xdel(self.name, task_id)
                self.r.delete(f"task_history:{task_id}")
            except:
                return 0
            return 1

        def get_new_tasks(self):
            results = self.r.xreadgroup('group', self.worker, {self.name: '>'},
                                        block=60000)
            new_tasks = []
            if results:
                for task_id, task in results[0][1]:
                    task['id'] = task_id
                    new_tasks.append({
                        'id': task_id,
                        'name': task['name'],
                        'args': json.loads(task.get('args', '{}')),
                })
            return new_tasks

        def get_all_tasks(self):
            tasks = []
            pending = self.get_pending_tasks()

            for tid, fields in self.r.xrange(self.name):
                histKey = f"task_history:{tid}"
                history = self.r.xlen(histKey)
                done = self.dm.is_task_done(tid)
                tasks.append({
                    'id': tid,
                    'name': fields['name'],
                    'args': json.loads(fields.get('args', '{}')),
                    'history': history,
                    'status': 'pending' if tid in pending else ('done' if done else ''),
                })
            return tasks

        def get_pending_tasks(self):
            pending = set()
            if self.stream_exists() and self.group_exists():
                n = self.r.xpending(self.name, 'group')['pending']
                for t in self.r.xpending_range(self.name, 'group', '-', '+', n):
                    pending.add(t['message_id'])

            return pending

    def get_hosts(self):
        """ Use Redis to cache hosts information, avoiding
        reading it from the config all the time. """
        self._hosts = getattr(self, '_hosts', self.get_config('hosts'))
        return self._hosts

    def connect_worker(self, worker, specs):
        now = self.now()
        self.get_worker_stream(worker, update=True).connect()
        hosts = self.get_hosts()
        w = hosts[worker]
        w.update({'specs': specs,
                  'connected': Pretty.datetime(now)})
        self.update_config('hosts', hosts, cache=True)

    def get_worker_stream(self, worker, update=False):
        host = self.get_hosts().get(worker, None)

        if host is None:
            raise Exception("Unregistered host %s" % worker)

        if update:
            host['updated'] = Pretty.now()

        return DataManager.WorkerStream(worker, self)

    def get_all_tasks(self):
        if self.r is None:
            return {}

        for k in self.get_hosts().keys():
            yield k, self.get_worker_stream(k).get_all_tasks()

    def get_task_history(self, task_id, count=None, reverse=True):
        taskHistoryKey = f"task_history:{task_id}"
        funcName = 'xrevrange' if reverse else 'xrange'
        result = getattr(self.r, funcName)(taskHistoryKey, count=count)
        return result

    def get_task_lastevent(self, task_id):
        history = self.get_task_history(task_id, count=1, reverse=True)
        return history[0] if history else None

    def is_task_done(self, task_id):
        last_event = self.get_task_lastevent(task_id)
        return 'done' in last_event[1] if last_event else False

    def get_task_lastupdate(self, task_id):
        last_event = self.get_task_lastevent(task_id)
        return self.dt_from_redis(last_event[0] if last_event else task_id)


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

