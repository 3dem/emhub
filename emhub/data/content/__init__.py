# **************************************************************************
# *
# * Authors:     J.M. de la Rosa Trevin (delarosatrevin@gmail.com)
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
# **************************************************************************

from .dc_base import DataContent, register_content
from . import (dc_base, dc_raw, dc_users, dc_reports, dc_bookings,
               dc_projects, dc_sessions)

dc = DataContent()

register_content(dc)
dc_users.register_content(dc)
dc_bookings.register_content(dc)
dc_sessions.register_content(dc)
dc_raw.register_content(dc)
dc_projects.register_content(dc)
dc_reports.register_content(dc)
