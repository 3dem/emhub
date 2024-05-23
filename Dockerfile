FROM python:3.8

LABEL description="Python 3.8 based image to run emhub application"
LABEL maintainer="J.M. de la Rosa Trevin delarosatrevin@gmail.com"

RUN apt update
RUN apt install -y redis redis-server python3-redis python3-hiredis
RUN pip install "redis[hiredis]"

#RUN pip install emhub

# Or in devel mode
RUN git clone https://github.com/3dem/emtools.git
RUN pip install -e emtools/

RUN git clone https://github.com/3dem/emhub.git
RUN pip install -e emhub/

ENV EMHUB_INSTANCE /instance

CMD ["bash", "/instance/run_emhub.sh"]

#CMD [ "gunicorn", "-k", "gevent", "--workers=2", "emhub:create_app()", "--bind", "0.0.0.0:8080" ]
