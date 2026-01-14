
import os
from glob import glob
import json
import datetime as dt

from emtools.utils import Pretty


def register_content(dc):

    @dc.content
    def dashboard(**kwargs):
        """ Let's redirect the dashboard to the tomo session list
        """
        return dc.get_data('processing_tomo_list', **kwargs)

