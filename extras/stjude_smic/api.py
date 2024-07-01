
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

            p = app.dm.get_puck_by(code=code)
            if p is not None:
                raise Exception(f"Batch {batch} already have plate {plate}.")

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
                inactive_list.append(itemId)
        elif status == 'active':
            if itemId in inactive_list:
                inactive_list.remove(itemId)
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

    def _get_plate(args):
        plate_id = int(args['plate'])
        p = app.dm.get_puck_by(id=plate_id)

        if p is None:
            raise Exception("Invalid Plate with id %s" % plate_id)

        return p

    @api_bp.route('/update_plate_channel', methods=['POST'])
    @flask_login.login_required
    def update_plate_channel():
        def _update_plate_channel(**args):
            channel = int(args['channel'])
            info = args['info']
            info['channel'] = channel
            p = _get_plate(args)
            channels = dict(p.extra.get('channels', {}))
            channels[str(channel)] = info
            app.dm.update_puck(id=p.id, extra={'channels': channels})
            return 'OK'

        return _handle_item(_update_plate_channel, 'result')

    @api_bp.route('/update_plate', methods=['POST'])
    @flask_login.login_required
    def update_plate():
        def _update_plate(**args):
            p = _get_plate(args)
            app.dm.update_puck(id=p.id,
                               extra={'status': args['status'],
                                      'comments': args.get('comments', '')})
            return 'OK'

        return _handle_item(_update_plate, 'result')

    @api_bp.route('/delete_plate', methods=['POST'])
    @flask_login.login_required
    def delete_plate():
        def _delete_plate(**args):
            p = _get_plate(args)
            app.dm.delete_puck(id=p.id)
            return 'OK'

        return _handle_item(_delete_plate, 'result')