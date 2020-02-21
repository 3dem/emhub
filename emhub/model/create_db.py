from datetime import datetime as dt
from random import randint
from .sqlite import User, Session
from .. import db


def create_db_test():
    """Create a test user database."""
    usernames = ['name1', 'name2', 'name3']
    emails = ['abc@def.com', 'fgh@ert.com', 'yu@dfh.com']
    defocus = [randint(0, 200), randint(0, 200), randint(0, 200)]

    for user, email, df in zip(usernames, emails, defocus):
        new_user = User(username=user,
                        email=email,
                        created=dt.now(),
                        bio="In West Philadelphia born n raised...",
                        admin=False,
                        defocus=df)
        db.session.add(new_user)  # Add new User record to database
    db.session.commit()  # Commit all changes


def create_db_sessions():
    """Create a sessions database."""
    for index in [1, 2]:
        new_session = Session(
            id=index,
            username='gsharov',
            projectName='MyGreatProject',
            dateCreated=dt.now(),
            description='Long description goes here.....',
            status=True,
            microscope='Krios 1',
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
            numOfMovies=467,
            numOfPtcls=0,
            numOfCls2D=0,
            ptclsSizeMin=140,
            ptclsSizeMax=160
        )
        db.session.add(new_session)
    db.session.commit()
