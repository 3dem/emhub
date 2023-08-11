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
    def get_invoice_periods_list(**kwargs):
        c = 0
        periods = []

        for ip in self.app.dm.get_invoice_periods(orderBy='start'):
            p = {
                'id': ip.id,
                'status': ip.status,
                'start': ip.start,
                'end': ip.end,
                'period': pretty_quarter((ip.start, ip.end))
            }
            if ip.status != 'disabled':
                c += 1
                p['order'] = c
            else:
                p['order'] = 0
            periods.append(p)

        periods.sort(key=lambda p: p['order'], reverse=True)

        return {'invoice_periods': periods}

    def get_invoice_period_form(**kwargs):
        dm = self.app.dm
        invoice_period_id = kwargs['invoice_period_id']
        if invoice_period_id:
            ip = dm.get_invoice_period_by(id=invoice_period_id)
        else:
            ip = dm.InvoicePeriod(status='active',
                                  start=dt.datetime.now(),
                                  end=dt.datetime.now())

        return {
            'invoice_period': ip
        }

    def get_transactions_list(**kwargs):
        dm = self.app.dm  # shortcut
        period = dm.get_invoice_period_by(id=int(kwargs['period']))

        def _filter(t):
            return ((period.start < t.date < period.end) and
                    ('pi' not in kwargs or t.user.id == kwargs['pi']))

        transactions = [t for t in dm.get_transactions() if _filter(t)]
        transactions_dict = {}

        for t in transactions:
            user_id = t.user.id
            if user_id not in transactions_dict:
                transactions_dict[user_id] = 0
            transactions_dict[user_id] += int(float(t.amount))

        return {
            'transactions': transactions,
            'period': period,
            'transactions_dict': transactions_dict
        }

    def get_invoice_period(**kwargs):
        dm = self.app.dm  # shortcut
        period = dm.get_invoice_period_by(id=int(kwargs['period']))
        tabs = [
            {'label': 'overall',
             'template': 'time_distribution.html'
             },
            {'label': 'invoices',
             'template': 'invoices_list.html'
             },
            {'label': 'transactions',
             'template': 'transactions_list.html',
             }
        ]
        tab = kwargs.get('tab', tabs[0]['label'])
        data = {
            'period': period,
            'tabs': tabs,
            'selected_tab': tab,
            'base_url': flask.url_for('main',
                                      content_id='invoice_period',
                                      period=period.id,
                                      tab=tab)
        }

        report_args = {
            'start': pretty_date(period.start),
            'end': pretty_date(period.end),
            'details': kwargs.get('details', None),
            'group': kwargs.get('group', 1)
        }

        data.update(self.get_transactions_list(period=period.id))
        data.update(self.get_reports_invoices(**report_args))
        data.update(self.get_reports_time_distribution(**report_args))

        return data

    @dc.content
    def get_transaction_form(**kwargs):
        dm = dc.app.dm
        transaction_id = kwargs['transaction_id']
        if transaction_id:
            t = dm.get_transaction_by(id=transaction_id)
        else:
            t = dm.Transaction(date=dt.datetime.now(),
                               amount=0,
                               comment='')

        return {
            'transaction': t,
            'pi_list': [u for u in dm.get_users() if u.is_pi]
        }