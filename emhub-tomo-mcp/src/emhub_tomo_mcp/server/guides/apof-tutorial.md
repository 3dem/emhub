# The ApoF tutorial workflows

The EMhub-Tomo tutorial processes five apoferritin tilt series from EMPIAR-10491 with two workflow templates.

**apof-warp-tutorial-part1** (11 jobs):

1. `emw-import-ts`: import the tilt series (mdoc files, gain reference).
2. `emw-pytom-create_template`: template and mask from the EMD-15854 map.
3. `emw-warp-mctf`: motion correction and CTF.
4. `emw-warp-tsalign`: tilt-series alignment (AreTomo3 in the template).
5. `emw-warp-ctfrec`: CTF and tomogram reconstruction at 10 Å/px.
6. `emw-pytom`: template matching.
7. `emw-warp-export_particles`: particle export.
8. `relion.initialmodel.tomo`: initial model.
9. `relion.refine3d.tomo`: refinement.
10. `emw-relion-mask_create`: mask.
11. `emw-warp-mtools_create`: Warp M population.

**apof-warp-tutorial-part2** (11 jobs): M refinements (`emw-warp-mcore`), weight estimation and resampling, continuing from the population of part 1.

On one node with 3 RTX 6000 GPUs both parts take about 4.5 hours; the final M refinement reaches about 2.8 Å.

Load each template only once per project: loading adds a fresh copy of every job.
