import json

from emhub.client import open_client
from faker import Faker

faker = Faker()

with open_client() as dc:
    users = dc.request('get_users').json()
    json_data = {'users': []}
    f = open('users.json', 'w')
    total = 0
    for u in users:
        fname = faker.name()
        name = ' '.join(fname.split(' ')[-2:])
        email = name.lower().replace(' ', '.') + '@emhub.org'
        attrs = {'id': u['id'], 'name': name, 'email': email, 'roles': u['roles'], 'pi_id': u['pi_id']}
        json_data['users'].append(attrs)
        if u['status'] == 'active':
            f.write(f"{json.dumps(attrs)},\n") 
            total += 1
    f.close()

    print("Total", total)

    #with open('users.json', 'w') as f:
    #    json.dump(json_data, f)
