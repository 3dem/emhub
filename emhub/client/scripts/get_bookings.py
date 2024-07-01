
import json
import os.path

from emhub.client import open_client


with open_client() as dc:
    r = dc.request('get_bookings_range',
                   jsonData={'start': '2023-02-27', 'end': '2023-05-31', 'func': 'to_json'})
    cols = ['id', 'type', 'resource_id', 'start', 'end', 'creator_id', 'owner_id', 'operator_id', 'project_id']

    f = open('bookings.json', 'w')
    f.write('"bookings": [\n')
    print("\n\n>>>> BOOKINGS: \n")
    bookings = set()
    for i, b in enumerate(r.json()):
        if i:
            f.write(',\n\t')
        attrs = {k: b[k] for k in cols}
        # Avoid default type booking
        if attrs['type'] == 'booking':
            del attrs['type']
        f.write(f"   {json.dumps(attrs)}")
        bookings.add(b['id'])

    print(f"Total bookings: {len(bookings)}")
    print("\nFull booking:")
    print(b)

    print("\n\n>>>> SESSIONS: \n")
    r = dc.request('get_sessions')

    c = 0
    f.write('\n]\n,"sessions": [\n')
    for s in r.json():
        if s['booking_id'] in bookings:
            name = s['name']
            newName = 'S%05d' % s['id']
            del s['name']
            del s['stats']
            del s['end']
            if dp := s['data_path']:
                s['data_path'] = os.path.basename(dp).replace(name, newName)
            e = s['extra']
            if otf_path := e.get('otf', {}).get('path', None):
                e['otf']['path'] = os.path.join('~/.emhub/otf',
                                                os.path.basename(otf_path).replace(name, newName))
            if raw_path := e.get('raw', {}).get('path', None):
                e['raw']['path'] = os.path.join('~/.emhub/raw',
                                                os.path.basename(raw_path).replace(name, newName))
            if frames_path := e.get('raw', {}).get('frames', None):
                e['raw']['frames'] = os.path.join('~/.emhub/frames',
                                                  os.path.basename(frames_path).replace(name, newName))
            if c:
                f.write(',\n\t')
            c += 1
            f.write(f"   {json.dumps(s)}")

    f.write('\n]\n')
    f.close()

    print("\nFull session:")
    print(json.dumps(s, indent=4))
    print(f"Total sessions: {c}")
