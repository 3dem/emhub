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
Thin wrapper around :class:`emhub.client.data_client.DataClient`, used by
the EMhub MCP server (see ``emhub.mcp.server``).

It adds:

  * A ``get``/``call`` helper that raises a clear exception on server-side
    errors, instead of returning a raw ``requests.Response``.
  * Resolution of the *currently logged in* user (and its roles), so the
    MCP server can decide whether to expose write/action tools.

This module does not know anything about MCP itself; it is a plain
synchronous EMhub API client, kept separate so it can be tested/used on
its own.
"""

from emhub.client.data_client import DataClient, config


class EmhubMcpError(Exception):
    """ Raised when the EMhub server returns an error for a request,
    or the client is used in an invalid way (e.g. before connecting). """


class EmhubMcpClient:
    """ Synchronous client used by the MCP tool modules (``booking.py``,
    ``processing.py``) to talk to an EMhub server through its REST API
    (:mod:`emhub.blueprints.api`).

    Configuration is read from the environment (``EMHUB_SERVER_URL``,
    ``EMHUB_USER``, ``EMHUB_PASSWORD``), same as any other EMhub client
    script, unless overridden in the constructor.
    """

    def __init__(self, server_url=None, username=None, password=None):
        self.server_url = server_url or config.EMHUB_SERVER_URL
        self.username = username or config.EMHUB_USER
        self._password = password if password is not None else config.EMHUB_PASSWORD
        self.dc = DataClient(server_url=self.server_url)
        self._current_user = None

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------
    def connect(self):
        """ Login into the EMhub server and cache the current user's
        record (used for the read/write permission check). """
        self.dc.login(self.username, self._password)
        self._current_user = self._fetch_current_user()
        return self

    def close(self):
        """ Logout from the EMhub server, if currently logged in. """
        if self.dc.cookies is not None:
            try:
                self.dc.logout()
            except Exception:
                pass  # Best-effort logout, e.g. on interpreter shutdown

    def __enter__(self):
        return self.connect()

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    # ------------------------------------------------------------------
    # Current user / permissions
    # ------------------------------------------------------------------
    def _fetch_current_user(self):
        safe_username = self.username.replace("'", "''")
        users = self.get('users', condition="username='%s'" % safe_username)
        if not users:
            raise EmhubMcpError(
                "Could not find the logged in user %r via get_users; "
                "check the EMHUB_USER environment variable." % self.username)
        return users[0]

    @property
    def current_user(self):
        """ JSON dict of the currently logged in user. """
        if self._current_user is None:
            raise EmhubMcpError("Not connected yet, call connect() first.")
        return self._current_user

    @property
    def roles(self):
        """ List of role strings (e.g. ``['user', 'admin']``) of the
        currently logged in user. """
        return self.current_user.get('roles') or []

    @property
    def is_admin(self):
        """ True if the currently logged in user has admin-equivalent
        access, i.e. the ``admin`` or ``developer`` role (mirrors
        ``User.is_admin`` in ``emhub.data.data_models``). This is used
        by the MCP server to gate write/action tools. """
        return 'admin' in self.roles or 'developer' in self.roles

    # ------------------------------------------------------------------
    # Generic request helpers
    # ------------------------------------------------------------------
    def get(self, name, condition=None, order_by=None, attrs=None):
        """ Generic ``get_<name>`` request, e.g. ``get('users')``,
        ``get('bookings', condition="resource_id=3")``.

        Args:
            name (str): Plural entity name as used by the API
                (``users``, ``resources``, ``bookings``, ``sessions``,
                ``entries``, ``projects``, ...).
            condition (str): Optional raw SQL ``WHERE`` clause, applied
                server-side (e.g. ``"status='active'"``,
                ``"data_path IS NOT NULL"``).
            order_by (str): Optional SQL ``ORDER BY`` expression.
            attrs (list): Optional list of attribute names to keep in the
                result (all attributes are returned when omitted).

        Returns:
            list: The list of matching items, as JSON-serializable dicts.
        """
        return self._call('get_%s' % name,
                          {'attrs': attrs, 'condition': condition,
                           'orderBy': order_by})

    def call(self, method, attrs=None, **extra):
        """ Call an arbitrary EMhub API method that takes an ``attrs``
        dict (e.g. ``call('create_booking', {...})``,
        ``call('launch_job', {...})``).

        Args:
            method (str): API method/endpoint name (without the
                ``/api/`` prefix).
            attrs (dict): Attributes dict expected by that endpoint.
            **extra: Extra top-level JSON keys to send alongside
                ``attrs`` (e.g. ``condition=...`` for the rare endpoints
                that combine both).

        Returns:
            The parsed JSON response (usually a dict wrapping the
            resulting item(s), e.g. ``{'booking': {...}}``).
        """
        payload = {'attrs': attrs or {}}
        payload.update(extra)
        return self._call(method, payload)

    def raw(self, method, json_data):
        """ Call an EMhub API method that expects a flat, top-level JSON
        body instead of the ``{'attrs': {...}}`` wrapping used by most
        endpoints (e.g. ``get_bookings_range``, ``get_sessions_range``,
        which expect ``{'start': ..., 'end': ...}`` directly). """
        return self._call(method, json_data)

    def _call(self, method, json_data):
        response = self.dc.request(method, jsonData=json_data)
        result = response.json()
        if isinstance(result, dict) and 'error' in result:
            raise EmhubMcpError('EMhub server error calling %r: %s'
                               % (method, result['error']))
        return result
