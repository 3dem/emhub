import json

from emtools.utils import Pretty


def register_content(dc):
    @dc.content
    def cluster_queues(**kwargs):
        dm = dc.app.dm
        queuesConf = dm.get_config('queues')

        task = None
        # TODO: Get worker that monitor cluster from config
        ws = dm.get_worker_stream('svlpcryosparc01.stjude.org')
        for t in ws.get_pending_tasks():
            task = t

        if task:
            event_id, event = dm.get_task_lastevent(task)
            jobs = json.loads(event['queues'])

        return {
            'queues': queuesConf,
            'jobs': jobs,
            'task': task,
            'updated': Pretty.datetime(dm.dt_from_redis(event_id))
        }

    @dc.content
    def cluster_queues_content(**kwargs):
        return cluster_queues(**kwargs)
