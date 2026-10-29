"""
'Booking system' MCP tools: users, resources (instruments), bookings,
sessions and projects. Registered by :func:`register_tools`, called from
``emhub.mcp.server``.

Read tools and booking tools (create/update/cancel) are always registered,
EMhub validates them with the permissions of the logged in user (who can
book which instrument, cancellation window, pending booking limits, ...).
Tools managing users, resources and sessions are only registered when
``allow_admin`` is True.
"""

from typing import Optional

from mcp.types import ToolAnnotations

from .client import EmhubMcpError, to_utc_iso

READ = ToolAnnotations(readOnlyHint=True)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False)
DESTRUCTIVE = ToolAnnotations(readOnlyHint=False, destructiveHint=True)

USER_FIELDS = ['id', 'username', 'name', 'email', 'roles', 'status', 'pi_id']
SESSION_FIELDS = ['id', 'name', 'start', 'end', 'status', 'data_path',
                  'resource_id', 'booking_id', 'operator_id']
PROJECT_FIELDS = ['id', 'date', 'status', 'title', 'user_id',
                  'last_update_date']

def _one(items, what, item_id):
    if not items:
        raise EmhubMcpError(f"No {what} found with id={item_id}")
    return items[0]


def _dates(attrs):
    """ Convert 'start'/'end' input dates to UTC ISO format. """
    for k in ('start', 'end'):
        if attrs.get(k):
            attrs[k] = to_utc_iso(attrs[k])
    return attrs


def _given(**kwargs):
    """ Dict with only the arguments that were provided. """
    return {k: v for k, v in kwargs.items() if v is not None}


def register_tools(mcp, client, allow_admin=False):
    """ Register the booking-system tools on the given MCP server.

    Args:
        mcp: The ``MCPServer`` (mcp 2.x) or ``FastMCP`` (mcp 1.x) instance.
        client: A connected ``EmhubMcpClient``.
        allow_admin (bool): Whether to also register the admin tools.
    """

    # ------------------------- Read tools ---------------------------------
    @mcp.tool(annotations=READ)
    def booking_whoami() -> dict:
        """ Return the EMhub user this server is logged in as (id, username,
        name, email, roles, pi_id) and whether admin tools are available. """
        u = client.current_user
        info = {k: u.get(k) for k in USER_FIELDS}
        info['admin_tools'] = allow_admin
        return info

    @mcp.tool(annotations=READ)
    def booking_list_resources(only_active: bool = True) -> list[dict]:
        """ List EMhub resources: the instruments (microscopes, FIB-SEMs,
        prep instruments, ...) that can be booked. Each resource has an id,
        name, status, tags and an 'extra' dict with booking settings
        (min/max booking hours, latest cancellation, requires_slot, ...).

        Args:
            only_active: Only return resources with status 'active'.
        """
        return client.call('get_resources',
                           condition="status='active'" if only_active else None,
                           orderBy='name')

    @mcp.tool(annotations=READ)
    def booking_list_bookings(start: str, end: str,
                              resource_id: Optional[int] = None,
                              owner_id: Optional[int] = None) -> list[dict]:
        """ List bookings overlapping a date range, as calendar events
        (id, title, resource id, start, end, type). Booking 'type' is
        'booking', 'slot' (reserved time for some groups), 'downtime',
        'maintenance' or 'special'. Titles of bookings from other labs may
        be hidden depending on the user permissions.

        Args:
            start: First day of the range, 'YYYY-MM-DD'.
            end: Last day of the range (included), 'YYYY-MM-DD'.
            resource_id: Only bookings of this resource (see
                booking_list_resources).
            owner_id: Only bookings owned by this user id (returns the
                full booking records instead of calendar events).
        """
        if owner_id is not None:
            cond = ("owner_id=%d AND end>='%s' AND start<='%s'"
                    % (owner_id, to_utc_iso(start + ' 00:00'),
                       to_utc_iso(end + ' 23:59')))
            if resource_id is not None:
                cond += " AND resource_id=%d" % resource_id
            return client.call('get_bookings', condition=cond,
                               orderBy='start')

        events = client.call('get_bookings_range',
                             data={'start': start, 'end': end})
        if resource_id is not None:
            events = [e for e in events
                      if e.get('resource', {}).get('id') == resource_id]
        return events

    @mcp.tool(annotations=READ)
    def booking_get_booking(booking_id: int) -> dict:
        """ Get the full record of a booking: resource_id, owner_id,
        operator_id, creator_id, project_id, application_id, start, end,
        title, description, type, repeat info and extra. """
        return _one(client.call('get_bookings', condition='id=%d' % booking_id),
                    'booking', booking_id)

    @mcp.tool(annotations=READ)
    def booking_list_users(condition: Optional[str] = None,
                           order_by: Optional[str] = 'name') -> list[dict]:
        """ List EMhub users (id, username, name, email, roles, status,
        pi_id). Users with pi_id belong to the lab of that PI.

        Args:
            condition: Optional filter, e.g. "status='active'",
                "pi_id=12" or "username='jdoe'".
            order_by: Optional ORDER BY expression, e.g. "name".

        Conditions use a restricted SQL WHERE syntax on the table columns:
        comparisons (=, !=, <, <=, >, >=) with numbers or quoted strings,
        IN (...), NOT IN (...), AND, OR and parentheses,
        e.g. "status='active' AND pi_id=12" or "id IN (3, 5)".
        """
        return client.call('get_users', attrs=USER_FIELDS,
                           condition=condition, orderBy=order_by)

    @mcp.tool(annotations=READ)
    def booking_get_user(user_id: int) -> dict:
        """ Get the full record of an EMhub user by id. """
        return _one(client.call('get_users', condition='id=%d' % user_id),
                    'user', user_id)

    @mcp.tool(annotations=READ)
    def booking_list_sessions(start: Optional[str] = None,
                              end: Optional[str] = None,
                              status: Optional[str] = None) -> list[dict]:
        """ List microscope (data acquisition) sessions: id, name, start,
        end, status, data_path (processing project folder, if any),
        resource_id, booking_id and operator_id. A session is usually
        created from a booking and its on-the-fly processing can be
        inspected with the processing_* tools using its id.

        Args:
            start: First day of the range, 'YYYY-MM-DD'.
            end: Last day of the range (included), 'YYYY-MM-DD'.
                Without a range the last 50 sessions are returned.
            status: Only sessions with this status, e.g. 'active',
                'finished' or 'failed'.
        """
        if start or end:
            if not (start and end):
                raise EmhubMcpError("Provide both 'start' and 'end'.")
            sessions = client.call('get_sessions_range',
                                   data={'start': start, 'end': end})
            sessions = [{k: s.get(k) for k in SESSION_FIELDS}
                        for s in sessions]
        else:
            sessions = client.call('get_sessions', attrs=SESSION_FIELDS,
                                   orderBy='id DESC')[:50]
        if status:
            sessions = [s for s in sessions if s.get('status') == status]
        return sessions

    @mcp.tool(annotations=READ)
    def booking_get_session(session_id: int) -> dict:
        """ Get the full record of a session, including 'acquisition'
        (microscope settings: voltage, pixel size, dose, ...), 'stats'
        (movies/micrographs counts) and 'extra' (OTF and transfer
        status). """
        return _one(client.call('get_sessions', condition='id=%d' % session_id),
                    'session', session_id)

    @mcp.tool(annotations=READ)
    def booking_list_projects(condition: Optional[str] = None) -> list[dict]:
        """ List EMhub projects (id, date, status, title, user_id,
        last_update_date). Bookings can be associated with a project.

        Args:
            condition: Optional filter, e.g. "status='active'" or
                "user_id=12".

        Conditions use a restricted SQL WHERE syntax on the table columns:
        comparisons (=, !=, <, <=, >, >=) with numbers or quoted strings,
        IN (...), NOT IN (...), AND, OR and parentheses,
        e.g. "status='active' AND pi_id=12" or "id IN (3, 5)".
        """
        return client.call('get_projects', attrs=PROJECT_FIELDS,
                           condition=condition, orderBy='id DESC')

    @mcp.tool(annotations=READ)
    def booking_get_config(name: str) -> dict:
        """ Get an EMhub configuration form by name, e.g. 'bookings',
        'sessions', 'permissions' or 'resources'. Useful to understand
        facility rules (who can book what, slots, cancellation, ...). """
        return client.call('get_config', attrs={'config': name}, key='config')

    # ------------------------- Booking tools ------------------------------
    @mcp.tool(annotations=WRITE)
    def booking_create_booking(resource_id: int, start: str, end: str,
                               title: str = '',
                               description: Optional[str] = None,
                               owner_id: Optional[int] = None,
                               operator_id: Optional[int] = None,
                               project_id: Optional[int] = None,
                               type: str = 'booking') -> list[dict]:
        """ Create a booking of a resource. EMhub validates it with the
        facility rules (user permissions on the resource, overlapping
        bookings, min/max duration, pending booking limits) and returns an
        error explaining why when it is not allowed. Always confirm the
        details with the user before calling this.

        Args:
            resource_id: Resource to book (see booking_list_resources).
            start: Start, 'YYYY-MM-DD HH:MM' local time.
            end: End, 'YYYY-MM-DD HH:MM' local time.
            title: Short title of the booking.
            description: Optional longer description.
            owner_id: Owner user id, the logged in user by default
                (booking for others requires manager rights).
            operator_id: Optional user operating the instrument.
            project_id: Optional EMhub project id.
            type: 'booking' (default); managers can also create 'slot',
                'downtime', 'maintenance' or 'special'.

        Returns:
            The list of created bookings (as calendar events).
        """
        attrs = _dates(_given(resource_id=resource_id, start=start, end=end,
                              title=title, description=description,
                              owner_id=owner_id, operator_id=operator_id,
                              project_id=project_id, type=type))
        return client.call('create_booking', attrs=attrs,
                           key='bookings_created')

    @mcp.tool(annotations=WRITE)
    def booking_update_booking(booking_id: int,
                               start: Optional[str] = None,
                               end: Optional[str] = None,
                               title: Optional[str] = None,
                               description: Optional[str] = None,
                               operator_id: Optional[int] = None,
                               project_id: Optional[int] = None) -> list[dict]:
        """ Update a booking. Only the given fields are changed. Moving or
        shortening a booking is subject to the cancellation window of the
        resource. Confirm the change with the user before calling this.

        Args:
            booking_id: Booking to update.
            start: New start, 'YYYY-MM-DD HH:MM' local time.
            end: New end, 'YYYY-MM-DD HH:MM' local time.
            title, description, operator_id, project_id: New values.
        """
        attrs = _dates(_given(id=booking_id, start=start, end=end,
                              title=title, description=description,
                              operator_id=operator_id,
                              project_id=project_id))
        return client.call('update_booking', attrs=attrs,
                           key='bookings_updated')

    @mcp.tool(annotations=DESTRUCTIVE)
    def booking_cancel_booking(booking_id: int,
                               all_repeats: bool = False) -> list[dict]:
        """ Cancel (delete) a booking. Bookings can only be cancelled by
        their owner, the owner's PI or managers, and not later than the
        cancellation window of the resource (usually 24 h before start).
        Always confirm with the user before calling this.

        Args:
            booking_id: Booking to cancel.
            all_repeats: For repeating bookings, also cancel all the
                following repetitions.
        """
        attrs = {'id': booking_id}
        if all_repeats:
            attrs['modify_all'] = True
        return client.call('delete_booking', attrs=attrs,
                           key='bookings_deleted')

    if not allow_admin:
        return

    # ------------------------- Admin tools --------------------------------
    @mcp.tool(annotations=WRITE)
    def booking_create_user(username: str, email: str, name: str,
                            password: str,
                            roles: Optional[list[str]] = None,
                            pi_id: Optional[int] = None,
                            status: str = 'active') -> dict:
        """ (Admin) Create an EMhub user. Roles: 'user' (default), 'pi',
        'independent', 'manager', 'head', 'admin', 'staff-<unit>'.
        Lab members must have pi_id set to their PI user id. """
        attrs = dict(username=username, email=email, name=name,
                     password=password, roles=roles or ['user'],
                     pi_id=pi_id, status=status)
        return client.call('create_user', attrs=attrs, key='user')

    @mcp.tool(annotations=WRITE)
    def booking_update_user(user_id: int,
                            name: Optional[str] = None,
                            email: Optional[str] = None,
                            roles: Optional[list[str]] = None,
                            pi_id: Optional[int] = None,
                            status: Optional[str] = None) -> dict:
        """ (Admin) Update an EMhub user. Only the given fields change;
        'roles' replaces the whole list of roles. Status is 'active' or
        'inactive'. """
        attrs = _given(id=user_id, name=name, email=email, roles=roles,
                       pi_id=pi_id, status=status)
        return client.call('update_user', attrs=attrs, key='user')

    @mcp.tool(annotations=WRITE)
    def booking_create_resource(name: str, tags: str = '',
                                status: str = 'active',
                                color: Optional[str] = None,
                                extra: Optional[dict] = None) -> dict:
        """ (Admin) Create a resource (instrument). 'tags' is a space
        separated string (e.g. 'microscope krios'), 'extra' holds the
        booking settings (min_booking, max_booking, latest_cancellation,
        requires_slot, ...). """
        attrs = _given(name=name, tags=tags, status=status, color=color,
                       extra=extra)
        return client.call('create_resource', attrs=attrs, key='resource')

    @mcp.tool(annotations=WRITE)
    def booking_update_resource(resource_id: int,
                                name: Optional[str] = None,
                                tags: Optional[str] = None,
                                status: Optional[str] = None,
                                color: Optional[str] = None,
                                extra: Optional[dict] = None) -> dict:
        """ (Admin) Update a resource. Only the given fields change; 'extra'
        replaces the whole extra dict, so read it first with
        booking_list_resources and send it back modified. """
        attrs = _given(id=resource_id, name=name, tags=tags, status=status,
                       color=color, extra=extra)
        return client.call('update_resource', attrs=attrs, key='resource')

    @mcp.tool(annotations=WRITE)
    def booking_update_session(session_id: int,
                               name: Optional[str] = None,
                               status: Optional[str] = None,
                               operator_id: Optional[int] = None,
                               booking_id: Optional[int] = None) -> dict:
        """ (Admin) Update a session. Only the given fields change. """
        attrs = _given(id=session_id, name=name, status=status,
                       operator_id=operator_id, booking_id=booking_id)
        return client.call('update_session', attrs=attrs, key='session')
