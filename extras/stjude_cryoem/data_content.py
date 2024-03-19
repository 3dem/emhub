

def register_content(dc):
    @dc.content
    def access_microscopes(**kwargs):
        """ Load one of all batches. """
        dm = dc.app.dm  # shortcut
        formDef = dm.get_form_definition('access_microscopes')
        return {
            'request_resources': formDef['config']['request_resources']
        }

