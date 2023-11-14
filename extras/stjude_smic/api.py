
def extend_api(api_bp):

    import flask_login
    from flask import current_app as app

    from emhub.blueprints.api import handle_puck, _handle_item

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

    def _update_status(itemId, status, configKey):
        platesConfig = app.dm.get_config('plates')
        inactive_list = platesConfig[configKey]

        if status == 'inactive':
            if itemId not in inactive_list:
                inactive_list.append(batch)
        elif status == 'active':
            if itemId in inactive_list:
                inactive_list.remove(batch)
        else:
            raise Exception("Unknow status %s" % status)

        app.dm.update_config('plates', platesConfig)

        return 'OK'


    @api_bp.route('/update_batch_status', methods=['POST'])
    @flask_login.login_required
    def update_batch_status():
        def _update_batch(**args):
            return _update_status(int(args['batch']), args['status'],
                                  'inactive_batches')

        return _handle_item(_update_batch, 'result')

    @api_bp.route('/update_plate_status', methods=['POST'])
    @flask_login.login_required
    def update_plate_status():
        def _update_plate(**args):
            return _update_status(int(args['plate']), args['status'],
                                  'inactive_plates')

        return _handle_item(_update_batch, 'result')