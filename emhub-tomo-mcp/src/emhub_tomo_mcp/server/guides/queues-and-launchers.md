# Queues and launchers

Each site configures EMhub-Tomo in `emwrap.bashrc` (the `EMWRAP_CONFIG` variable):

- **Launchers** are scripts that set up a program's environment (modules, conda environments, containers) and run it. There is one per program: WARP, RELION, PYTOM, ARETOMO2, ARETOMO3, IMOD and others.
- **Queues** decide where a job runs. The queue `None` runs the job directly on the machine where EMhub runs. Other queues write a batch script from a template and submit it to the cluster's scheduler (SLURM, LSF, ...).

A job's queue is the parameter `queue.name`; queue-specific settings are parameters `queue.param.<queue>.<name>`. describe_job_type lists the queues configured on this server.

GPU jobs should normally go to a cluster queue: with the `None` queue they run on the EMhub host, which is often a shared login node.

Common failure causes related to the site set-up:

- a launcher cannot find its program (module not loaded, wrong conda environment): look for "command not found" or "No such file" in `run.err`;
- CUDA library errors: the program and the loaded CUDA version do not match;
- the batch system refused or killed the job (memory, time limit): check `run.err`, `job.log` and the job's `job.script`.
