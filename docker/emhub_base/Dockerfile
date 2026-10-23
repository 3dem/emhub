
FROM python:3.12

LABEL description="Python 3.12 based image to run emhub application"
LABEL maintainer="J.M. de la Rosa Trevin delarosatrevin@gmail.com"

RUN pip install emhub

ENV EMHUB_INSTANCE /instance

CMD [ "gunicorn", "-k", "gevent", "--workers=2", "emhub:create_app()", "--bind", "0.0.0.0:8080" ]
