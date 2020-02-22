import os
from datetime import datetime as dt

from emhub.model.database import db_session, init_db
from emhub.model.db_models import User, Session


# run this file before starting flask:
# export PYTHONPATH=`pwd`; python emhub/model/create_db.py

def create_tables():
    # Create a test user database
    usernames = ['name1', 'name2', 'name3']
    emails = ['abc@def.com', 'fgh@ert.com', 'yu@dfh.com']

    for user, email in zip(usernames, emails):
        new_user = User(username=user,
                        email=email,
                        created=dt.now(),
                        admin=False)
        db_session.add(new_user)

    # Create a test sessions table with 3 rows."""
    users = [1, 2, 2]
    session_names = ['supervisor_23423452_20201223_123445',
                     'epu-mysession_20122310_234542',
                     'mysession_very_long_name']

    testData = os.environ.get('EMHUB_TESTDATA', None)
    fns = [os.path.join(testData, 'hdf5/20181108_relion30_tutorial.h5'),
           os.path.join(testData, 'hdf5/t20s_pngs.h5'), 'non-existing-file']

    scopes = ['Krios 1', 'Krios 2', 'Krios 3']
    numMovies = [423, 234, 2543]
    numMics = [0, 234, 2543]
    numCtfs = [0, 234, 2543]
    numPtcls = [0, 0, 2352534]
    status = ['Running', 'Error', 'Finished']

    for f, u, s, st, sc, movies, mics, ctfs, ptcls in zip(fns, users, session_names,
                                                          status, scopes, numMovies,
                                                          numMics, numCtfs, numPtcls):
        new_session = Session(
            sessionData=f,
            userid=u,
            sessionName=s,
            dateStarted=dt.now(),
            description='Long description goes here.....',
            status=st,
            microscope=sc,
            voltage=300,
            cs=2.7,
            phasePlate=False,
            detector='Falcon',
            detectorMode='Linear',
            pixelSize=1.1,
            dosePerFrame=1.0,
            totalDose=35.0,
            exposureTime=1.2,
            numOfFrames=48,
            numOfMovies=movies,
            numOfMics=mics,
            numOfCtfs=ctfs,
            numOfPtcls=ptcls,
            numOfCls2D=0,
            ptclSizeMin=140,
            ptclSizeMax=160,
        )
        db_session.add(new_session)
    db_session.commit()


db_file = os.path.join('/tmp/emhub.sqlite')
if not os.path.exists(db_file):
    init_db()
    create_tables()
