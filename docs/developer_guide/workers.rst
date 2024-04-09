
Developing Workers
==================

Workers are basically Python scripts that will communicate with
EMhub via its REST API (:ref:`using Python client code <Using EMhub Client>`). It is a great
way to extend EMhub functionality and get some tasks executed in
other machines than the one running the EMhub server. Then main different between
a worker and simple script using the API, that the worker is suppose to be running all time
(e.g a Linux service) and have two-ways communication with the EMhub server.

For example, one could use a worker in a machine that has access
to the images directory. That worker could get notified (via a task)
when a new session has started and the exact data folder. From there,
the worker can handle data transfer and trigger on-the-fly
processing if required. The worker can also update back the
information associated to a session about the progress of these
tasks (e.g number files transferred, total size, etc).

We provide some base classes to help with the communication
part and some common operations. In most cases, but it is very
likely that implementing a worker will require some coding to
adapt to the specific need of the task to be done and its
environment.


Basic Classes
-------------
When implementing a new worker, we mainly need to deal with two classes:
`TaskHandler` and `Worker`. In the `TaskHandler`, we need to implement the `process`
method that will do the processing of the task. This method will be called
insite the handler infinite loop until the `stop` method is called. 

Example
-------
