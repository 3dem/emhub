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
from collections import defaultdict

import sqlalchemy

from emhub.utils import datetime_from_isoformat, datetime_to_isoformat
from .data_db import DbManager
from .data_log import DataLog
from .data_models import create_data_models
from .data_session import H5SessionData


class DataManager(DbManager):
    """ Main class that will manage the sessions and their information.
    """
    def __init__(self, dataPath, dbName='emhub.sqlite',
                 user=None, cleanDb=False, create=True):
        self._dataPath = dataPath
        self._sessionsPath = os.path.join(dataPath, 'sessions')
        self._entryFiles = os.path.join(dataPath, 'entry_files')

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

    # ---------------------------- FORMS ---------------------------------
    def create_form(self, **attrs):
        return self.__create_item(self.Form, **attrs)

    def update_form(self, **attrs):
        return self.__update_item(self.Form, **attrs)

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
            raise Exception("Missing Form '%s' from the database!!!" % formName)

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

    def __update_application_pi(self, application, **kwargs):
        pi_to_add = []
        pi_to_remove = []

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

        for pid in kwargs.get('pi_to_add', []):
            pi = _get_pi(pid)

            if pi is None:
                continue

            if pi in pi_list:
                errorMsg += "\nPI %s is already in the Application" % pi.name
                continue

            pi_to_add.append(pi)

        for pid in kwargs.get('pi_to_remove', []):
            pi = _get_pi(pid)

            if pi is None:
                continue

            if pi not in pi_list:
                errorMsg += "\nPI %s is not in the Application" % pi.name
                continue

            pi_to_remove.append(pi)

        if errorMsg:
            raise Exception(errorMsg)

        for pi in pi_to_remove:
            application.users.remove(pi)

        for pi in pi_to_add:
            application.users.append(pi)

    def update_application(self, **attrs):
        """ Update a given Application with new attributes.
        Special case are:
            pi_to_add: ids of PI users to add to the Application.
            pi_to_remove: ids of PI users to remove from the Application
        """
        # We don't use the self__update_item method due to the
        # treatment of the pi_to_add/remove lists

        application = self.get_application_by(id=attrs['id'])

        if application is None:
            raise Exception("Application not found with id %s"
                            % (attrs['id']))

        self.__update_application_pi(application, **attrs)

        # Update application properties
        for attr, value in attrs.items():
            if attr not in ['id', 'pi_to_add', 'pi_to_remove']:
                setattr(application, attr, value)

        self.commit()
        self.log('operation', 'update_Application',
                 **self.json_from_dict(attrs))

        return application

    # ---------------------------- BOOKINGS -----------------------------------
    def create_booking(self,
                       check_min_booking=True,
                       check_max_booking=True,
                       **attrs):
        # We might create many bookings if repeat != 'no'
        repeat_value = attrs.get('repeat_value', 'no')
        modify_all = attrs.pop('modify_all', None)
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
            self.__check_cancellation(b)

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

    def get_bookings(self, condition=None, orderBy=None, asJson=False):
        return self.__items_from_query(self.Booking,
                                       condition=condition,
                                       orderBy=orderBy,
                                       asJson=asJson)

    def get_bookings_range(self, start, end, resource=None):
        """ Shortcut function to retrieve a range of bookings. """
        # JMRT: For some reason the retrieval of the date ranges is not working
        # as expected for the time. So we are taking on day before for the start
        # and one day after for the end and filter later
        newStart = (start - dt.timedelta(days=1)).replace(hour=23, minute=59)
        newEnd = (end + dt.timedelta(days=1)).replace(hour=0, minute=0)
        rangeStr = datetime_to_isoformat(newStart), datetime_to_isoformat(newEnd)

        startBetween = "(start>='%s' AND start<='%s')" % rangeStr
        endBetween = "(end>='%s' AND end<='%s')" % rangeStr
        rangeOver = "(start<='%s' AND end>='%s')" % rangeStr
        conditionStr = "(%s OR %s OR %s)" % (startBetween, endBetween, rangeOver)

        if resource is not None:
            conditionStr += " AND resource_id=%s" % resource.id

        def in_range(b):
            s, e = b.start, b.end
            return ((s >= start and s <= end) or
                    (e >= start and e <= end) or
                    (s <= start and e >= end))

        return [b for b in self.get_bookings(condition=conditionStr, orderBy='start')
                if in_range(b)]

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

        result = self._modify_bookings(attrs, delete)

        self.log('operation', 'delete_Booking',
                 attrs=self.json_from_dict(attrs))

        return  result

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
        formDef = self.get_form_by_name('sessions_config').definition
        for s in formDef['sections']:
            if s['label'] == sectionName:
                return formDef, s
        return None

    def __iter_config_params(self, configName):
        _, section = self.__get_section(configName)
        for p in section['params']:
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
        self.update_form(id=form.id, definition=formDef)

    def get_session_cameras(self, resourceId):
        cameras = []
        for p in self.__iter_config_params('cameras'):
            if int(p['id']) == resourceId:
                cameras = p['enum']['choices']

        return cameras

    def get_session_folders(self):
        return self.__get_session_dict('folders')

    def get_session_data_deletion(self, group_code):
        return int(self.__get_session_dict('data_deletion')[group_code])

    def get_session_processing(self):
        # Load processing options from the 'processing' Form
        form_proc = self.get_form_by_name('processing')

        processing = []
        for section in form_proc.definition['sections']:
            steps = []
            processing.append({'name': section['label'], 'steps': steps})
            for param in section['params']:
                steps.append({'name': param['label'], 'options': param['enum']['choices']})

        return processing

    def get_new_session_info(self, booking_id):
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
        b = self.get_bookings(condition="id=%s" % attrs['booking_id'])[0]
        attrs['resource_id'] = b.resource.id
        attrs['operator_id'] = b.owner.id if b.operator is None else b.operator.id

        if 'start' not in attrs:
            attrs['start'] = self.now()

        if 'status' not in attrs:
            attrs['status'] = 'pending'

        session_info = self.get_new_session_info(b.id)
        attrs['name'] = session_info['name']

        session = self.__create_item(self.Session, **attrs)

        # Let's update the data path after we know the id
        session.data_path = 'session_%06d.h5' % session.id

        self.commit()

        # Create empty hdf5 file
        if create_data:
            data = H5SessionData(self._session_data_path(session), mode='a')
            data.close()

        # Update counter for this session group
        self.update_session_counter(session_info['code'],
                                    session_info['counter'] + 1)

        return session

    def update_session(self, **attrs):
        """ Update session attrs. """
        session = self.__update_item(self.Session, **attrs)

        # Update the session counter if it was modified
        name = session.name

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

        if os.path.exists(data_path):
            os.remove(data_path)

        self.log("operation", "delete_Session",
                 attrs=self.json_from_dict(attrs))

        return session

    def load_session(self, sessionId, mode="r"):
        # if self._lastSession is not None:
        #     if self._lastSession.id == sessionId:
        #         return self._lastSession
        #     self._lastSession.data.close()

        session = self.Session.query.get(sessionId)
        session.data = H5SessionData(self._session_data_path(session), mode)
        return session

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

        if 'status' in attrs:
            if not attrs['status'].strip() in self.Project.STATUS:
                raise Exception("Provide a valid status: active/inactive")

    def create_project(self, **attrs):
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
        """ Remove a session row. """
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
    def __check_entry(self, **attrs):
        if 'title' in attrs:
            if not attrs['title'].strip():
                raise Exception("Entry title can not be empty")

        # if 'type' in attrs:
        #     entry_types = self.get_entry_types()
        #     if not attrs['type'].strip() in entry_types:
        #         raise Exception("Please provide a valid entry type: %s"
        #                         % entry_types)

    def create_entry(self, **attrs):
        self.__check_entry(**attrs)

        now = self.now()
        attrs.update({
            'date': now,
            'creation_date': now,
            'creation_user_id': self._user.id,
            'last_update_date': now,
            'last_update_user_id': self._user.id,
        })
        return self.__create_item(self.Entry, **attrs)

    def update_entry(self, **attrs):
        self.__check_entry(**attrs)

        attrs.update({
            'last_update_date': self.now(),
            'last_update_user_id': self._user.id,
        })
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

    def get_entry_file(self, entry, file_key, source=None):
        """ Return the filename associated with a given entry. """
        filename = source or entry.extra['data'].get(file_key, None)

        if filename is None:
            raise Exception("Can not retrieve filename without source or '%s' "
                            "entry. " % file_key)

        _, ext = os.path.splitext(filename)

        return os.path.join(self._entryFiles,
                            'entry-file-%06d-%s%s' % (entry.id, file_key, ext))

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
        return self.__item_by(self.Entry, **kwargs)

    # --------------- Internal implementation methods -------------------------
    def get_universities_dict(self):
        formDef = self.get_form_by_name('universities').definition
        return {p['label']: p['value'] for p in formDef['params']}

    def __create_item(self, ModelClass, **attrs):
        new_item = ModelClass(**attrs)
        self._db_session.add(new_item)
        self.commit()
        self.log('operation', 'create_%s' % ModelClass.__name__,
                 attrs=self.json_from_dict(attrs))

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
        item = self.__item_by(ModelClass, id=kwargs['id'])
        if item is None:
            raise Exception("Not found item %s with id %s"
                            % (ModelClass.__name__, kwargs['id']))

        for attr, value in kwargs.items():
            if attr != 'id':
                setattr(item, attr, value)
        self.commit()
        self.log('operation', 'update_%s' % ModelClass.__name__,
                 **self.json_from_dict(kwargs))

        return item

    def __delete_item(self, ModelClass, **kwargs):
        """ Remove an item from a Db model table. """
        item = self.__item_by(ModelClass, id=kwargs['id'])
        self.delete(item)

        self.log("operation", "delete_%s" % ModelClass.__name__,
                 **self.json_from_dict(kwargs))

        return item

    def __matching_project(self, applications, auth_json):
        """ Return True if there is a project code in auth_json. """
        if not auth_json or 'applications' not in auth_json:
            return False

        json_codes = auth_json['applications']

        return any(p.code in json_codes for p in applications)

    # ------------------- BOOKING helper functions -----------------------------
    def __create_booking(self, attrs, **kwargs):
        if 'creator_id' not in attrs:
            attrs['creator_id'] = self._user.id

        b = self.Booking(**attrs)
        self.__validate_booking(b, **kwargs)
        return b

    def __validate_booking(self, booking, **kwargs):
        # Check the booking time is bigger than the minimum booking time
        # specified in the resource settings
        r = self.get_resource_by(id=booking.resource_id)
        check_min_booking = kwargs.get('check_min_booking', True)
        check_max_booking = kwargs.get('check_max_booking', True)


        if booking.start >= booking.end:
            raise Exception("The booking 'end' should be after the 'start'. ")

        user = self._user

        # The following validations do not apply for managers
        if not user.is_manager:
            if not r.is_active:
                raise Exception("Selected resource is inactive now. ")

            if booking.start.date() < self.now().date():
                raise Exception("The booking 'start' can not be in the past. ")

            if check_min_booking and r.min_booking > 0:
                mm = dt.timedelta(minutes=int(r.min_booking * 60))
                if booking.duration < mm:
                    raise Exception("The duration of the booking is less that "
                                    "the minimum specified for the resource. ")

            if booking.type == 'booking' and check_max_booking and r.max_booking > 0:
                mm = dt.timedelta(minutes=int(r.max_booking * 60))
                if booking.duration > mm:
                    raise Exception("The duration of the booking is greater that "
                                    "the maximum allowed for the resource. ")

        overlap = self.get_bookings_range(booking.start,
                                          booking.end,
                                          resource=r)

        app = None

        if not booking.is_slot:
            # Check there is not overlapping with other non-slot events
            overlap_noslots = [b for b in overlap
                               if not b.is_slot and b.id != booking.id]
            if overlap_noslots:
                raise Exception("Booking is overlapping with other events: %s"
                                % overlap_noslots)

            overlap_slots = [b for b in overlap
                             if b.is_slot and b.id != booking.id]

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

        if (not self._user.is_manager
            and booking.start - dt.timedelta(hours=latest) < now):
            raise Exception('This booking can not be updated/deleted. \n'
                            'Should be %d hours in advance. ' % latest)

    def _modify_bookings(self, attrs, modifyFunc):
        """ Return one or many bookings if repeating event.
        Params:
            attrs:
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

