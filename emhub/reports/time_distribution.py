
import re


class Counter:
    HEADERS = ["", "Bookings", "Days", "%"]
    FORMAT = u"{:>15}{:>10}{:>10}{:>10}"
    TOTAL = None

    def __init__(self, name, filter=None):
        self._name = name
        self.counter = 0
        self.days = 0
        self._filter = filter or self._filter_by_name

    def _filter_by_name(self, b):
        return self._name.lower() in b['title'].lower()

    def count(self, b):
        if self._filter(b):
            self.counter += 1
            self.days += b['days']
            return True
        return False


class CounterList:
    def __init__(self, *names):
        self._counters = [
            Counter('Total', lambda b: True),
            Counter('Reminder', lambda b: True)
        ]
        self.reminder = []

        for n in names:
            self.addCounter(n)

    def addCounter(self, counter):
        c = counter if isinstance(counter, Counter) else Counter(str(counter))
        self._counters.insert(-1, c)

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
        data = [[c._name, c.counter, c.days,
                 '%0.2f' % (c.days * 100 / total)]
                for c in self._counters]

        return data

    def print(self):
        format = Counter.FORMAT.format
        print(format(*Counter.HEADERS))
        for row in self.data():
            print(format(*row))

    def printReminder(self):
        for b in self.reminder:
            print(b['title'])


def is_maintainance(b):
    t = b['title'].lower()
    return any(k in t for k in ['cycle', 'installation', 'maintenance', 'afis'])

def is_developmnt(b):
    t = b['title'].lower()
    return any(k in t for k in ['method', 'research', 'tests', 'mikroed', 'microed'])


def get_cem(b):
    title = b['title'].upper()

    # Take only the first part of the application label
    # (because it can contains the alias in parenthesis)
    m = re.search("(CEM([0-9])+)", title)

    if m is not None:
        parsedCem = m.group(1).upper().strip()
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
    maintainance = Counter('Maintenance', is_maintainance)
    development = Counter('Developmnt', is_developmnt)
    CEM = Counter('CEM', filter=lambda b: get_cem(b) is not None)

    counters = CounterList('Downtime', maintainance, 'DBB', CEM, development)
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



