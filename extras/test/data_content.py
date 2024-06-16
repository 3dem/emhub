
import os
from glob import glob
import json
import datetime as dt

from emtools.utils import Pretty


def register_content(dc):

    @dc.content
    def create_session_form(**kwargs):
        """ Basic session creation for EMhub Test Instance
        """
        dm = dc.app.dm  # shortcut
        user = dc.app.user
        booking_id = int(kwargs['booking_id'])

        # Get the booking associated with this Session to be created
        b = dm.get_booking_by(id=booking_id)
        can_edit = b.project and user.can_edit_project(b.project)

        # Do some permissions validation
        if not (user.is_manager or user.same_pi(b.owner) or can_edit):
            raise Exception("You can not create Sessions for this Booking. "
                            "Only members of the same lab can do it.")

        # Retrieve configuration information from the Form config:sessions
        # We fetch default acquisition info for each microscope or
        # the hosts that are available for doing OTF processing
        sconfig = dm.get_config('sessions')

        # Load default acquisition params for the given microscope
        micName = b.resource.name
        acq = sconfig['acquisition'][micName]

        def _key(model):
            d, base = os.path.split(model)
            return base if not user.is_manager else os.path.join(os.path.basename(d), base)

        dateStr = Pretty.date(b.start).replace('-', '')

        otf_hosts = sconfig['otf']['hosts']

        data = {
            'booking': b,
            'acquisition': acq,
            'session_name_prefix': '',
            'otf_hosts': otf_hosts,
            'otf_host_default': '',
            'workflows': ['None', 'Scipion'],
            'workflow_default': '',
            'transfer_host': '',
            'cryolo_models': {}
        }
        data.update(dc.get_user_projects(b.owner, status='active'))
        return data

