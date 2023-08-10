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
"""
Register content functions related to Sessions
"""
import os
import json


def register_content(dc):

    @dc.content
    def raw_forms_list(**kwargs):
        dc.check_user_access('forms')

        return {'forms': [
            {'id': f.id,
             'name': f.name,
             'definition': json.dumps(f.definition)
             } for f in dc.app.dm.get_forms()]}

    @dc.content
    def raw_entries_list(**kwargs):
        cond = ['%s="%s"' % (k, kwargs[k]) for k in ['id', 'type'] if k in kwargs]
        return {
            'entries': dc.app.dm.get_entries(condition=' and '.join(cond))
        }

    @dc.content
    def raw_booking_list(**kwargs):
        bookings = dc.app.dm.get_bookings()
        return {'bookings': bookings}

    @dc.content
    def raw_applications_list(**kwargs):
        return {'applications': dc.app.dm.get_visible_applications()}

    @dc.content
    def raw_templates_list(**kwargs):
        return {'templates': dc.app.dm.get_templates()}

    @dc.content
    def forms_list(**kwargs):
        return {'forms': dc.app.dm.get_forms()}

    @dc.content
    def raw_invoice_periods_list(**kwargs):
        return {'invoice_periods': dc.app.dm.get_invoice_periods()}

    @dc.content
    def raw_transactions_list(**kwargs):
        return {'transactions': dc.app.dm.get_transactions()}

    @dc.content
    def raw_user_issues(**kwargs):
        users = dc.get_users_list()['users']
        filterKey = kwargs.get('filter', 'noroles')
        filterName = '_filter_%s' % filterKey

        def _filter_noapp(u):
            """ Users with No Active Application """
            return not u.is_manager and not u.project_codes

        def _filter_noroles(u):
            """ Users with No Roles """
            return not u.is_manager and not u.roles

        _filter = locals()[filterName]

        new_users = [u for u in users if _filter(u)]

        return {'users': new_users,
                'filterDesc': _filter.__doc__
                }

    @dc.content
    def raw_pucks_list(**kwargs):
        kwargs['content_id'] = 'grids_cane'
        return dc.get(**kwargs)
