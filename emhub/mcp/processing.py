# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *
# * [1] SciLifeLab, Stockholm University
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# * This program is distributed in the hope that it will be useful,
# * but WITHOUT ANY WARRANTY; without even the implied warranty of
# * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# * GNU General Public License for more details.
# *
# * You should have received a copy of the GNU General Public License
# * along with this program; if not, write to the Free Software
# * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA
# * 02111-1307  USA
# *
# *  All comments concerning this program package may be sent to the
# *  e-mail address 'delarosatrevin@scilifelab.se'
# *
# **************************************************************************
"""
'Data processing' MCP tools: list processing projects, and for each
project inspect/run jobs and workflows.

A "processing project" in EMhub is a folder on disk (an emwrap/Relion
style project, with a 'default_pipeline.star') that is reached either:

  * from a `Session` that has ``data_path`` set (the common case: an
    on-the-fly/OTF processing project tied to a microscope session), or
  * from an `Entry` of type 'tomo_processing' that stores its path in
    ``extra['data']['processing_path']`` (standalone/offline
    reprocessing projects, not tied to any session).

Every tool below therefore identifies *which* project it operates on
with one of three mutually exclusive selectors: ``session_id``,
``entry_id`` or ``path``, exactly like the underlying
``/api/get_session_workflow``, ``/api/launch_job``, etc. endpoints
(see ``get_project_manager()`` in ``emhub.blueprints.api``).

Registered by :func:`register_tools`, called from ``emhub.mcp.server``.
Read-only tools are always registered; job/workflow action tools
(save/run/stop/delete/...) are only registered when ``allow_write`` is
True (admin/developer EMhub users, see ``EmhubMcpClient.is_admin``).
"""


def _selector_attrs(session_id=None, entry_id=None, path=None):
    """ Build the ``attrs`` fragment identifying a processing project,
    validating that exactly one selector was given. """
    given = [(k, v) for k, v in
            (('session_id', session_id), ('entry_id', entry_id),
             ('path', path)) if v is not None]
    if len(given) != 1:
        raise ValueError(
            "Provide exactly one of 'session_id', 'entry_id' or 'path' "
            "to identify the processing project.")
    key, value = given[0]
    return {key: value}


def register_tools(mcp, client, allow_write):
    """ Register the data-processing tools on the given FastMCP server.

    Args:
        mcp: The ``mcp.server.fastmcp.FastMCP`` instance.
        client: A connected ``EmhubMcpClient``.
        allow_write (bool): Whether to also register the job/workflow
            action tools (save/run/schedule/stop/delete/...).
    """

    # ------------------------------------------------------------------
    # Listing processing projects
    # ------------------------------------------------------------------
    @mcp.tool()
    def list_processing_projects(only_with_data: bool = True) -> list:
        """ List EMhub processing projects.

        This combines two sources:
          * Sessions that have a processing path set (``data_path``),
            i.e. on-the-fly (OTF) processing tied to a microscope
            session.
          * Entries of type 'tomo_processing', i.e. standalone/offline
            (re)processing projects not tied to a session.

        Args:
            only_with_data: If True (default), only return sessions
                that actually have ``data_path`` set. Set to False to
                also include sessions without a processing path yet
                (kind will still be 'session' but 'data_path' is null).

        Returns:
            A list of dicts, each with:
              - kind: 'session' or 'entry'
              - id: the session or entry id
              - name: session name, or entry title
              - status: session status (only for kind='session')
              - data_path: the processing project's path on disk
              - selector: the selector dict to pass to the other
                processing tools (e.g. {'session_id': 12} or
                {'entry_id': 7})
        """
        projects = []

        condition = 'data_path IS NOT NULL' if only_with_data else None
        for s in client.get('sessions', condition=condition):
            if only_with_data and not s.get('data_path'):
                continue
            projects.append({
                'kind': 'session',
                'id': s['id'],
                'name': s.get('name'),
                'status': s.get('status'),
                'data_path': s.get('data_path'),
                'selector': {'session_id': s['id']},
            })

        for e in client.get('entries', condition="type='tomo_processing'"):
            processing_path = ((e.get('extra') or {}).get('data') or {}).get(
                'processing_path')
            projects.append({
                'kind': 'entry',
                'id': e['id'],
                'name': e.get('title'),
                'status': None,
                'data_path': processing_path,
                'selector': {'entry_id': e['id']},
            })

        return projects

    @mcp.tool()
    def list_workflow_templates() -> list:
        """ List the processing workflow templates available on this
        EMhub server (e.g. pre-defined Warp/Relion pipelines), that can
        be loaded into a project with ``load_workflow``/``run_workflow``.

        Returns:
            A list of dicts: id (to pass as workflow_id), title,
            description, file.
        """
        return client.call('get_workflows', {})

    # ------------------------------------------------------------------
    # Inspecting jobs / workflow of a project
    # ------------------------------------------------------------------
    @mcp.tool()
    def get_processing_workflow(session_id: int = None, entry_id: int = None,
                                path: str = None, widget: bool = True) -> dict:
        """ Get the full workflow (all jobs and how they are connected)
        of a processing project. Identify the project with exactly one
        of session_id / entry_id / path.

        Args:
            widget: If True (default), return the rich UI-widget format
                (a dict keyed by job id, with parents/children/status/
                parameters). If False, return a flat list of jobs with
                id/label/links/status/type - simpler to scan quickly.
        """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['widget'] = widget
        return client.call('get_session_workflow', attrs)

    @mcp.tool()
    def get_job(run_id, session_id: int = None, entry_id: int = None,
               path: str = None, outputs: list = None) -> dict:
        """ Get details of a single job (aka 'run' or 'protocol') within
        a processing project. Identify the project with exactly one of
        session_id / entry_id / path.

        Args:
            run_id: Id of the job/run within the project (as reported
                by get_processing_workflow).
            outputs: Which pieces of info to include; any subset of
                'json' (parameters, inputs/outputs), 'stdout', 'stderr',
                'form' (job form definition). Defaults to ['json'].
        """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['run_id'] = run_id
        attrs['output'] = outputs or ['json']
        return client.call('get_session_run', attrs)

    if not allow_write:
        return

    # ------------------------------------------------------------------
    # Job / workflow actions (admin / developer only)
    # ------------------------------------------------------------------
    @mcp.tool()
    def save_job(params: dict, run_id=None, job_type: str = None,
                session_id: int = None, entry_id: int = None,
                path: str = None) -> dict:
        """ Save (create or update) a job's parameters within a
        processing project, without running it. Identify the project
        with exactly one of session_id / entry_id / path.

        Args:
            params: Job parameters dict (as expected by that job type's
                form; see get_job(..., outputs=['form']) for the
                schema).
            run_id: Id of an existing job to update. Mutually exclusive
                with job_type.
            job_type: Class name of a new job to create (e.g.
                'MotionCorr', 'CtfFind'). Mutually exclusive with
                run_id.
        """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['params'] = params
        if run_id is not None:
            attrs['run_id'] = run_id
        if job_type is not None:
            attrs['job_type'] = job_type
        return client.call('save_job', attrs)

    @mcp.tool()
    def launch_job(params: dict = None, run_id=None, job_type: str = None,
                   clean: bool = False, session_id: int = None,
                   entry_id: int = None, path: str = None) -> dict:
        """ Run a single job now, within a processing project. Identify
        the project with exactly one of session_id / entry_id / path.

        Args:
            params: Job parameters dict. Required when creating a new
                job (job_type given); optional when re-running an
                existing one (run_id given, uses its saved params).
            run_id: Id of an existing job to (re)run. Mutually
                exclusive with job_type.
            job_type: Class name of a new job to create and run.
                Mutually exclusive with run_id.
            clean: If True, clean the job's output directory before
                running (restart from scratch).
        """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['params'] = params or {}
        attrs['clean'] = clean
        if run_id is not None:
            attrs['run_id'] = run_id
        if job_type is not None:
            attrs['job_type'] = job_type
        return client.call('launch_job', attrs)

    @mcp.tool()
    def schedule_job(params: dict = None, run_id=None, job_type: str = None,
                     interval: int = 5, session_id: int = None,
                     entry_id: int = None, path: str = None) -> dict:
        """ Schedule a job to run repeatedly in the background (a
        per-job watcher), used for continuous/on-the-fly processing.
        Identify the project with exactly one of session_id / entry_id
        / path.

        Args:
            params: Job parameters dict (optional if run_id refers to
                an already-saved job).
            run_id: Id of an existing job to schedule. Mutually
                exclusive with job_type.
            job_type: Class name of a new job to create and schedule.
                Mutually exclusive with run_id.
            interval: Minutes between each check/run of the watcher.
        """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['interval'] = interval
        if params is not None:
            attrs['params'] = params
        if run_id is not None:
            attrs['run_id'] = run_id
        if job_type is not None:
            attrs['job_type'] = job_type
        return client.call('schedule_job', attrs)

    @mcp.tool()
    def stop_jobs(run_ids: list, session_id: int = None, entry_id: int = None,
                 path: str = None) -> dict:
        """ Stop one or more running/scheduled jobs. Identify the
        project with exactly one of session_id / entry_id / path. """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['run_ids'] = run_ids
        return client.call('stop_jobs', attrs)

    @mcp.tool()
    def delete_jobs(run_ids: list, session_id: int = None, entry_id: int = None,
                    path: str = None) -> dict:
        """ Delete one or more jobs (and their output folders) from a
        processing project. Identify the project with exactly one of
        session_id / entry_id / path. """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['run_ids'] = run_ids
        return client.call('delete_jobs', attrs)

    @mcp.tool()
    def duplicate_jobs(run_ids: list, session_id: int = None,
                       entry_id: int = None, path: str = None) -> dict:
        """ Duplicate one or more existing jobs within a processing
        project (copies their saved parameters into new jobs, does not
        run them). Identify the project with exactly one of session_id
        / entry_id / path. """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['run_ids'] = run_ids
        return client.call('duplicate_jobs', attrs)

    @mcp.tool()
    def load_workflow(workflow_id: str, session_id: int = None,
                      entry_id: int = None, path: str = None) -> dict:
        """ Load a workflow template into a processing project: creates
        the jobs defined by the template (with their default
        parameters), but does NOT run them yet. Use launch_job /
        schedule_job afterwards to run the created jobs, or use
        run_workflow to do both in one step. Identify the project with
        exactly one of session_id / entry_id / path.

        Args:
            workflow_id: Id of the workflow template, as returned by
                list_workflow_templates().
        """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['workflow_id'] = workflow_id
        return client.call('load_workflow', attrs)

    @mcp.tool()
    def run_workflow(workflow_id: str, interval: int = 5,
                     session_id: int = None, entry_id: int = None,
                     path: str = None) -> dict:
        """ Load a workflow template into a processing project AND
        schedule every job it creates, so the whole pipeline starts
        running (each job's watcher checks for new/updated input every
        `interval` minutes). This is the composite "run this workflow"
        action; use load_workflow + launch_job/schedule_job individually
        for finer control over each job. Identify the project with
        exactly one of session_id / entry_id / path.

        Args:
            workflow_id: Id of the workflow template, as returned by
                list_workflow_templates().
            interval: Minutes between each check/run of every scheduled
                job's watcher.

        Returns:
            dict with the loaded workflow info (as returned by
            load_workflow) plus a 'scheduled' list reporting the
            schedule_job result for each newly created job id.
        """
        attrs = _selector_attrs(session_id, entry_id, path)

        def _job_ids():
            # widget=False returns a flat list of jobs (id, label, links,
            # status, type), simplest form to diff before/after.
            wf = client.call('get_session_workflow', dict(attrs, widget=False))
            return {j['id'] for j in wf.get('workflow', [])}

        jobs_before = _job_ids()
        load_result = client.call(
            'load_workflow', dict(attrs, workflow_id=workflow_id))
        new_job_ids = sorted(_job_ids() - jobs_before)

        scheduled = []
        for job_id in new_job_ids:
            sched_attrs = dict(attrs, run_id=job_id, interval=interval)
            try:
                client.call('schedule_job', sched_attrs)
                scheduled.append({'run_id': job_id, 'status': 'scheduled'})
            except Exception as e:
                scheduled.append({'run_id': job_id, 'status': 'error',
                                  'error': str(e)})

        result = dict(load_result)
        result['new_job_ids'] = new_job_ids
        result['scheduled'] = scheduled
        return result

    @mcp.tool()
    def export_workflow(run_ids: list, output_path: str,
                        session_id: int = None, entry_id: int = None,
                        path: str = None) -> dict:
        """ Export a subset of jobs from a processing project into a
        standalone workflow file (that can later be loaded elsewhere
        with load_workflow). Identify the source project with exactly
        one of session_id / entry_id / path.

        Args:
            run_ids: Ids of the jobs to export.
            output_path: Path (on the EMhub server) where to write the
                exported workflow file.
        """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['run_ids'] = run_ids
        attrs['output_path'] = output_path
        return client.call('export_workflow', attrs)

    @mcp.tool()
    def save_job_annotation(run_id, run_name: str = '', comment: str = '',
                            session_id: int = None, entry_id: int = None,
                            path: str = None) -> dict:
        """ Save a display name and/or comment for a job, without
        changing its parameters. Identify the project with exactly one
        of session_id / entry_id / path. """
        attrs = _selector_attrs(session_id, entry_id, path)
        attrs['run_id'] = run_id
        attrs['runName'] = run_name
        attrs['comment'] = comment
        return client.call('save_job_annotation', attrs)
