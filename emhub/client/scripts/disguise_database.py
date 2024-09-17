from emhub.client import DataClient, open_client
from faker import Faker

with open_client() as dc:

    # Update user's name and email with fake values
    users = dc.request('get_users', jsonData=None).json()
    f = Faker()
    for u in users:
        name = ' '.join(f.name().split(' ')[-2:])
        email = name.lower().replace(' ', '.') + '@emhub.org'
        attrs = {'id': u['id'], 'name': name, 'email': email}
        dc.request('update_user', jsonData={'attrs': attrs})

    # Modify sessions to hide real name
    sessions = dc.request('get_sessions', jsonData=None).json()
    for s in sessions:
        dc.update_session({'id': s['id'], 'name': f"S{s['id']:05d}"})

    # Hide project's title and make all 'confidential'
    projects = dc.request('get_projects', jsonData=None).json()
    for p in projects:
        # read 'extra' property where 'is_confidential' is stored
        extra = dict(p['extra'])
        extra['is_confidential'] = True
        attrs = {'id': p['id'], 'extra': extra, 'title': 'Project Title'}
        dc.request('update_project', jsonData={'attrs': attrs})


