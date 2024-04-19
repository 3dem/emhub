
Developing Workers
==================

Workers are Python scripts that will communicate with EMhub via its REST API
(:ref:`using Python client code <Using EMhub Client>`). It is a great
way to extend EMhub functionality and get some tasks executed in
machines other than those running the EMhub server. The main difference between
a worker and a simple script using the API is that the worker is supposed to run
all the time (e.g., as a Linux service) and maintain two-way communication with the EMhub server.

For example, one could use a worker in a machine that has access
to the images directory. That worker could get notified (via a task)
when a new session has started and the exact data folder. From there,
the worker can handle data transfer and trigger on-the-fly
processing if required. The worker can also update back the
information associated with a session about the progress of these
tasks (e.g., number of files transferred, total size, etc).

We provide some base classes to help with communication
part and some common operations. In most cases, but it is very
likely that implementing a worker will require some coding to
adapt to the specific need of the task to be done and its
environment.



Basic Classes
-------------
When implementing a new worker, we mainly need to deal with two classes:
`TaskHandler` and `Worker`. In the `TaskHandler`, we need to implement the `process`
method that will do the processing of the task. This method will be called
inside the handler infinite loop until the `stop` method is called.

Example
-------
