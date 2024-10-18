
import os
from glob import glob
import json
import datetime as dt

from emtools.utils import Pretty

#
# def pretty_date(input_dt):
#     if input_dt is None:
#         return 'None'
#
#     if isinstance(input_dt, str):
#         input_dt = datetime_from_isoformat(input_dt)
#
#     return input_dt.strftime("%Y/%m/%d")



def setup_app(app):

    def _local_time(dt):
        return app.dm.dt_as_local(dt).strftime("%I %p")

    @app.template_filter('time_range')
    def time_range(b):
        ss = _local_time(b.start)
        es = _local_time(b.end)
        return f'{ss} - {es}'

    @app.template_filter('booking_color')
    def booking_color(b):
        c = b.resource.color
        if b.is_slot:
            c = c.replace('1.0', '0.5')  # 0.5 transparency for slots
        return c
