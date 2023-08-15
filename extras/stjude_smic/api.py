
def extend_api(api_bp):

    import flask_login
    from flask import current_app as app

    from emhub.blueprints.api import handle_puck

    @api_bp.route('/create_plate', methods=['POST'])
    @flask_login.login_required
    def create_plate():
        def _create_plate(**args):
            """ Translate from Plate to Puck. """
            try:
                batch = int(args['batch'])
                plate = int(args['plate'])
                code = "B%03d_%02d" % (batch, plate)
            except:
                raise Exception("Provide valid 'batch' and 'plate' numbers.")

            print("args: ", args)

            newArgs = {
                'code': code,
                'label': code,
                'dewar': batch,
                'cane': plate,
                'extra': {'comments': args.get('comments', '')},
                'position': 0
            }
            return app.dm.create_puck(**newArgs)

        return handle_puck(_create_plate)
