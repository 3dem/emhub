# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *
# * [1] SciLifeLab, Stockholm University
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
"""
'Booking system' MCP tools: users, roles, resources, bookings and
sessions.

Registered by :func:`register_tools`, called from ``emhub.mcp.server``.
Read-only tools (``list_*`` / ``get_*``) are always registered. Write
tools (``create_*`` / ``update_*`` / ``delete_*``) are only registered
when ``allow_write`` is True, which the server decides based on the
role of the EMhub user the MCP server is logged in as (``admin`` or
``developer``; see ``EmhubMcpClient.is_admin``).
"""

# Static roles defined in emhub.data.data_models.User.ROLES, plus the
# extra roles/flags checked via User.is_* properties. Kept here (rather
# than imported) because the DB model classes are only created once a
# DataManager/DB connection exists, which this MCP server does not have
# (it talks to EMhub purely over the REST API).
ROLE_DESCRIPTIONS = {
    'user': "Base role every account has; no special privileges.",
    'admin': "Full administrative access to EMhub (equivalent to 'developer').",
    'developer': "Treated the same as 'admin' throughout EMhub.",
    'manager': "Management privileges (booking/resource management). "
              "Automatically true for admins and heads too.",
    'head': "Head of a facility/unit. Implies manager privileges.",
    'pi': "Principal Investigator; can have lab members associated.",
    'independent': "Independent user, not part of a PI's lab.",
    'staff-<unit>': "Staff member of a specific unit, e.g. 'staff-cryoem' "
                    "(the '<unit>' part varies per facility unit).",
}


def register_tools(mcp, client, allow_write):
    """ Register the booking-system tools on the given FastMCP server.

    Args:
        mcp: The ``mcp.server.fastmcp.FastMCP`` instance.
        client: A connected ``EmhubMcpClient``.
        allow_write (bool): Whether to also register the create/update/
            delete tools.
    """

    # ------------------------------------------------------------------
    # Users & roles
    # ------------------------------------------------------------------
    @mcp.tool()
    def list_users(condition: str = None, order_by: str = None) -> list:
        """ List EMhub users.

        Args:
            condition: Optional raw SQL WHERE clause on the users table,
                e.g. "status='active'", "pi_id IS NULL",
                "username='jdoe'".
            order_by: Optional SQL ORDER BY expression, e.g. "name".

        Returns:
            A list of user dicts (id, username, email, name, roles,
            status, pi_id, created, ...).
        """
        return client.get('users', condition=condition, order_by=order_by)

    @mcp.tool()
    def get_user(user_id: int) -> dict:
        """ Get a single EMhub user by id. """
        users = client.get('users', condition='id=%d' % user_id)
        if not users:
            raise ValueError('No user found with id=%d' % user_id)
        return users[0]

    @mcp.tool()
    def list_roles() -> list:
        """ List the roles known to EMhub, with a short description and
        how many current users hold each one.

        Roles are stored as a free-form JSON list on each user (e.g.
        ['user', 'manager', 'staff-cryoem']); this tool reports the
        well-known roles plus any other role strings actually found on
        existing users.
        """
        users = client.get('users')
        counts = {}
        for u in users:
            for role in (u.get('roles') or []):
                counts[role] = counts.get(role, 0) + 1

        all_roles = set(ROLE_DESCRIPTIONS) | set(counts)
        # Keep 'staff-<unit>' as a template entry, but also surface the
        # concrete 'staff-XXX' roles found on users.
        all_roles.discard('staff-<unit>')
        roles = []
        for role in sorted(all_roles):
            roles.append({
                'role': role,
                'description': ROLE_DESCRIPTIONS.get(
                    role, ROLE_DESCRIPTIONS['staff-<unit>']
                    if role.startswith('staff-') else ''),
                'num_users': counts.get(role, 0),
            })
        return roles

    # ------------------------------------------------------------------
    # Resources
    # ------------------------------------------------------------------
    @mcp.tool()
    def list_resources(condition: str = None, order_by: str = None) -> list:
        """ List EMhub resources (e.g. microscopes, instruments).

        Args:
            condition: Optional raw SQL WHERE clause, e.g. "status='active'".
            order_by: Optional SQL ORDER BY expression.
        """
        return client.get('resources', condition=condition, order_by=order_by)

    @mcp.tool()
    def get_resource(resource_id: int) -> dict:
        """ Get a single EMhub resource by id. """
        resources = client.get('resources', condition='id=%d' % resource_id)
        if not resources:
            raise ValueError('No resource found with id=%d' % resource_id)
        return resources[0]

    # ------------------------------------------------------------------
    # Bookings
    # ------------------------------------------------------------------
    @mcp.tool()
    def list_bookings(condition: str = None, order_by: str = None) -> list:
        """ List EMhub bookings.

        Args:
            condition: Optional raw SQL WHERE clause, e.g.
                "resource_id=3", "owner_id=12", "type='booking'".
            order_by: Optional SQL ORDER BY expression, e.g. "start".
        """
        return client.get('bookings', condition=condition, order_by=order_by)

    @mcp.tool()
    def get_bookings_range(start_date: str, end_date: str) -> list:
        """ List bookings overlapping a date range.

        Args:
            start_date: Start date, format "YYYY-MM-DD".
            end_date: End date, format "YYYY-MM-DD".
        """
        return client.raw('get_bookings_range',
                          {'start': start_date, 'end': end_date})

    @mcp.tool()
    def get_booking(booking_id: int) -> dict:
        """ Get a single EMhub booking by id. """
        bookings = client.get('bookings', condition='id=%d' % booking_id)
        if not bookings:
            raise ValueError('No booking found with id=%d' % booking_id)
        return bookings[0]

    # ------------------------------------------------------------------
    # Sessions
    # ------------------------------------------------------------------
    @mcp.tool()
    def list_sessions(condition: str = None, order_by: str = None) -> list:
        """ List EMhub sessions (microscope acquisition/processing
        sessions).

        Args:
            condition: Optional raw SQL WHERE clause, e.g.
                "status='active'", "data_path IS NOT NULL".
            order_by: Optional SQL ORDER BY expression, e.g. "start".
        """
        return client.get('sessions', condition=condition, order_by=order_by)

    @mcp.tool()
    def get_sessions_range(start_date: str, end_date: str) -> list:
        """ List sessions overlapping a date range.

        Args:
            start_date: Start date, format "YYYY-MM-DD".
            end_date: End date, format "YYYY-MM-DD".
        """
        return client.raw('get_sessions_range',
                          {'start': start_date, 'end': end_date})

    @mcp.tool()
    def get_session(session_id: int) -> dict:
        """ Get a single EMhub session by id. """
        sessions = client.get('sessions', condition='id=%d' % session_id)
        if not sessions:
            raise ValueError('No session found with id=%d' % session_id)
        return sessions[0]

    if not allow_write:
        return

    # ------------------------------------------------------------------
    # Write tools (admin / developer only)
    # ------------------------------------------------------------------
    @mcp.tool()
    def create_user(attrs: dict) -> dict:
        """ Create a new EMhub user.

        Args:
            attrs: User attributes. Required: username, email, name,
                password. Optional: roles (list, default ['user']),
                status ('pending'|'active'|'inactive'), pi_id, phone.
        """
        return client.call('create_user', attrs)

    @mcp.tool()
    def update_user(attrs: dict) -> dict:
        """ Update an existing EMhub user. ``attrs`` must include 'id'
        plus any fields to change (e.g. roles, status, pi_id). """
        return client.call('update_user', attrs)

    @mcp.tool()
    def delete_user(user_id: int) -> dict:
        """ Delete an EMhub user by id. Fails if the user has associated
        lab members. """
        return client.call('delete_user', {'id': user_id})

    @mcp.tool()
    def create_resource(attrs: dict) -> dict:
        """ Create a new EMhub resource.

        Args:
            attrs: Resource attributes, e.g. name, status, image,
                extra (dict, can include 'daily_cost').
        """
        return client.call('create_resource', attrs)

    @mcp.tool()
    def update_resource(attrs: dict) -> dict:
        """ Update an existing EMhub resource. ``attrs`` must include
        'id' plus any fields to change. """
        return client.call('update_resource', attrs)

    @mcp.tool()
    def delete_resource(resource_id: int) -> dict:
        """ Delete an EMhub resource by id. """
        return client.call('delete_resource', {'id': resource_id})

    @mcp.tool()
    def create_booking(attrs: dict) -> dict:
        """ Create a new EMhub booking (or a set of repeating bookings).

        Args:
            attrs: Booking attributes. Required: title, start
                ("YYYY-MM-DD HH:MM"), end ("YYYY-MM-DD HH:MM"),
                resource_id, owner_id, type (one of 'booking', 'slot',
                'downtime', 'maintenance', 'repair', 'cryo-cycle',
                'training', 'special'). Optional: description,
                application_id, project_id, operator_id, repeat_value
                ('no' by default), repeat_stop (required if
                repeat_value != 'no').

        Returns:
            dict with key 'bookings_created': list of the created
            booking event(s) (more than one if repeat_value != 'no').
        """
        return client.call('create_booking', attrs)

    @mcp.tool()
    def update_booking(attrs: dict) -> dict:
        """ Update an existing EMhub booking. ``attrs`` must include
        'id' plus any fields to change (see create_booking for the
        available fields). """
        return client.call('update_booking', attrs)

    @mcp.tool()
    def delete_booking(booking_id: int) -> dict:
        """ Delete an EMhub booking by id. """
        return client.call('delete_booking', {'id': booking_id})

    @mcp.tool()
    def create_session(attrs: dict) -> dict:
        """ Create a new EMhub session.

        Args:
            attrs: Session attributes. Required: name, start, end.
                Optional: resource_id, booking_id, operator_id,
                data_path, status, acquisition (dict), extra (dict).
        """
        return client.call('create_session', attrs)

    @mcp.tool()
    def update_session(attrs: dict) -> dict:
        """ Update an existing EMhub session. ``attrs`` must include
        'id' plus any fields to change. """
        return client.call('update_session', attrs)

    @mcp.tool()
    def delete_session(session_id: int) -> dict:
        """ Delete an EMhub session by id. """
        return client.call('delete_session', {'id': session_id})
