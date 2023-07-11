
import sys
import json
from pprint import pprint

from emhub.client import open_client, config

method = sys.argv[1]
jsonData = json.loads(sys.argv[2])

print("method: ", method)
print("jsonData: ", jsonData)


with open_client() as dc:
    r = dc.request(method, jsonData=jsonData)
    pprint(r.json())