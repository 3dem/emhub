
import os

from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean, Float, ForeignKey, Text
from sqlalchemy.orm import scoped_session, sessionmaker, relationship
from sqlalchemy.ext.declarative import declarative_base


class SessionManager:
    """ Main class that will manage the sessions and their information.
    """
    def __init__(self, sqlitePath):
        engine = create_engine('sqlite:///' + sqlitePath,
                                     convert_unicode=True)
        self._db_session = scoped_session(sessionmaker(autocommit=False,
                                                 autoflush=False,
                                                 bind=engine))
        Base = declarative_base()
        Base.query = self._db_session.query_property()

        self.__createModels(Base)

        # Create the database if it does not exists
        if not os.path.exists(sqlitePath):
            Base.metadata.create_all(bind=engine)

    def get_sessions(self, condition=None):
        pass

    def create_session(self, sessionId, **attrs):
        pass

    def update_session(self, sessionId, **attrs):
        pass

    def delete_session(self, sessionId):
        pass

    def load_session(self, sessionId):
        pass

    def close(self):
        self._db_session.remove()

    def __createModels(self, Base):
        class User(Base):
            """Model for user accounts."""
            __tablename__ = 'users'
            id = Column(Integer,
                        primary_key=True)
            username = Column(String(64),
                              index=True,
                              unique=True,
                              nullable=False)
            email = Column(String(80),
                           index=False,
                           unique=True,
                           nullable=False)
            created = Column(DateTime,
                             index=False,
                             unique=False,
                             nullable=False)
            admin = Column(Boolean,
                           index=False,
                           unique=False,
                           nullable=False)

            # one user to many sessions, bidirectional
            sessions = relationship('Session', back_populates="users")

            def __repr__(self):
                return '<User {}>'.format(self.username)

        class Session(Base):
            """Model for sessions."""
            __tablename__ = 'sessions'
            id = Column(Integer,
                        primary_key=True)
            sessionData = Column(String(80),
                                 index=False,
                                 unique=True,
                                 nullable=False)
            sessionName = Column(String(80),
                                 index=True,
                                 unique=False,
                                 nullable=False)
            dateStarted = Column(DateTime,
                                 index=False,
                                 unique=False,
                                 nullable=False)
            description = Column(Text,
                                 index=False,
                                 unique=False,
                                 nullable=True)
            status = Column(String(20),
                            index=False,
                            unique=False,
                            nullable=False)
            microscope = Column(String(64),
                                index=False,
                                unique=False,
                                nullable=False)
            voltage = Column(Integer,
                             index=False,
                             unique=False,
                             nullable=False)
            cs = Column(Float,
                        index=False,
                        unique=False,
                        nullable=False)
            phasePlate = Column(Boolean,
                                index=False,
                                unique=False,
                                nullable=False)
            detector = Column(String(64),
                              index=False,
                              unique=False,
                              nullable=False)
            detectorMode = Column(String(64),
                                  index=False,
                                  unique=False,
                                  nullable=False)
            pixelSize = Column(Float,
                               index=False,
                               unique=False,
                               nullable=False)
            dosePerFrame = Column(Float,
                                  index=False,
                                  unique=False,
                                  nullable=False)
            totalDose = Column(Float,
                               index=False,
                               unique=False,
                               nullable=False)
            exposureTime = Column(Float,
                                  index=False,
                                  unique=False,
                                  nullable=False)
            numOfFrames = Column(Integer,
                                 index=False,
                                 unique=False,
                                 nullable=False)
            numOfMovies = Column(Integer,
                                 index=False,
                                 unique=False,
                                 nullable=False)
            numOfMics = Column(Integer,
                               index=False,
                               unique=False,
                               nullable=False)
            numOfCtfs = Column(Integer,
                               index=False,
                               unique=False,
                               nullable=False)
            numOfPtcls = Column(Integer,
                                index=False,
                                unique=False,
                                nullable=False)
            numOfCls2D = Column(Integer,
                                index=False,
                                unique=False,
                                nullable=False)
            ptclSizeMin = Column(Integer,
                                 index=False,
                                 unique=False,
                                 nullable=False)
            ptclSizeMax = Column(Integer,
                                 index=False,
                                 unique=False,
                                 nullable=False)

            # one user to many sessions, bidirectional
            userid = Column(Integer, ForeignKey('users.id'),
                            nullable=False)
            users = relationship("User", back_populates="sessions")

            def __repr__(self):
                return '<Session {}>'.format(self.sessionName)

        self.User = User
        self.Session = Session








