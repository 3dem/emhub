"""
Small grids of maps for the gallery of 3D classes (load_volume_preview of
emhub.data.volume_density): kept as they are up to the maximum size,
Fourier scaled above it, uint8 over their own range.
"""

import base64
import os
import tempfile
import unittest
import zlib

import mrcfile
import numpy as np

from emhub.data.volume_density import load_volume_preview


def _grid(result):
    raw = base64.b64decode(result['data'])
    if result['encoding'] == 'zlib':
        raw = zlib.decompress(raw)
    return np.frombuffer(raw, dtype=np.uint8).reshape(result['shape'])


class TestVolumePreview(unittest.TestCase):
    def _map(self, folder, n):
        z, y, x = np.mgrid[:n, :n, :n] - n / 2
        data = np.exp(-(x ** 2 + y ** 2 + z ** 2) / (2 * (n / 8) ** 2)).astype(np.float32)
        path = os.path.join(folder, f'map{n}.mrc')
        with mrcfile.new(path) as mrc:
            mrc.set_data(data)
        return path

    def test_small_map_kept(self):
        with tempfile.TemporaryDirectory() as folder:
            r = load_volume_preview(self._map(folder, 32))
            self.assertEqual(r['shape'], [32, 32, 32])
            self.assertEqual(r['dimensions'], [32, 32, 32])
            self.assertEqual(r['binning'], 1.0)
            g = _grid(r)
            # The blob in the middle is the brightest
            self.assertEqual(g[16, 16, 16], g.max())
            self.assertEqual(g[0, 0, 0], 0)

    def test_big_map_scaled(self):
        with tempfile.TemporaryDirectory() as folder:
            r = load_volume_preview(self._map(folder, 128), max_size=64)
            self.assertEqual(r['shape'], [64, 64, 64])
            self.assertEqual(r['dimensions'], [128, 128, 128])
            self.assertAlmostEqual(r['binning'], 2.0)
            self.assertEqual(_grid(r).shape, (64, 64, 64))


if __name__ == '__main__':
    unittest.main()
