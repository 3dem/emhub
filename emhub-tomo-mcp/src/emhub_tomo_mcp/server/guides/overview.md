# EMhub-Tomo overview

EMhub-Tomo processes cryo-electron tomography data. Three packages work together:

- **EMhub** is the web application and REST API. It stores projects, users and sharing.
- **emwrap** wraps the processing programs (Warp, AreTomo, PyTOM, RELION, IMOD, ...) as jobs.
- **emtools** provides metadata and file handling used by both.

## Projects

A project is a folder on disk organised like a RELION project:

- `default_pipeline.star` lists the jobs and their links;
- each job has a folder `<OutputType>/jobNNN/` with `job.star` (its parameters), `run.out` and `run.err` (its output), and its result files;
- `data/` is a link to the raw data (frames, mdoc files, gain reference).

In EMhub a project is an entry of type `tomo_processing` that records the project folder (`processing_path`), the raw data folder (`data_path`) and with whom it is shared (view-only or editor).

## Jobs and the pipeline

A typical Warp-based pipeline:

1. `emw-import-ts`: read the mdoc files and register the tilt series.
2. `emw-warp-mctf`: motion correction and CTF estimation per tilt image.
3. `emw-warp-tsalign`: tilt-series alignment (AreTomo2, AreTomo3 or IMOD patch tracking).
4. `emw-warp-ctfrec`: CTF per tilt series and tomogram reconstruction.
5. `emw-pytom-create_template`, `emw-pytom`: template and mask, then template matching (picking).
6. `emw-warp-export_particles`: subtomogram particles for refinement.
7. `relion.initialmodel.tomo`, `relion.refine3d.tomo`, `emw-relion-mask_create`: initial model, refinement and mask in RELION.
8. `emw-warp-mtools_create`, `emw-warp-mcore`, `emw-warp-estimate_weights`, `emw-warp-mtools_resample`: multi-particle refinement in Warp M.

Workflow templates (list_workflow_templates) are ready-made sets of such jobs.
