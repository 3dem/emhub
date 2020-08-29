
import sys
from .session_client import SessionClient

sc = SessionClient()

method = sys.argv[1]
jsonData = {k: v for k, v in [a.split('=') for a in sys.argv[2:]]}

print("method: ", method)
print("jsonData: ", jsonData)

sc.request(method, jsonData)

print("Result: \n", sc.json())
