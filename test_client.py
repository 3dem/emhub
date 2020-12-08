
import re

from emhub.client import DataClient

# online emhub credentials
#dc = DataClient("https://emhub.cryoem.se/")
#dc.login('hal@scilifelab.se', '1q2w3e4r')

# Local testing environment
dc = DataClient()
dc.login('delarosatrevin@scilifelab.se', 'delarosatrevin@scilifelab.se')

# Get all bookings in 2020
r = dc.request('get_bookings_range', jsonData={'start': '2020-01-01', 'end': '2020-12-31'})

dc.logout()

def is_microscope_booking(b):
    return b['resource']['is_microscope'] and 'SLOT' not in b['title']

# Get only microscope bookings
bookings = [b for b in r.json() if is_microscope_booking(b)]


# class Counter:
#     HEADERS = ["", "Bookings", "Days", "%"]
#     FORMAT = u"{:>15}{:>10}{:>10}{:>10}"
#     TOTAL = None
#
#     def __init__(self, name, filter=None):
#         self._name = name
#         self.counter = 0
#         self.days = 0
#         self._filter = filter or self._filter_by_name
#
#     def _filter_by_name(self, b):
#         return self._name.lower() in b['title'].lower()
#
#     def count(self, b):
#         if self._filter(b):
#             self.counter += 1
#             self.days += b['days']
#             return True
#         return False
#
#     def print(self):
#         per = "%0.2f" % (self.days * 100 / self.TOTAL)
#         print(self.FORMAT.format(self._name, self.counter, self.days, per))
#
#
# class CounterList:
#     def __init__(self, *names):
#         self._counters = [
#             Counter('Total', lambda b: True),
#             Counter('Reminder', lambda b: True)
#         ]
#         self._reminder_list = []
#
#         for n in names:
#             self.addCounter(n)
#
#     def addCounter(self, counter):
#         c = counter if isinstance(counter, Counter) else Counter(str(counter))
#         self._counters.insert(-1, c)
#
#     def count(self, b):
#         self._counters[0].count(b)  # Always count total
#
#         def _any():
#             for c in self._counters[1:-1]:
#                 if c.count(b):
#                     return True
#             return False
#
#         if not _any():
#             self._reminder_list.append(b)
#             self._counters[-1].count(b)  # Count reminder
#
#     def print(self):
#         print(Counter.FORMAT.format(*Counter.HEADERS))
#         Counter.TOTAL = self._counters[0].days
#         for c in self._counters:
#             c.print()
#
#     def printReminder(self):
#         for b in self._reminder_list:
#             print(b['title'])
#
#
# def is_maintainance(b):
#     t = b['title'].lower()
#     return any(k in t for k in ['cycle', 'installation', 'maintenance', 'afis'])
#
#
# def get_cem(b):
#     title = b['title'].upper()
#
#     # Take only the first part of the application label
#     # (because it can contains the alias in parenthesis)
#     m = re.search("(CEM([0-9])+)", title)
#
#     if m is not None:
#         parsedCem = m.group(1).upper().strip()
#         # Enforce numeric part is exactly 5 digits
#         cemNumber = m.group(2)
#         n = len(cemNumber)
#         if n < 5:
#             cemNumber = "0" * (5 - n) + cemNumber
#         else:
#             cemNumber = cemNumber[-5:]
#
#         return 'CEM' + cemNumber
#
#     return None
#
#
# class CemCounter(Counter):
#     def _filter_by_name(self, b):
#         return self._name.upper() == get_cem(b)


# def get_booking_counters(bookings):
#     maintainance = Counter('Maintenance', is_maintainance)
#     CEM = Counter('CEM', filter=lambda b: get_cem(b) is not None)
#
#     counters = CounterList('Downtime', maintainance, 'DBB', CEM, 'roED')
#     cem_counters = CounterList()
#
#     cem_dict = {}
#
#     for b in bookings:
#         title = b['title']
#
#         if 'Ume' in title:
#             continue
#
#         counters.count(b)
#
#         cem = get_cem(b)
#
#         if cem is not None:
#             c = cem_dict.get(cem, 0)
#             cem_dict[cem] = c + 1
#             if not c:
#                 cem_counters.addCounter(CemCounter(cem))
#             cem_counters.count(b)
#
#     return counters, cem_counters


from emhub.reports import get_booking_counters
counters, cem_counters = get_booking_counters(bookings)

print()
counters.print()

print()
cem_counters.print()


