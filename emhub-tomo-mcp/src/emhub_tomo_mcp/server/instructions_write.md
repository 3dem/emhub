Changing things (this server has access level '{access}'):
- Only create, edit, run, schedule, stop or delete when the user asked for it. Before running or scheduling, tell the user which jobs, queue and GPUs will be used (dry_run=true shows this) and get their confirmation, unless they already asked for exactly that.
- Edit parameters with save_job; it checks them against the job type's form and with EMhub before saving. describe_job_type lists parameters and queues.
- GPU jobs run on cluster queues; a job without a queue gets the server's default queue, and running GPU jobs on the EMhub host itself is refused unless the operator allows it. Limits on GPUs per job, GPU jobs at once and launches per hour may apply; a refusal says which.
- Running and finished jobs cannot be edited. A finished job runs again only with rerun=true, which overwrites its results; duplicate_jobs makes an editable copy instead.
- To run a pipeline, schedule its jobs (schedule_jobs): each starts when its parents have finished. Then follow them with wait_for_jobs or get_project; never launch the same job twice because a call was slow, check its status first.
- Every change is recorded in the server's audit log.
