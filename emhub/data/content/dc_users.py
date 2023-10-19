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


def register_content(dc):

    @dc.content
    def users_list(**kwargs):
        return dc.get_users_list()

    @dc.content
    def users_groups_cards(**kwargs):
        # Retrieve all pi labs that belong to a given application

        appCode = kwargs.get('application', '').upper()

        def _userjson(u):
            return {'id': u.id, 'name': u.name}

        # Group users by PI
        labs = []

        if appCode:
            piList = [u for u in dc.app.dm.get_users()
                      if u.is_pi and u.has_application(appCode)]

            for u in piList:
                if u.is_pi:
                    lab = [_userjson(u)] + [_userjson(u2) for u2 in u.get_lab_members()]
                    labs.append(lab)

            labs = sorted(labs, key=lambda lab: len(lab), reverse=True)

        apps = sorted(dc.app.dm.get_visible_applications(),
                      key=lambda a: len(a.users), reverse=True)
        applications = [a.json() for a in apps if a.is_active]

        # if user.is_staff:
        #     labs.append([_userjson(u) for u in self._get_facility_staff(user.staff_unit)])

        return {
            'labs': labs,
            'applications': applications,
            'application_code': appCode,
        }

    @dc.content
    def users_groups(**kwargs):
        return users_groups_cards(**kwargs)

    @dc.content
    def user_form(**kwargs):
        user = dc.app.dm.get_user_by(id=kwargs['user_id'])
        user.image = dc.user_profile_image(user)
        data = {'user': user}

        pi_label = None

        # Allow to change pi if it is a manager logged
        if user.is_pi:
            pi_label = 'Self'
        elif user.is_manager:
            pi_label = 'None'
        elif dc.app.user.is_manager:
            data['possible_pis'] = [
                {'id': u.id, 'name': u.name}
                for u in dc.app.dm.get_users() if u.is_pi
            ]
        else:
            pi = user.pi
            pi_label = 'Unknown' if pi is None else pi.name

        data['pi_label'] = pi_label
        data['user_statuses'] = dc.app.dm.User.STATUSES

        return data

    @dc.content
    def register_user_form(**kwargs):
        dm = dc.app.dm  # shortcut

        return {
            'possible_pis': [{'id': u.id, 'name': u.name}
                             for u in dm.get_users() if u.is_pi],
            'pi_label': None,
            'roles': dm.USER_ROLES
        }

    @dc.content
    def user_profile(**kwargs):
        return {
            'lab_members': dc.get_lab_members(dc.app.user)
        }
