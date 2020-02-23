from emhub.session.sqlalchemy import SessionManager

sm = SessionManager('instance/emhub.sqlite')

print(sm.get_sessions(asJson=True))
