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
    def get_portal_users_list(**kwargs):
        dm = self.app.dm
        do_import = 'import' in kwargs
        imported = []
        failed = []

        if do_import:
            users = self._get_users_from_portal(status='ready')
            for u in users:
                roles = ['user', 'pi'] if u['pi'] else ['user']
                pi_id = None if u['pi'] else u['pi_user'].id

                try:
                    user = dm.create_user(
                        username=u['email'],
                        email=u['email'],
                        phone='',
                        password=os.urandom(24).hex(),
                        name="%(first_name)s %(last_name)s" % u,
                        roles=roles,
                        pi_id=pi_id,
                        status='active'
                    )
                    imported.append(u)

                    if self.app.mm:
                        self.app.mm.send_mail(
                            [user.email],
                            "emhub: New account imported",
                            flask.render_template('email/account_created.txt',
                                                  user=user))
                except Exception as e:
                    u['error'] = str(e)
                    failed.append(u)
            status = None
        else:
            status = kwargs.get('status', None)

        users = self._get_users_from_portal(status)

        return {'portal_users': users,
                'status': status,
                'do_import': do_import,
                'users_imported': imported,
                'users_failed': failed
                }

    def get_portal_import_application(**kwargs):
        # Date since the created orders in the portal will be considered
        sinceArg = kwargs.get('since', None)

        if sinceArg:
            since = datetime_from_isoformat(sinceArg)
        else:
            since = self.app.dm.now() - dt.timedelta(days=183)  # 6 months

        result = {'since': since}

        ordersJson = self.app.sll_pm.fetchOrdersJson()

        def _filter(o):
            s = o['status']
            code = o['identifier'].upper()
            app = self.app.dm.get_application_by(code=code)
            o['app'] = app.id if app else 'None'
            modified = datetime_from_isoformat(o['modified'])

            return ((s == 'accepted' or s == 'processing')
                    and app is None and modified >= since)

        result['orders'] = [o for o in ordersJson if _filter(o)]

        return result

    def get_applications_check(**kwargs):

        dm = self.app.dm

        sinceArg = kwargs.get('since', None)

        if sinceArg:
            since = datetime_from_isoformat(sinceArg)
        else:
            since = self.app.dm.now() - dt.timedelta(days=183)  # 6 months
        results = {}

        accountsJson = self.app.sll_pm.fetchAccountsJson()
        usersDict = {a['email'].lower(): a for a in accountsJson}

        for application in dm.get_applications():
            app_results = {}
            errors = []

            if application.created < since:
                continue

            orderCode = application.code.upper()
            orderJson = self.app.sll_pm.fetchOrderDetailsJson(orderCode)

            if orderJson is None:
                errors.append('Invalid application ID %s' % orderCode)
            else:
                fields = orderJson['fields']
                pi_list = fields.get('pi_list', [])
                pi_missing = []

                for piTuple in pi_list:
                    piName, piEmail = piTuple
                    piEmail = piEmail.lower()

                    pi = dm.get_user_by(email=piEmail)
                    piInfo = ''
                    if pi is None:
                        if piEmail in usersDict:
                            piInfo = "in the portal, pi: %s" % usersDict[piEmail]['pi']
                        else:
                            piInfo = "NOT in the portal"

                    else:
                        if pi.id != application.creator.id and pi not in application.users:
                            piInfo = 'NOT in APP'
                    if piInfo:
                        pi_missing.append((piName, piEmail, piInfo))

                if pi_missing:
                    app_results['pi_missing'] = pi_missing

            if errors:
                app_results['errors'] = errors

            if app_results:
                app_results['application'] = application
                results[orderCode] = app_results

        return {'checks': results,
                'since': since
                }

