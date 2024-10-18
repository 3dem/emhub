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
import json

from emhub.utils import datetime_from_isoformat


def register_content(dc):

    @dc.content
    def resources_list(**kwargs):
        kwargs['all'] = True  # show all resources despite status
        kwargs['image'] = True  # load resource image
        return dc.get_resources(**kwargs)

    @dc.content
    def resource_form(**kwargs):
        copy_resource = json.loads(kwargs.pop('copy_resource', 'false'))

        r = dc.app.dm.get_resource_by(id=kwargs['resource_id'])

        if r is None:
            r = dc.app.dm.Resource(
                name='',
                status='inactive',
                tags='',
                image='',
                color='rgba(256, 256, 256, 1.0)',
                extra={})

        if copy_resource:
            r.id = None
            r.name = 'COPY ' + r.name

        params = []

        def _add(attr, label, **kwargs):
            p = {'id': attr,
                 'label': label,
                 'value': getattr(r, attr)
                 }
            p.update(kwargs)
            params.append(p)

        _add('name', 'Name')
        _add('status', 'Status',
             enum={'display': 'combo',
                   'choices': ['active', 'inactive']})
        _add('tags', 'Tags')
        _add('image', 'Icon image', type='file_image')
        _add('color', 'Color')
        _add('latest_cancellation', 'Latest cancellation (h)')
        _add('min_booking', 'Minimum booking time (h)')
        _add('max_booking', 'Maximum booking time (h)')
        _add('daily_cost', 'Daily cost')
        _add('requires_slot', 'Requires Slot', type='bool')
        _add('requires_application', 'Requires Application', type='bool')

        return {
            'resource': r, 'params': params
        }

    @dc.content
    def booking_calendar(**kwargs):
        dm = dc.app.dm  # shortcut
        dataDict = dc.get_resources()
        dataDict['bookings'] = [dc.booking_to_event(b)
                                for b in dm.get_bookings()
                                if b.resource is not None]
        dataDict['applications'] = [{'id': a.id,
                                     'code': a.code,
                                     'alias': a.alias}
                                    for a in dm.get_applications()
                                    if a.is_active]
        return dataDict

    @dc.content
    def booking_form(**kwargs):
        dm = dc.app.dm  # shortcut
        user = dc.app.user

        if 'start' in kwargs and 'end' in kwargs:
            dates = {
                'start': datetime_from_isoformat(kwargs.get('start', None)),
                'end': datetime_from_isoformat(kwargs.get('end', None))
            }
        else:
            dates = None

        read_only = False
        if 'booking_id' in kwargs:
            booking_id = kwargs['booking_id']
            booking = dm.get_booking_by(id=booking_id)
            read_only = not (user.is_manager or user.id == booking.owner.id)

            if dates:
                booking.start = dates['start']
                booking.end = dates['end']
            if booking is None:
                raise Exception("Booking with id %s not found." % booking_id)
        elif 'entry_id' in kwargs:
            entry = dm.get_entry_by(id=kwargs['entry_id'])
            scopes = {r.id: r for r in dm.get_resources() if r.is_microscope}
            booking = dc.booking_from_entry(entry, scopes)
        else:  # New Booking
            args = dict(kwargs)
            args.pop('content_id')
            args.update(dates)
            booking = dm.create_basic_booking(args)
            allowed_resources = [r for r in dm.get_resources()]

        display = dm.get_config('bookings')['display']
        applications = [a for a in dm.get_visible_applications() if a.is_active]

        data = {'booking': booking,
                'applications': applications,
                'show_experiment': display['show_experiment'],
                'read_only': read_only
                }

        data.update(dc.get_user_projects(user, status='active'))
        return data

    @dc.content
    def experiment_form(**kwargs):
        if kwargs['booking_id']:
            booking_id = int(kwargs['booking_id'])
            booking = dc.app.dm.get_booking_by(id=booking_id)
            print("Booking id: ", booking_id, 'experiment', booking.experiment)
        else:
            booking = None

        if 'form_values' not in kwargs and booking:
            kwargs['form_values'] = json.dumps(booking.experiment)

        form = dc.app.dm.get_form_by(name='experiment')
        data = dc.dynamic_form(form, **kwargs)
        return data


