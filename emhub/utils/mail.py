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

import threading
import flask_mail


class MailManager:
    """ Helper class to send emails via Flask app. """
    def __init__(self, app):
        self._app = app
        self._mail = flask_mail.Mail(app)

    def __send_async(self, msg):
        with self._app.app_context():
            self._mail.send(msg)

    def send_mail(self, recipients, subject, body, sender=None, html_body=None):
        sender = sender or self._app.config['MAIL_DEFAULT_SENDER']
        msg = flask_mail.Message(subject, sender=sender, recipients=recipients)
        msg.body = body
        msg.html = html_body
        threading.Thread(target=self.__send_async, args=(msg,)).start()
