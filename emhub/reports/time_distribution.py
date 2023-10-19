
import re


class Counter:
    HEADERS = ["", "Bookings", "Days", "%", "Cost"]
    FORMAT = u"{:>15}{:>10}{:>10}{:>10}{:>10}"
    TOTAL = None

    def __init__(self, name, filter=None):
        self._name = name
        self.counter = 0
        self.days = 0
        self.cost = 0
        self.bookings = []
        self._filter = filter or self._filter_by_name

    def _filter_by_name(self, b):
        return self._name.lower() in b['title'].lower()

    def count(self, b):
        if self._filter(b):
            self.counter += 1
            self.cost += b['total_cost']
            self.days += b['days']
            self.bookings.append(b)
            return True
        return False


class CounterList:
    def __init__(self, *names):
        self._counters = [
            Counter('Total', lambda b: True),
            Counter('Reminder', lambda b: True)
        ]
        self.reminder = []
        self._countersDict = {c._name: c for c in self._counters}

        for n in names:
            self.addCounter(n)


    def __getitem__(self, item):
        return self._countersDict[item]

    def addCounter(self, counter):
        c = counter if isinstance(counter, Counter) else Counter(str(counter))
        self._counters.insert(-1, c)
        self._countersDict[c._name] = c

    def count(self, b):
        self._counters[0].count(b)  # Always count total

        def _any():
            for c in self._counters[1:-1]:
                if c.count(b):
                    return True
            return False

        if not _any():
            self.reminder.append(b)
            self._counters[-1].count(b)  # Count reminder

    def data(self):
        total = self._counters[0].days
        if total > 0:
            data = [[c._name, c.counter, c.days,
                     '%0.2f' % (c.days * 100 / total), c.cost]
                    for c in self._counters]
        else:
            data = [[]]

        return data

    def print(self):
        format = Counter.FORMAT.format
        print(format(*Counter.HEADERS))
        for row in self.data():
            print(format(*row))

    def printReminder(self):
        for b in self.reminder:
            print(b['title'])


MAINTENANCE_LIST = ['cycle', 'installation', 'maintenance', 'afis']
DEVELOPMENT_LIST = ['method', 'research', 'test', 'mikroed', 'microed', 'devel']
DOWNTIME_LIST = ['downtime', 'down']

def _match_title(b, keywords):
    t = b['title'].lower()
    return any(k in t for k in keywords)

def is_maintenance(b):
    return b['type'] == 'maintenance' or _match_title(b, MAINTENANCE_LIST)


def is_development(b):
    return _match_title(b, DEVELOPMENT_LIST)

def is_downtime(b):
    return b['type'] == 'downtime' or _match_title(b, DOWNTIME_LIST)


def get_cem(b):
    title = b['title'].upper()

    # Take only the first part of the application label
    # (because it can contains the alias in parenthesis)
    m = re.search("(CEM([0-9]+))", title)

    if m is not None:
        # Enforce numeric part is exactly 5 digits
        cemNumber = m.group(2)
        n = len(cemNumber)
        if n < 5:
            cemNumber = "0" * (5 - n) + cemNumber
        else:
            cemNumber = cemNumber[-5:]

        return 'CEM' + cemNumber

    return None


class CemCounter(Counter):
    def _filter_by_name(self, b):
        return self._name.upper() == get_cem(b)


def get_booking_counters(bookings):
    maintenance = Counter('Maintenance', is_maintenance)
    development = Counter('Development', is_development)
    downtime = Counter('Downtime', is_downtime)
    CEM = Counter('CEM', filter=lambda b: get_cem(b) is not None)

    counters = CounterList(downtime, maintenance, 'DBB', CEM, development)
    cem_counters = CounterList()

    cem_dict = {}

    for b in bookings:
        title = b['title']

        if 'Ume' in title:
            continue

        counters.count(b)

        cem = get_cem(b)

        if cem is not None:
            c = cem_dict.get(cem, 0)
            cem_dict[cem] = c + 1
            if not c:
                cem_counters.addCounter(CemCounter(cem))
            cem_counters.count(b)

    return counters, cem_counters



