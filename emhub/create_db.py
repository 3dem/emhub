from datetime import datetime as dt
from .models import db, User


def create_database():
    """Create a test user database."""
    usernames = ['name1', 'name2', 'name3']
    emails = ['abc@def.com', 'fgh@ert.com', 'yu@dfh.com']
    for user, email in zip(usernames, emails):
        new_user = User(username=user,
                        email=email,
                        created=dt.now(),
                        bio="In West Philadelphia born n raised...",
                        admin=False)
        db.session.add(new_user)  # Add new User record to database
    db.session.commit()  # Commit all changes
