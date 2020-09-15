
import sys
import smtplib
import ssl
from email.mime.text import MIMEText

host = 'smtp.kth.se'
port = 587

msg = MIMEText('This is a test email')
msg['Subject'] = 'Test mail'

sender = 'noreply@emhub.cryoem.se'
receivers = [sys.argv[1]]
msg['To'] = receivers[0]
msg['From'] = sender


smtp_server = smtplib.SMTP(host, port=port)
context = ssl.create_default_context()    
#smtp_server.starttls(context)
smtp_server.starttls()
#smtp_server.login(user, password)

#smtp_server.send_message(msg)
smtp_server.sendmail(sender, receivers, msg.as_string())
smtp_server.close()

