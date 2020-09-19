
import sys
import json
from .data_client import DataClient

sc = DataClient()

method = sys.argv[1]
jsonData = json.loads(sys.argv[2])

print("method: ", method)
print("jsonData: ", jsonData)

sc.request(method, jsonData)

print("Result: \n", sc.json())
