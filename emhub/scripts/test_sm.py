from emhub.data.data_manager import DataManager

sm = DataManager('instance/emhub.sqlite')

print(sm.get_sessions(asJson=True))
