#!/usr/bin/env python
# **************************************************************************
# *
# * Authors:     J.M. de la Rosa Trevin (delarosatrevin@gmail.com)
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
# **************************************************************************

import os.path
import argparse
import ast
import time
from collections import OrderedDict
from glob import glob
from pprint import pprint

from emtools.utils import Process, Color, System, Pipeline, Timer
from emtools.metadata import EPU, SqliteFile

import pyworkflow as pw
from pyworkflow.project import Project
from pyworkflow.protocol import MODE_RESTART, STATUS_FINISHED
from pwem.objects import SetOfParticles
from emtools.pwx import Workflow


OUT_MOVS = 'outputMovies'
OUT_MICS = 'outputMicrographsDoseWeighted'
OUT_CTFS = 'outputCTF'
OUT_COORD = 'outputCoordinates'
OUT_PART = 'outputParticles'

# Some global workflow parameters
params = {}


def _setPointer(pointer, prot, extended):
    pointer.set(prot)
    pointer.setExtended(extended)


def loadGpus():
    # Avoid quadro GPUs
    gpuProc = [g for g in System.gpus() if 'Quadro' not in g['name']]
    ngpu = len(gpuProc)
    half = int(ngpu/2)
    gpus = list(range(ngpu))
    # Take half of gpus for Motioncor and the other half for 2D
    mcGpus = gpus[:half]
    params['cls2dGpus'] = gpus[half:]


def calculateBoxSize(protCryolo):
    """ Calculate the box size based on the estimate particle size from Cryolo
    and recommend boxsize from Eman's wiki page.
    """
    EMAN_BOXSIZES = [24, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 84, 96, 100,
                     104, 112, 120, 128, 132, 140, 168, 180, 192, 196, 208,
                     216, 220, 224, 240, 256, 260, 288, 300, 320, 352, 360,
                     384, 416, 440, 448, 480, 512, 540, 560, 576, 588, 600,
                     630, 640, 648, 672, 686, 700, 720, 750, 756, 768, 784,
                     800, 810, 840, 864, 882, 896, 900, 960, 972, 980, 1000,
                     1008, 1024]

    # Calculate the boxsize based on double of cryolo particle estimation
    # and recommended EMAN's boxsizes for performance
    params['partSizePx'] = protCryolo.boxsize.get()
    params['partSizeA'] = params['partSizePx'] * protCryolo.inputMicrographs.get().getSamplingRate()
    boxSize = max(params['partSizePx'] * 2.5, 100)
    for bs in EMAN_BOXSIZES:
        if bs > boxSize:
            boxSize = bs
            break
    params['boxSize'] = boxSize


def run2DPipeline(wf, protExtract):
    print(f"\n>>> Running 2D pipeline: input extract "
          f"{Color.bold(protExtract.getRunName())}")

    def _generate2D():
        """ Generated subset of 2D from the outputParticles from extract protocol.
        Subsets will be created based on the GridSquare of the micrographs. """
        lastParticleIndex = 0
        lastGs = None
        # Classify in batches
        lastMt = 0
        extractSqliteFn = protExtract.outputParticles.getFileName()
        tmpSqliteFn = '/tmp/particles.sqlite'

        while True:
            if lastGs:  # Not the first time, let's wait
                print("Sleeping...")
                time.sleep(30)  # wait for 5 minutes before checking for new jobs

            print("Wake up!!!")
            mt = os.path.getmtime(extractSqliteFn)
            if mt > lastMt:
                # Let's iterate over the particles to check if there is a
                # new GridSquare and launch a subset and 2D classification job
                # but Let's make a backup of the input particles to avoid DataBase
                # locked error from Sqlite when much concurrency
                print("Copying database....")
                Process.system(f'rm -rf {tmpSqliteFn}')
                SqliteFile.copyDb(extractSqliteFn, tmpSqliteFn, tries=10, wait=30)
                print("Copy done!")

            parts = SetOfParticles(filename=tmpSqliteFn)
            subsetParts = []

            print(f"Total particles: {parts.getSize()}")

            for i, p in enumerate(parts.iterItems()):
                if i < lastParticleIndex:
                    continue

                micName = p.getCoordinate().getMicName()
                loc = EPU.get_movie_location(micName)

                print(f"Checking particle {p.getObjId()}, gs: {loc['gs']}")
                if loc['gs'] != lastGs:  # We found a new GridSquare
                    print(f"Found new GS {loc['gs']}, old one: {lastGs}")
                    oldLastGs = lastGs
                    lastGs = loc['gs']
                    # Let's check that is not the first one
                    if oldLastGs:
                        rangeStr = f"{subsetParts[0].getObjId()} - {subsetParts[-1].getObjId()}"
                        print(f"Creating subset with range: {rangeStr}")
                        protSubset = wf.createProtocol(
                            'pwem.protocols.ProtUserSubSet',
                            objLabel=f'subset: {oldLastGs} : {rangeStr}',
                        )
                        _setPointer(protSubset.inputObject, protExtract, OUT_PART)
                        wf.saveProtocol(protSubset)
                        protSubset.makePathsAndClean()
                        # Create subset particles as output for the protocol
                        inputParticles = protExtract.outputParticles
                        outputParticles = protSubset._createSetOfParticles()
                        outputParticles.copyInfo(inputParticles)
                        for particle in subsetParts:
                            outputParticles.append(particle)
                        protSubset._defineOutputs(outputParticles=outputParticles)
                        protSubset._defineTransformRelation(inputParticles, outputParticles)
                        protSubset.setStatus(STATUS_FINISHED)
                        wf.project._storeProtocol(protSubset)

                        protRelion2D = wf.createProtocol(
                            'relion.protocols.ProtRelionClassify2D',
                            objLabel=f'relion2d: {oldLastGs}',
                            maskDiameterA=round(params['partSizeA'] * 1.5),
                            numberOfClasses=200,
                            extraParams='--maxsig 50',
                            pooledParticles=50,
                            doGpu=True,
                            gpusToUse=','.join(str(g) for g in params['cls2dGpus']),
                            numberOfThreads=32,
                            numberOfMpi=1,
                            allParticlesRam=True,
                            useGradientAlg=True,
                        )

                        _setPointer(protRelion2D.inputParticles, protSubset, OUT_PART)
                        wf.saveProtocol(protRelion2D)

                        yield {'gs': oldLastGs, 'prot': protRelion2D}
                        lastParticleIndex = i
                        print(f"lastGs: {lastGs}, lastParticleIndex: {lastParticleIndex}")
                        break

                subsetParts.append(p.clone())

            lastMt = mt

            # TODO: Check stopping condition (maybe when STREAM closed)

    def _run2D(batch):
        protRelion2D = batch['prot']
        wf.launchProtocol(protRelion2D, wait=True)

        protRelion2DSelect = wf.createProtocol(
            'relion.protocols.ProtRelionSelectClasses2D',
            objLabel=f"select 2d - {batch['gs']}",
            minThreshold=0.05,
            minResolution=30.0,
        )

        protRelion2DSelect.inputProtocol.set(protRelion2D)
        wf.launchProtocol(protRelion2DSelect, wait=True)

    ppl = Pipeline()
    g = ppl.addGenerator(_generate2D)
    r2d = ppl.addProcessor(g.outputQueue, _run2D)
    ppl.run()


def clean_project(workingDir):
    """ Clean possible Scipion project files and directories. """
    for fn in ['logs', 'Logs', 'project.sqlite', 'Runs', 'Tmp', 'Uploads']:
        Process.system(f'rm -rf {os.path.join(workingDir, fn)}')


def create_project(workingDir):
    clean_project(workingDir)
    project = Project(pw.Config.getDomain(), workingDir)
    project.create()

    loadGpus()

    def _path(*p):
        return os.path.join(workingDir, *p)

    with open(_path('relion_it_options.py')) as f:
        opts = OrderedDict(ast.literal_eval(f.read()))

    wf = Workflow(project)

    moviesFolder = _path('data', 'Images-Disc1')
    moviesPattern = "GridSquare_*/Data/FoilHole_*_fractions.tiff"

    protImport = wf.createProtocol(
        'pwem.protocols.ProtImportMovies',
        objLabel='import movies',
        filesPath=moviesFolder,
        filesPattern=moviesPattern,
        samplingRateMode=0,
        samplingRate=opts['prep__importmovies__angpix'],
        magnification=130000,
        scannedPixelSize=7.0,
        voltage=opts['prep__importmovies__kV'],
        sphericalAberration=opts['prep__importmovies__Cs'],
        doseInitial=0.0,
        dosePerFrame=opts['prep__motioncorr__dose_per_frame'],
        gainFile="gain.mrc",
        dataStreaming=True
    )
    #protImport = wf.launchProtocol(protImport, wait={OUT_MOVS: 1})
    wf.launchProtocol(protImport, wait={OUT_MOVS: 1})
    protMc = wf.createProtocol(
        'motioncorr.protocols.ProtMotionCorrTasks',
        objLabel='motioncor',
        patchX=7, patchY=5,
        numberOfThreads=1,
        gpuList=' '.join(str(g) for g in mcGpus)
    )
    _setPointer(protMc.inputMovies, protImport, 'outputMovies')
    wf.launchProtocol(protMc, wait={OUT_MICS: 8})

    protCTF = wf.createProtocol(
        'cistem.protocols.CistemProtCTFFind',
        objLabel='ctffind4',
        streamingBatchSize=8,
        streamingSleepOnWait=60,
        numberOfThreads=5,
    )
    _setPointer(protCTF.inputMicrographs, protMc, OUT_MICS)
    wf.launchProtocol(protCTF, wait={OUT_CTFS: 16})

    protCryolo = wf.createProtocol(
        'sphire.protocols.SphireProtCRYOLOPicking',
        objLabel='cryolo picking',
        boxSize=0,  # let cryolo estimate the box size
        conservPickVar=0.05,  # less conservative than default 0.3
        useGpu=False,  # use cpu for picking, fast enough
        numCpus=16,
        gpuList='',
        streamingBatchSize=16,
        streamingSleepOnWait=60,
        numberOfThreads=1,
    )
    _setPointer(protCryolo.inputMicrographs, protMc, OUT_MICS)
    wf.launchProtocol(protCryolo, wait={OUT_COORD: 100})

    calculateBoxSize(protCryolo)

    protRelionExtract = wf.createProtocol(
        'relion.protocols.ProtRelionExtractParticles',
        objLabel='relion - extract',
        boxSize=params['boxSize'],
        doRescale=True,
        rescaledSize=100,
        doInvert=True,
        doNormalize=True,
        backDiameter=params['partSizeA'],
        numberOfMpi=8,#16,
        downsamplingType=0,  # Micrographs same as picking
        streamingBatchSize=16, #32,
        streamingSleepOnWait=60,
    )

    _setPointer(protRelionExtract.ctfRelations, protCTF, OUT_CTFS)
    _setPointer(protRelionExtract.inputCoordinates, protCryolo, OUT_COORD)
    # Ensure there are at least some particles
    wf.launchProtocol(protRelionExtract, wait={OUT_PART: 100})
    run2DPipeline(wf, protRelionExtract)


def continue_project(workingDir):
    print(f"Loading project from {workingDir}")
    project = Project(pw.Config.getDomain(), workingDir)
    project.load()
    wf = Workflow(project)
    loadGpus()

    protExtract = protCryolo = None

    for run in project.getRuns():
        clsName = run.getClassName()
        print(f"Run {run.getObjId()}: {clsName}")
        if clsName == 'ProtRelionExtractParticles':
            protExtract = run
        elif clsName == 'SphireProtCRYOLOPicking':
            protCryolo = run

    if not protExtract.isActive():
        print("Re-running extract protocol...")
        wf.launchProtocol(protExtract, wait={OUT_PART: 100})

    calculateBoxSize(protCryolo)

    run2DPipeline(wf, protExtract)


def parse_project(projDir):
    from emhub.data.data_session import ScipionSessionData
    sd = ScipionSessionData(projDir)

    for k, v in sd.outputs.items():
        print(f"\n>>> {k}: \n\t{v}")

    print()
    print(sd.get_stats())

    print("\n>>> CTFS")
    if ctfSqlite := sd.outputs.get('ctfs', None):
        with SqliteFile(ctfSqlite) as sf:
            for row in sf.iterTable('Objects', classes='Classes', start=1, limit=3):
                print(row)

    print("\n>>> COORDINATES")
    if coordSqlite := sd.outputs.get('coordinates', None):
        with SqliteFile(coordSqlite) as sf:
            for row in sf.iterTable('Objects', classes='Classes', start=1, limit=3):
                print(row)

    print("\n>>> CLASSES 2D")
    if classesSqlite := sd.outputs.get('classes2d', None):
        with SqliteFile(classesSqlite) as sf:
            for row in sf.iterTable('Objects', classes='Classes', start=1, limit=3):
                pprint(row)


def main():
    p = argparse.ArgumentParser(prog='scipion-otf')
    g = p.add_mutually_exclusive_group()

    g.add_argument('--create', action='store_true',
                       help="Create a new Scipion project in the working "
                            "directory. This will overwrite any existing "
                            "'scipion' folder there.")
    g.add_argument('--restart', action='store_true',
                   help="Continue with an existing project. ")
    g.add_argument('--gui', action='store_true',
                   help="Open project GUI")
    g.add_argument('--clean', action="store_true",
                   help="Clean Scipion project files/folders.")

    args = p.parse_args()
    cwd = os.getcwd()

    if args.create:
        create_project(cwd)
    elif args.restart:
        continue_project(cwd)
    elif args.gui:
        from pyworkflow.gui.project import ProjectWindow
        ProjectWindow(cwd).show()
    elif args.clean:
        clean_project(cwd)
    else:
        import sqlite3
        from pwem.objects import SetOfParticles, SetOfCoordinates
        from pyworkflow.mapper.sqlite import SqliteFlatMapper
        from pyworkflow import Config


        def _tables(db):
            r = db.execute("SELECT name FROM sqlite_master "
                                    "WHERE type='table'")
            for row in r.fetchall():
                tableName = row[0]
                print(row)
                print(db.execute(f"SELECT COUNT(*) FROM {tableName}").fetchone()[0])

        def _iterSqlite(db):
            c = 0
            r = db.execute('SELECT * FROM Objects')
            for row in r.fetchall():
                c += 1
            print("total: ", c)

        def _iterScipion(db):
            parts = SetOfParticles()
            #parts = SetOfCoordinates()
            memMapper = SqliteFlatMapper(db, Config.getDomain().getMapperDict())
            parts.setMapper(memMapper)
            #parts.loadAllProperties()
            c = 0
            for p in parts.iterItems():
                c += 1
            print("total: ", c)

        #parse_project(cwd)
        print("Testing...")
        fn = 'Runs/000318_ProtRelionExtractParticles/particles.sqlite'
        #fn = 'Runs/000262_SphireProtCRYOLOPicking/coordinates.sqlite'



        t = Timer()
        print("\n>>>>>> File db")
        db = sqlite3.connect(fn)
        print('type: ', type(db), "classname", db.__class__.__name__)
        _tables(db)
        t.toc()

        print("\n>>>>>> Iterating db")
        t.tic()
        _iterSqlite(db)
        t.toc()

        print("\n>>>>>> Iterating db (scipion)")
        t.tic()
        _iterScipion(db)
        t.toc()

        t.tic()
        print("\n>>>>>> BACKUP")
        memDb = sqlite3.connect(':memory:')
        db.backup(memDb)
        db.close()
        t.toc()

        t.tic()
        print("\n>>>>>> Memory db")
        _tables(memDb)
        t.toc()

        print("\n>>>>>> Iterating MEM db")
        t.tic()
        _iterSqlite(memDb)
        t.toc()

        print("\n>>>>>> Iterating MEM db (scipion)")
        t.tic()
        _iterScipion(memDb)
        t.toc("")



if __name__ == '__main__':
    main()
