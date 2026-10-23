"""
Thin wrapper around :class:`emhub.client.data_client.DataClient`, used by the
EMhub MCP server (see ``emhub.mcp.server``). It adds:

  * A ``call`` helper that returns the JSON result and raises a short,
    readable :class:`EmhubMcpError` on server-side errors.
  * Transparent re-login when the server session cookie has expired.
  * Resolution of the currently logged in user and its roles, so the MCP
    server can decide whether to expose admin tools.

This module does not know anything about MCP itself; it is a plain
synchronous EMhub API client that can be tested/used on its own.
"""

import os
import datetime as dt

import requests

from emhub.client.data_client import DataClient, config


def _tool_error_base():
    """ ToolError of the 'mcp' package if installed: only its message is
    sent to the model (mcp 2.x hides the message of other exceptions). """
    for module in ('mcp.server.mcpserver.exceptions',
                   'mcp.server.fastmcp.exceptions'):
        try:
            return __import__(module, fromlist=['ToolError']).ToolError
        except ImportError:
            pass
    return Exception


class EmhubMcpError(_tool_error_base()):
    """ Raised when the EMhub server returns an error for a request. """
    pass


def _local_tz():
    """ Timezone for dates without offset: EMHUB_TIMEZONE (e.g.
    'America/Chicago') or the timezone of this machine. """
    if name := os.environ.get('EMHUB_TIMEZONE'):
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    return dt.datetime.now().astimezone().tzinfo


def to_utc_iso(value):
    """ Convert a 'YYYY-MM-DD HH:MM' date (local time, unless it has an
    offset) to the UTC ISO format expected by EMhub ('...Z'). """
    try:
        d = dt.datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
    except (AttributeError, ValueError):
        raise EmhubMcpError(f"Invalid date {value!r}, "
                            f"expected 'YYYY-MM-DD HH:MM'.")
    if d.tzinfo is None:
        d = d.replace(tzinfo=_local_tz())
    return d.astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


# Keys never returned to the MCP client
HIDDEN_KEYS = {'password_hash'}


def clean(item):
    """ Remove hidden keys from a dict or list of dicts. """
    if isinstance(item, list):
        return [clean(i) for i in item]
    if isinstance(item, dict):
        return {k: v for k, v in item.items() if k not in HIDDEN_KEYS}
    return item


def _short_error(msg):
    """ Server errors include the full traceback, keep only the message. """
    msg = str(msg)
    if msg.startswith('ERROR from Server: '):
        msg = msg[len('ERROR from Server: '):]
    return msg.split('. Traceback:')[0].strip()


class EmhubMcpClient:
    """ Synchronous client used by the MCP tool modules (``booking.py``,
    ``processing.py``) to talk to an EMhub server through its REST API.

    Configuration is read from the environment (``EMHUB_SERVER_URL``,
    ``EMHUB_USER``, ``EMHUB_PASSWORD``), same as any other EMhub client
    script, unless overridden in the constructor.
    """
    def __init__(self, server_url=None, username=None, password=None):
        self.server_url = server_url or config.EMHUB_SERVER_URL
        self.username = username or config.EMHUB_USER
        self._password = password or config.EMHUB_PASSWORD
        self._dc = DataClient(server_url=self.server_url)
        self._user = None

    # ----------------------- Connection ------------------------------------
    def connect(self):
        """ Login into the EMhub server and cache the current user. """
        self._login()
        users = self.call('get_users',
                          condition="username='%s'" % self.username)
        if not users:
            raise EmhubMcpError(
                f"Could not find the logged in user {self.username!r}, "
                f"check the EMHUB_USER environment variable.")
        self._user = clean(users[0])
        return self

    def _login(self):
        try:
            r = self._dc.login(self.username, self._password)
        except requests.HTTPError as e:
            raise EmhubMcpError(f"Login to {self.server_url} failed: {e}")
        result = r.json()
        if 'error' in result:
            raise EmhubMcpError(f"Login to {self.server_url} failed: "
                                f"{result['error']}")

    def close(self):
        """ Logout from the EMhub server, if currently logged in. """
        if self._dc.cookies is not None:
            try:
                self._dc.logout()
            except Exception:
                pass

    def __enter__(self):
        return self.connect()

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    # ----------------------- Current user ----------------------------------
    @property
    def current_user(self):
        """ JSON dict of the currently logged in user. """
        if self._user is None:
            raise EmhubMcpError("Not connected yet, call connect() first.")
        return self._user

    @property
    def roles(self):
        return list(self.current_user.get('roles') or [])

    @property
    def is_admin(self):
        return bool({'admin', 'developer'} & set(self.roles))

    @property
    def is_manager(self):
        return self.is_admin or bool({'manager', 'head'} & set(self.roles))

    # ----------------------- Requests --------------------------------------
    def call(self, method, attrs=None, condition=None, orderBy=None,
             key=None, data=None):
        """ Call an endpoint of the EMhub 'api' blueprint.

        Args:
            method: Endpoint name, e.g. 'get_users' or 'create_booking'.
            attrs: Dict sent as ``attrs`` (most create/update endpoints)
                or list of attribute names to return (get_* endpoints).
            condition: Optional filter condition for get_* endpoints.
            orderBy: Optional ORDER BY expression for get_* endpoints.
            key: If given, return only this key from the JSON result.
            data: Raw JSON payload, used instead of attrs/condition/orderBy
                for endpoints reading top-level keys (e.g. get_bookings_range).
        """
        if data is None:
            data = {'attrs': attrs}
            if condition is not None:
                data['condition'] = condition
            if orderBy is not None:
                data['orderBy'] = orderBy

        result = self._request(method, data)

        if isinstance(result, dict):
            if 'error' in result:
                raise EmhubMcpError(_short_error(result['error']))
            if 'errors' in result:  # JobValidationError
                raise EmhubMcpError("Validation errors: %s"
                                    % '; '.join(map(str, result['errors'])))

        return clean(result if key is None else result[key])

    def _request(self, method, data, retry=True):
        try:
            r = self._dc.request(method, jsonData=data)
            return r.json()
        except (requests.HTTPError, ValueError) as e:
            # An expired session gives 401 or a redirect to the HTML
            # login page (not JSON), login again and retry once.
            status = getattr(getattr(e, 'response', None), 'status_code', None)
            if retry and (status == 401 or isinstance(e, ValueError)):
                self._login()
                return self._request(method, data, retry=False)
            raise EmhubMcpError(f"Request '{method}' failed: {e}")
