
import json
from emhub.client import open_client


with open_client() as dc:
    r = dc.request('get_projects')
    for project in r.json():
        del project['description']
        del project['title']
        del project['status']
        print(f"{json.dumps(project)},")

