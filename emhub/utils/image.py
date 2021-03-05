# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *
# * [1] SciLifeLab, Stockholm University
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# * This program is distributed in the hope that it will be useful,
# * but WITHOUT ANY WARRANTY; without even the implied warranty of
# * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# * GNU General Public License for more details.
# *
# * You should have received a copy of the GNU General Public License
# * along with this program; if not, write to the Free Software
# * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA
# * 02111-1307  USA
# *
# *  All comments concerning this program package may be sent to the
# *  e-mail address 'delarosatrevin@scilifelab.se'
# *
# **************************************************************************

import io
import numpy as np
import base64
import mrcfile

from PIL import Image, ImageEnhance, ImageOps



def fn_to_base64(filename):
    """ Read the image filename as a PIL image
    and encode it as base64.
    """
    try:
        img = Image.open(filename)
        encoded = pil_to_base64(img)
        img.close()
    except:
        encoded = ''
    return encoded


def pil_to_base64(pil_img):
    """ Encode as base64 the PIL image to be
    returned as an AJAX response.
    """
    img_io = io.BytesIO()
    pil_img.save(img_io, format='PNG')
    return base64.b64encode(img_io.getvalue()).decode("utf-8")


def fn_to_blob(filename):
    """ Read the image filename as a PIL image
    and encode it as base64.
    """
    try:
        with open(filename, 'rb') as img_f:
            binary_data = img_f.read()  # read the image as python binary

        return np.asarray(binary_data)
    except:
        return np.array(0)


def mrc_to_base64(filename, MAX_SIZE=(512,512), contrast_factor=None):
    """ Convert real float32 mrc to base64.
    Convert to int8 first, then scale with Pillow.
    """
    mrc_img = mrcfile.open(filename, permissive=True)

    if mrc_img.is_volume():
        imfloat = mrc_img.data[0, :, :]
    else:
        imfloat = mrc_img.data

    imean = imfloat.mean()
    isd = imfloat.std()

    iMax = min(imean + 3 * isd, imfloat.max())
    iMin = max(imean - 3 * isd, imfloat.min())
    im255 = ((imfloat - iMin) / (iMax - iMin) * 255).astype(np.uint8)
    mrc_img.close()

    pil_img = Image.fromarray(im255)

    if contrast_factor is not None:
        pil_img = ImageOps.autocontrast(pil_img, contrast_factor)

    pil_img.thumbnail(MAX_SIZE)

    img_io = io.BytesIO()
    pil_img.save(img_io, format='PNG')

    return base64.b64encode(img_io.getvalue()).decode("utf-8")
