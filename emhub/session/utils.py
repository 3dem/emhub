import datetime, decimal


def sqltojson(obj):
    """JSON encoder function for SQLAlchemy special classes."""
    if isinstance(obj, datetime.date):
        return obj.isoformat()
    elif isinstance(obj, decimal.Decimal):
        return float(obj)

    # how to use:
    # sessions = some query result
    # return json.dumps([dict(s) for s in sessions], default=sqltojson)
