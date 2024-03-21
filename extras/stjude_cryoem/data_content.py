import os
from glob import glob


def register_content(dc):
    @dc.content
    def access_microscopes(**kwargs):
        """ Load one of all batches. """
        dm = dc.app.dm  # shortcut
        formDef = dm.get_form_definition('access_microscopes')
        return {
            'request_resources': formDef['config']['request_resources']
        }

    @dc.content
    def create_session_form(**kwargs):
        """ Specific information needed to render the create-form template
        # for St.Jude CryoEM center.
        """
        dm = dc.app.dm  # shortcut
        user = dc.app.user
        booking_id = int(kwargs['booking_id'])
        b = dm.get_booking_by(id=booking_id)
        can_edit = b.project and user.can_edit_project(b.project)

        if not (user.is_manager or user.same_pi(b.owner) or can_edit):
            raise Exception("You can not create Sessions for this Booking. "
                            "Only members of the same lab can do it.")

        sconfig = dm.get_config('sessions')

        # load default acquisition params for the given microscope
        micName = b.resource.name
        acq = sconfig['acquisition'][micName]

        # We provide cryolo_models to be used with the OTF
        cryolo_models_pattern = dm.get_config('sessions')['data']['cryolo_models']

        cryolo_models = glob(cryolo_models_pattern)

        if not user.is_manager:
            group = dm.get_user_group(user)
            cryolo_models = [cm for cm in cryolo_models if group in cm]

        def _key(model):
            d, base = os.path.split(model)
            return base if not user.is_manager else os.path.join(os.path.basename(d), base)

        otf = sconfig['otf']
        data = {
            'booking': b,
            'acquisition': acq,
            'otf_hosts': otf['hosts'],
            'otf_host_default': otf['hosts_default'][micName],
            'workflows': otf['workflows'],
            'workflow_default': otf['workflow_default'],
            'transfer_host': sconfig['raw']['hosts_default'][micName],
            'cryolo_models': {_key(cm): cm for cm in cryolo_models}
        }
        data.update(dc.get_user_projects(b.owner, status='active'))
        return data

