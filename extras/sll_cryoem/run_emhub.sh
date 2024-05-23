#!/bin/bash

cd $EMHUB_INSTANCE && redis-server redis.conf --daemonize yes

cd /emtools && git checkout devel && pip install -e .
cd /emhub && git checkout devel-sll && pip install -e .

gunicorn -k gevent --workers=4 "emhub:create_app()" --bind 0.0.0.0:8080
