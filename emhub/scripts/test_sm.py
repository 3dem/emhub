from emhub.session.sqlalchemy import DataManager

sm = DataManager('instance/emhub.sqlite')

print(sm.get_sessions(asJson=True))
