
import io
import base64
import PIL


def fn_to_base64(filename):
    """ Read the image filename as a PIL image
    and encode it as base64.
    """
    img = PIL.Image.open(filename)
    encoded = pil_to_base64(img)
    img.close()
    return encoded

def pil_to_base64(pil_img):
    """ Encode as base64 the PIL image to be
    returned as an AJAX response.
    """
    img_io = io.BytesIO()
    pil_img.save(img_io, format='PNG')
    return base64.b64encode(img_io.getvalue()).decode("utf-8")