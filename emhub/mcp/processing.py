"""
'Data processing' MCP tools: list processing projects, and for each project
inspect and run its jobs and workflows.

A processing project in EMhub is a folder on disk (an emwrap/Relion style
project, with a 'default_pipeline.star') that is reached either:

  * from a `Session` that has ``data_path`` set (the common case: the
    on-the-fly/OTF processing of a microscope session), or
  * from an `Entry` of type 'tomo_processing' that stores its path in
    ``extra['data']['processing_path']`` (offline reprocessing projects,
    not tied to any session), or
  * directly from its folder ``path``.

Every tool identifies the project with one of the three mutually exclusive
selectors ``session_id``, ``entry_id`` or ``path``, exactly like the
underlying ``/api/get_session_workflow``, ``/api/launch_job``, ... endpoints
(see ``DataManager.get_processing_project``).

Registered by :func:`register_tools`, called from ``emhub.mcp.server``.
Read tools, creating tomo projects, job tools (save/duplicate/copy/
launch/schedule/stop, labels, notes) and exporting/loading workflows are
always registered, EMhub checks the user can edit the project. Deleting
jobs is only registered when ``allow_admin`` is True.
"""

from typing import Optional

from mcp.types import ToolAnnotations

from .client import EmhubMcpError

READ = ToolAnnotations(readOnlyHint=True)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False)
DESTRUCTIVE = ToolAnnotations(readOnlyHint=False, destructiveHint=True)

SESSION_FIELDS = ['id', 'name', 'start', 'end', 'status', 'data_path',
                  'resource_id']

# Long strings (e.g. base64 thumbnails) are not useful for the model
MAX_STRING = 2000


def _project_selector(session_id=None, entry_id=None, path=None):
    """ Build the ``attrs`` fragment identifying a processing project,
    validating that exactly one selector was given. """
    given = {k: v for k, v in [('session_id', session_id),
                               ('entry_id', entry_id),
                               ('path', path)] if v is not None}
    if len(given) != 1:
        raise EmhubMcpError("Provide exactly one of 'session_id', 'entry_id' "
                            "or 'path' to identify the processing project.")
    return given


def _strip_long(value):
    """ Replace long strings (thumbnails, ...) by a short placeholder. """
    if isinstance(value, str) and len(value) > MAX_STRING:
        return f'<{len(value)} characters omitted>'
    if isinstance(value, list):
        return [_strip_long(v) for v in value]
    if isinstance(value, dict):
        return {k: _strip_long(v) for k, v in value.items()}
    return value


def _tail(text, lines):
    """ Last ``lines`` lines of a text. """
    parts = (text or '').splitlines()
    if len(parts) <= lines:
        return '\n'.join(parts)
    return ('[... %d lines omitted ...]\n' % (len(parts) - lines)
            + '\n'.join(parts[-lines:]))


def register_tools(mcp, client, allow_admin=False):
    """ Register the data-processing tools on the given MCP server.

    Args:
        mcp: The ``MCPServer`` (mcp 2.x) or ``FastMCP`` (mcp 1.x) instance.
        client: A connected ``EmhubMcpClient``.
        allow_admin (bool): Whether to also register the admin tools
            (delete jobs).
    """

    def _project_root(session_id=None, entry_id=None, path=None):
        """ Folder of the project, needed by the file endpoints. """
        sel = _project_selector(session_id, entry_id, path)
        if path is not None:
            return path
        if session_id is not None:
            s = client.call('get_sessions', attrs=['data_path'],
                            condition='id=%d' % session_id)
            root = s[0].get('data_path') if s else None
        else:
            e = client.call('get_entries', attrs=['extra'],
                            condition='id=%d' % entry_id)
            root = (e[0].get('extra') or {}).get('data', {}).get(
                'processing_path') if e else None
        if not root:
            raise EmhubMcpError("No processing project found for %s" % sel)
        return root

    def _workflow_call(method, sel, **attrs):
        attrs.update(sel)
        return client.call(method, attrs=attrs, key='workflow')

    # ------------------------- Read tools ---------------------------------
    @mcp.tool(annotations=READ)
    def processing_list_projects(since: Optional[str] = None,
                                 include_entries: bool = True) -> dict:
        """ List processing projects: sessions with a processing folder
        (on-the-fly processing, select them with session_id) and,
        optionally, standalone 'tomo_processing' entries (select them with
        entry_id).

        Args:
            since: Only sessions started from this day, 'YYYY-MM-DD'.
                Without it the last 50 sessions with processing are
                returned.
            include_entries: Also list 'tomo_processing' entries.
        """
        cond = "data_path != ''"
        if since:
            cond += " AND start >= '%s'" % since
        sessions = client.call('get_sessions', attrs=SESSION_FIELDS,
                               condition=cond, orderBy='id DESC')
        result = {'sessions': sessions if since else sessions[:50]}

        if include_entries:
            entries = client.call('get_entries',
                                  attrs=['id', 'title', 'date', 'project_id',
                                         'extra'],
                                  condition="type='tomo_processing'",
                                  orderBy='id DESC')
            result['entries'] = [{
                'id': e['id'], 'title': e.get('title'), 'date': e.get('date'),
                'project_id': e.get('project_id'),
                'processing_path': ((e.get('extra') or {}).get('data') or {})
                .get('processing_path')
            } for e in entries]
        return result

    @mcp.tool(annotations=READ)
    def processing_get_workflow(session_id: Optional[int] = None,
                                entry_id: Optional[int] = None,
                                path: Optional[str] = None) -> list[dict]:
        """ Get the jobs of a processing project and how they connect.
        Each job has an 'id' (e.g. 'MotionCorr/job002/', used as run_id by
        the other tools), a 'label' (job alias and elapsed time), 'status'
        (e.g. 'launched', 'running', 'finished', 'failed', 'aborted',
        'scheduled', 'saved'), 'type' (job type) and 'links' (ids of the
        jobs that use its outputs).

        Provide exactly one of session_id, entry_id or path.
        """
        return _workflow_call('get_session_workflow',
                              _project_selector(session_id, entry_id, path))

    @mcp.tool(annotations=READ)
    def processing_get_job(run_id: str,
                           session_id: Optional[int] = None,
                           entry_id: Optional[int] = None,
                           path: Optional[str] = None,
                           include_logs: bool = False,
                           log_lines: int = 100,
                           include_form: bool = False) -> dict:
        """ Get the details of a job: parameter values, info (status,
        dates, ...), inputs and outputs.

        Args:
            run_id: Job id, as returned by processing_get_workflow.
            session_id, entry_id, path: Project selector, provide one.
            include_logs: Also return the last log_lines lines of the job
                stdout and stderr (useful to diagnose failed jobs).
            log_lines: Number of log lines to return.
            include_form: Also return the parameters form definition
                (all available parameters with defaults and help), needed
                before editing parameters with processing_save_job.
        """
        outputs = ['json']
        if include_logs:
            outputs += ['stdout', 'stderr']
        if include_form:
            outputs.append('form')
        attrs = dict(_project_selector(session_id, entry_id, path),
                     run_id=run_id, output=outputs)
        run = client.call('get_session_run', attrs=attrs, key='run')
        for k in ('stdout', 'stderr'):
            if k in run:
                run[k] = _tail(run[k], log_lines)
        return _strip_long(run)

    @mcp.tool(annotations=READ)
    def processing_list_files(folder: str = '',
                              session_id: Optional[int] = None,
                              entry_id: Optional[int] = None,
                              path: Optional[str] = None) -> list[dict]:
        """ List the files of a folder inside a processing project
        (name, path, isDir, size, plus image dimensions for EM images).

        Args:
            folder: Folder relative to the project root, e.g.
                'MotionCorr/job002' ('' for the project root).
            session_id, entry_id, path: Project selector, provide one.
        """
        root = _project_root(session_id, entry_id, path)
        return client.call('list_project_dir',
                           attrs={'root': root, 'path': folder}, key='items')

    @mcp.tool(annotations=READ)
    def processing_read_file(file_path: str,
                             session_id: Optional[int] = None,
                             entry_id: Optional[int] = None,
                             path: Optional[str] = None,
                             max_lines: int = 300) -> dict:
        """ Read a text file of a processing project (logs, STAR files,
        job.star, notes, ...), returning its last max_lines lines. Binary
        and image files only return their metadata.

        Args:
            file_path: Path relative to the project root, e.g.
                'CtfFind/job003/run.out'.
            session_id, entry_id, path: Project selector, provide one.
            max_lines: Maximum number of lines returned (from the end).
        """
        root = _project_root(session_id, entry_id, path)
        preview = client.call('get_file_preview',
                              attrs={'root': root, 'path': file_path},
                              key='preview')
        preview.pop('source', None)  # base64 image preview
        if 'text' in preview:
            preview['text'] = _tail(preview['text'], max_lines)
        return preview

    @mcp.tool(annotations=READ)
    def processing_get_table(star_path: str,
                             session_id: Optional[int] = None,
                             entry_id: Optional[int] = None,
                             path: Optional[str] = None,
                             pointer_class: Optional[str] = None,
                             offset: int = 0, limit: int = 100) -> dict:
        """ Get the rows of a job output table (micrographs with CTF
        values, particles, tilt-series, tomograms, coordinates, ...) from
        its STAR file, as shown in the EMhub table viewer.

        Args:
            star_path: STAR file relative to the project root, e.g.
                'CtfFind/job003/micrographs_ctf.star' (see the outputs
                returned by processing_get_job).
            session_id, entry_id, path: Project selector, provide one.
            pointer_class: Optional output type, helps to choose the table
                kind (e.g. 'MicrographGroupMetadata', 'TomogramGroupMetadata').
            offset, limit: Range of rows to return.
        """
        root = _project_root(session_id, entry_id, path)
        attrs = {'root': root, 'starPath': star_path}
        if pointer_class:
            attrs['pointerClass'] = pointer_class
        table = client.call('get_table_view_data', attrs=attrs,
                            key='tableViewData')
        rows = table.get('rows') or []
        table['total_rows'] = len(rows)
        table['rows'] = rows[offset:offset + limit]
        return _strip_long(table)

    @mcp.tool(annotations=READ)
    def processing_get_labels(session_id: Optional[int] = None,
                              entry_id: Optional[int] = None,
                              path: Optional[str] = None) -> dict:
        """ Get the labels defined in a project ('labels') and the label
        ids assigned to each job ('jobs'). Provide exactly one of
        session_id, entry_id or path. """
        return client.call('get_project_labels',
                           attrs=_project_selector(session_id, entry_id, path),
                           key='labels')

    @mcp.tool(annotations=READ)
    def processing_list_workflows() -> list[dict]:
        """ List the workflow templates (id, file, title, description)
        that can be added to a project with processing_load_workflow,
        e.g. 'spa-otf' or 'tomo-otf'. """
        return client.call('get_workflow_templates', attrs={},
                           key='workflows')

    # ------------------------- Project tools ------------------------------
    @mcp.tool(annotations=WRITE)
    def processing_create_tomo_project(processing_path: str,
                                       data_path: Optional[str] = None,
                                       title: Optional[str] = None,
                                       description: Optional[str] = None,
                                       project_id: Optional[int] = None
                                       ) -> dict:
        """ Create a tomography processing project (a 'tomo_processing'
        entry, select it later with entry_id). If processing_path does not
        exist, EMhub creates it (its parent folder must exist) with an
        empty pipeline and a 'data' link to data_path, so job inputs can be
        relative paths like 'data/mdoc/*.mdoc'. An existing processing_path
        must already be a project (with default_pipeline.star) and is only
        registered, if no other entry has it. Paths are on the EMhub
        server machine. Add jobs then with processing_load_workflow or
        processing_save_job.

        Args:
            processing_path: Project folder, absolute path.
            data_path: Folder with the raw data (frames, mdoc files, gain
                reference), required for a new project.
            title: Optional title, the folder name is shown without it.
            description: Optional description.
            project_id: EMhub project to add the entry to, by default the
                'Default Project for tomo_processing entries' of the user.

        Returns:
            The created entry (id, project_id, extra.data with the paths).
        """
        attrs = {'processing_path': processing_path}
        for k, v in [('data_path', data_path), ('title', title),
                     ('description', description),
                     ('project_id', project_id)]:
            if v is not None:
                attrs[k] = v
        return client.call('create_tomo_project', attrs=attrs, key='entry')

    # ------------------------- Job tools ----------------------------------
    @mcp.tool(annotations=WRITE)
    def processing_save_job(params: dict,
                            run_id: Optional[str] = None,
                            job_type: Optional[str] = None,
                            session_id: Optional[int] = None,
                            entry_id: Optional[int] = None,
                            path: Optional[str] = None) -> list[dict]:
        """ Save a job without running it: update the parameters of an
        existing job (run_id) or create a new job of a given type
        (job_type, e.g. 'emw-warp-mctf' or 'emw-aretomo3'). Get the
        available parameters first with processing_get_job(include_form=True).

        Args:
            params: Job parameters (name -> value). For new jobs, input
                parameters reference outputs of other jobs.
            run_id: Existing job to update.
            job_type: Type of the new job (when run_id is not given).
            session_id, entry_id, path: Project selector, provide one.

        Returns:
            The updated project workflow.
        """
        return _workflow_call('save_job',
                              _project_selector(session_id, entry_id, path),
                              **_job_attrs(run_id, job_type, params))

    @mcp.tool(annotations=WRITE)
    def processing_duplicate_jobs(run_ids: list[str],
                                  session_id: Optional[int] = None,
                                  entry_id: Optional[int] = None,
                                  path: Optional[str] = None) -> list[dict]:
        """ Duplicate one or more jobs as new saved (not launched) jobs
        with the same type and parameters. When several jobs are given,
        inputs between them are re-linked to the new copies, so a chain
        of jobs (e.g. motion -> ctf -> picking) is copied as a new branch;
        inputs from other jobs keep pointing to the original ones. Edit
        the copies then with processing_save_job before launching them.

        Args:
            run_ids: Ids of the jobs to duplicate.
            session_id, entry_id, path: Project selector, provide one.

        Returns:
            The new job of each duplicated one, as a list of
            {'sourceId': ..., 'newId': ...}.
        """
        result = _workflow_call('duplicate_jobs',
                                _project_selector(session_id, entry_id, path),
                                run_ids=run_ids)
        return result['duplicated']

    @mcp.tool(annotations=WRITE)
    def processing_copy_job(run_id: str,
                            params: Optional[dict] = None,
                            session_id: Optional[int] = None,
                            entry_id: Optional[int] = None,
                            path: Optional[str] = None) -> dict:
        """ Copy a job as a new saved (not launched) job with the same
        type, inputs and parameters, optionally changing some of them
        (e.g. to re-run a step with other settings). Get the parameter
        names first with processing_get_job(include_form=True).

        Args:
            run_id: Job to copy.
            params: Parameters to change in the copy (name -> value).
            session_id, entry_id, path: Project selector, provide one.

        Returns:
            {'sourceId': run_id, 'newId': id of the new job}.
        """
        sel = _project_selector(session_id, entry_id, path)
        copy = _workflow_call('duplicate_jobs', sel,
                              run_ids=[run_id])['duplicated'][0]
        if params:
            try:
                _workflow_call('save_job', sel, run_id=copy['newId'],
                               params=params)
            except EmhubMcpError as e:
                raise EmhubMcpError(
                    "Job %s was copied to %s, but its parameters could not "
                    "be changed: %s" % (run_id, copy['newId'], e))
        return copy

    @mcp.tool(annotations=WRITE)
    def processing_export_workflow(output_file: str,
                                   run_ids: Optional[list[str]] = None,
                                   session_id: Optional[int] = None,
                                   entry_id: Optional[int] = None,
                                   path: Optional[str] = None) -> dict:
        """ Export jobs (type and parameters, keeping the links between
        them) as a workflow JSON file in the project folder. It can be
        loaded later with processing_load_workflow(workflow_file=...) to
        create copies of these jobs.

        Args:
            output_file: Name of the JSON file, e.g. 'my_workflow.json',
                written in the project root (an existing file is
                overwritten).
            run_ids: Jobs to export, in this order; all the project jobs
                if not given.
            session_id, entry_id, path: Project selector, provide one.

        Returns:
            The written file (relative to the project root) and the
            number of exported jobs.
        """
        sel = _project_selector(session_id, entry_id, path)
        if not run_ids:
            run_ids = [job['id'] for job in
                       _workflow_call('get_session_workflow', sel)]
        result = _workflow_call('export_workflow', sel, run_ids=run_ids,
                                output_path=output_file)
        result.pop('protocols', None)
        return result

    @mcp.tool(annotations=WRITE)
    def processing_launch_job(params: dict,
                              run_id: Optional[str] = None,
                              job_type: Optional[str] = None,
                              session_id: Optional[int] = None,
                              entry_id: Optional[int] = None,
                              path: Optional[str] = None,
                              clean: bool = False) -> list[dict]:
        """ Launch (run) a job: an existing one (run_id, e.g. to continue
        or re-run it) or a new one of a given job_type. This starts real
        computation on the facility resources, confirm with the user
        before calling it.

        Args:
            params: Job parameters (name -> value), can be {} to use the
                saved ones of an existing job.
            run_id: Existing job to launch.
            job_type: Type of the new job (when run_id is not given).
            session_id, entry_id, path: Project selector, provide one.
            clean: Remove the previous results of the job before running.

        Returns:
            The updated project workflow.
        """
        attrs = _job_attrs(run_id, job_type, params)
        attrs['clean'] = clean
        return _workflow_call('launch_job',
                              _project_selector(session_id, entry_id, path),
                              **attrs)

    @mcp.tool(annotations=WRITE)
    def processing_schedule_job(run_id: Optional[str] = None,
                                job_type: Optional[str] = None,
                                params: Optional[dict] = None,
                                interval_minutes: int = 5,
                                session_id: Optional[int] = None,
                                entry_id: Optional[int] = None,
                                path: Optional[str] = None) -> list[dict]:
        """ Schedule a job to run repeatedly every interval_minutes,
        processing new input data as it arrives (on-the-fly). Works with
        an existing job (run_id) or creates a new one (job_type + params).

        Args:
            run_id: Existing job to schedule.
            job_type: Type of the new job (when run_id is not given).
            params: Optional job parameters to save first.
            interval_minutes: Minutes between runs.
            session_id, entry_id, path: Project selector, provide one.
        """
        attrs = _job_attrs(run_id, job_type, params)
        attrs['interval'] = interval_minutes
        return _workflow_call('schedule_job',
                              _project_selector(session_id, entry_id, path),
                              **attrs)

    @mcp.tool(annotations=DESTRUCTIVE)
    def processing_stop_jobs(run_ids: list[str],
                             session_id: Optional[int] = None,
                             entry_id: Optional[int] = None,
                             path: Optional[str] = None) -> list[dict]:
        """ Stop running or scheduled jobs. Confirm with the user before
        calling it.

        Args:
            run_ids: Ids of the jobs to stop.
            session_id, entry_id, path: Project selector, provide one.
        """
        return _workflow_call('stop_jobs',
                              _project_selector(session_id, entry_id, path),
                              run_ids=run_ids)

    @mcp.tool(annotations=WRITE)
    def processing_set_job_labels(run_id: str, label_ids: list,
                                  session_id: Optional[int] = None,
                                  entry_id: Optional[int] = None,
                                  path: Optional[str] = None) -> dict:
        """ Set the labels of a job (replaces the current ones). Label ids
        come from processing_get_labels.

        Args:
            run_id: Job id.
            label_ids: Ids of the labels to assign ([] to clear).
            session_id, entry_id, path: Project selector, provide one.
        """
        attrs = dict(_project_selector(session_id, entry_id, path),
                     run_id=run_id, label_ids=label_ids)
        return client.call('set_job_labels', attrs=attrs, key='labels')

    @mcp.tool(annotations=WRITE)
    def processing_save_label(title: Optional[str] = None,
                              color: Optional[str] = None,
                              description: Optional[str] = None,
                              label_id: Optional[str] = None,
                              session_id: Optional[int] = None,
                              entry_id: Optional[int] = None,
                              path: Optional[str] = None) -> dict:
        """ Create a project label (without label_id) or update an
        existing one (only the given values change). Assign labels to
        jobs then with processing_set_job_labels.

        Args:
            title: Label text, required for a new label.
            color: Label color, e.g. '#D2F5CB'.
            description: Optional description.
            label_id: Id of the label to update (from processing_get_labels).
            session_id, entry_id, path: Project selector, provide one.

        Returns:
            The saved label, with its id.
        """
        sel = _project_selector(session_id, entry_id, path)
        values = {k: v for k, v in [('title', title), ('color', color),
                                    ('description', description)]
                  if v is not None}
        if label_id is None:
            if not title:
                raise EmhubMcpError("A 'title' is required for a new label.")
            label = values
        else:
            labels = client.call('get_project_labels', attrs=sel,
                                 key='labels')['labels']
            label = next((l for l in labels if l.get('id') == label_id),
                         None)
            if label is None:
                raise EmhubMcpError("There is no label with id '%s'"
                                    % label_id)
            label.update(values)
        return client.call('save_project_label', attrs=dict(sel, label=label),
                           key='label')

    @mcp.tool(annotations=DESTRUCTIVE)
    def processing_delete_label(label_id: str,
                                session_id: Optional[int] = None,
                                entry_id: Optional[int] = None,
                                path: Optional[str] = None) -> dict:
        """ Delete a project label, removing it from all its jobs (the
        jobs are not changed otherwise). Confirm with the user first.

        Args:
            label_id: Id of the label (from processing_get_labels).
            session_id, entry_id, path: Project selector, provide one.
        """
        attrs = dict(_project_selector(session_id, entry_id, path),
                     label_id=label_id)
        result = client.call('delete_project_label', attrs=attrs, key='label')
        if not result.get('deleted'):
            raise EmhubMcpError("There is no label with id '%s'" % label_id)
        return result

    @mcp.tool(annotations=WRITE)
    def processing_annotate_job(run_id: str,
                                run_name: Optional[str] = None,
                                comment: Optional[str] = None,
                                session_id: Optional[int] = None,
                                entry_id: Optional[int] = None,
                                path: Optional[str] = None) -> dict:
        """ Set the display name and/or comment of a job. Values not given
        are cleared, so pass the current ones to keep them.

        Args:
            run_id: Job id.
            run_name: Display name of the job.
            comment: Free text comment / notes.
            session_id, entry_id, path: Project selector, provide one.
        """
        attrs = dict(_project_selector(session_id, entry_id, path),
                     run_id=run_id, run_name=run_name or '',
                     comment=comment or '')
        return client.call('save_job_annotation', attrs=attrs,
                           key='protocol')

    @mcp.tool(annotations=WRITE)
    def processing_load_workflow(workflow_id: Optional[str] = None,
                                 workflow_file: Optional[str] = None,
                                 session_id: Optional[int] = None,
                                 entry_id: Optional[int] = None,
                                 path: Optional[str] = None) -> dict:
        """ Add the jobs of a workflow to a project, saved but not
        launched: a template (workflow_id, e.g. 'spa-otf' or 'tomo-otf',
        see processing_list_workflows) or a JSON file in the project
        (workflow_file, e.g. one written by processing_export_workflow).

        Args:
            workflow_id: Workflow template id.
            workflow_file: Workflow JSON file, relative to the project root.
            session_id, entry_id, path: Project selector, provide one.

        Returns:
            The number of created jobs and 'id_map', the new job id of
            each job of the workflow.
        """
        if (workflow_id is None) == (workflow_file is None):
            raise EmhubMcpError("Provide exactly one of 'workflow_id' or "
                                "'workflow_file'.")
        attrs = ({'workflow_id': workflow_id} if workflow_id is not None
                 else {'workflow_file': workflow_file})
        result = _workflow_call('load_workflow',
                                _project_selector(session_id, entry_id, path),
                                **attrs)
        # 'protocols' is the UI widget structure, not useful here
        result.pop('protocols', None)
        return result

    if not allow_admin:
        return

    # ------------------------- Admin tools --------------------------------
    @mcp.tool(annotations=DESTRUCTIVE)
    def processing_delete_jobs(run_ids: list[str],
                               session_id: Optional[int] = None,
                               entry_id: Optional[int] = None,
                               path: Optional[str] = None) -> list[dict]:
        """ (Admin) Delete jobs and their results from a project. This can
        not be undone, always confirm with the user before calling it.

        Args:
            run_ids: Ids of the jobs to delete.
            session_id, entry_id, path: Project selector, provide one.
        """
        return _workflow_call('delete_jobs',
                              _project_selector(session_id, entry_id, path),
                              run_ids=run_ids)


def _job_attrs(run_id, job_type, params):
    if run_id is None and job_type is None:
        raise EmhubMcpError("Provide 'run_id' for an existing job or "
                            "'job_type' for a new one.")
    attrs = {'params': params} if params is not None else {}
    if run_id is not None:
        attrs['run_id'] = run_id
    else:
        attrs['job_type'] = job_type
    return attrs
