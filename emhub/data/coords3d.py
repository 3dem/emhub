"""Load Relion 5 tomography coordinates and convert them for display."""

import os
import re
from functools import lru_cache

from emtools.metadata import StarFile, RelionStar

from emhub.data.processing import resolve_project_root

ANGLE_COLUMNS = ('rlnAngleRot', 'rlnAngleTilt', 'rlnAnglePsi')
TEMPLATE_MAX_GRID = 40
# job.star option holding the template map, e.g. "pytom.template  PyTom/job023/x_template.mrc"
_TEMPLATE_OPTION = re.compile(r'^\s*(\S*template\S*)\s+(\S+\.mrc)\s*$', re.IGNORECASE | re.MULTILINE)

SCORE_COLUMNS = (
    'rlnLCCmax',
    'rlnAutopickFigureOfMerit',
    'rlnScore',
    'rlnConfidence',
)


def _normalize_tomo_name(name):
    return os.path.basename(str(name))


def _resolve_star_path(root, star_path):
    if os.path.isabs(star_path):
        if star_path.startswith('~'):
            return os.path.abspath(os.path.expanduser(star_path))
        return star_path
    return os.path.join(resolve_project_root(root), star_path)


def _resolve_linked_path(base_star_path, linked_path, root=None):
    if not linked_path:
        return linked_path
    if os.path.isabs(linked_path):
        return linked_path

    candidates = [
        os.path.normpath(
            os.path.join(os.path.dirname(base_star_path), linked_path)
        ),
    ]
    if root:
        candidates.append(
            os.path.normpath(os.path.join(resolve_project_root(root), linked_path)))

    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate

    return candidates[-1] if root else candidates[0]


def resolve_coords_set(root, output_path):
    """Resolve optimisation_set.star or particles.star to linked STAR files."""
    coords_star = _resolve_star_path(root, output_path)
    if not os.path.exists(coords_star):
        raise Exception(f'Coordinates STAR file not found: {output_path}')

    particles_star = coords_star
    tomograms_star = None

    if RelionStar.isTomoOptimisationSet(coords_star):
        opt_row = RelionStar.readTomoOptimisationSet(coords_star)[0]._asdict()
        particles_rel = opt_row.get('rlnTomoParticlesFile')
        tomograms_rel = opt_row.get('rlnTomoTomogramsFile')
        if not particles_rel:
            raise Exception(
                f'{output_path} does not contain column rlnTomoParticlesFile'
            )
        particles_star = _resolve_linked_path(coords_star, particles_rel, root)
        if tomograms_rel:
            tomograms_star = _resolve_linked_path(coords_star, tomograms_rel, root)
    elif not RelionStar.isTomoParticles(coords_star):
        raise Exception(
            f'{output_path} is not a compliant tomography optimisation_set or '
            'particles STAR file'
        )

    if not os.path.exists(particles_star):
        raise Exception(f'Particles STAR file not found: {particles_star}')

    if tomograms_star and not os.path.exists(tomograms_star):
        raise Exception(f'Tomograms STAR file not found: {tomograms_star}')

    return {
        'coords_star': coords_star,
        'particles_star': particles_star,
        'tomograms_star': tomograms_star,
    }


def _load_tomograms_table(tomograms_star):
    if not tomograms_star:
        return None
    table = StarFile.getTableFromFile('global', tomograms_star)
    if not table:
        raise Exception(f"Could not read 'global' table from {tomograms_star}")
    return table


def _build_tomo_lookup(tomo_table):
    lookup = {}
    if not tomo_table:
        return lookup
    for row in tomo_table:
        lookup[_normalize_tomo_name(row.rlnTomoName)] = row
    return lookup


def _tomogram_dims(tomo_row):
    binning = RelionStar.getTomoBinning(tomo_row)
    return [
        int(round(float(getattr(tomo_row, 'rlnTomoSizeX')) / binning)),
        int(round(float(getattr(tomo_row, 'rlnTomoSizeY')) / binning)),
        int(round(float(getattr(tomo_row, 'rlnTomoSizeZ')) / binning)),
    ]


def _tomogram_voxel_size(tomo_row):
    ps = RelionStar.getTomoPixelSize(tomo_row)
    return [ps, ps, ps]


def _particle_score(row):
    for col in SCORE_COLUMNS:
        if hasattr(row, col):
            try:
                value = float(getattr(row, col))
            except (TypeError, ValueError):
                continue
            if value == value:  # NaN check
                return value
    return None


def _particle_pixel_coords(row, tomo_row):
    if hasattr(row, 'rlnCenteredCoordinateXAngst'):
        return (
            RelionStar.centeredAngstToPixel(
                float(row.rlnCenteredCoordinateXAngst), tomo_row, 'rlnTomoSizeX'),
            RelionStar.centeredAngstToPixel(
                float(row.rlnCenteredCoordinateYAngst), tomo_row, 'rlnTomoSizeY'),
            RelionStar.centeredAngstToPixel(
                float(row.rlnCenteredCoordinateZAngst), tomo_row, 'rlnTomoSizeZ'),
        )
    return (
        float(row.rlnCoordinateX),
        float(row.rlnCoordinateY),
        float(row.rlnCoordinateZ),
    )


def _load_particles_table(particles_star):
    if not RelionStar.isTomoParticles(particles_star):
        raise Exception(
            f"{particles_star} is not a compliant tomography particles STAR file"
        )
    return RelionStar.readTomoParticles(particles_star)


def _iter_particles_for_tomo(particles_table, tomo_name):
    target = _normalize_tomo_name(tomo_name)
    for row in particles_table:
        if _normalize_tomo_name(row.rlnTomoName) == target:
            yield row


def _count_particles_for_tomo(particles_table, tomo_name):
    return sum(1 for _ in _iter_particles_for_tomo(particles_table, tomo_name))


def load_coords3d_tomograms(root, output_path):
    """List tomograms and coordinate counts for a coordinates set."""
    paths = resolve_coords_set(root, output_path)
    particles_table = _load_particles_table(paths['particles_star'])
    tomo_table = _load_tomograms_table(paths['tomograms_star'])
    tomo_lookup = _build_tomo_lookup(tomo_table)

    tomo_names = []
    if tomo_table:
        tomo_names = [_normalize_tomo_name(row.rlnTomoName) for row in tomo_table]
    else:
        seen = set()
        for row in particles_table:
            name = _normalize_tomo_name(row.rlnTomoName)
            if name not in seen:
                seen.add(name)
                tomo_names.append(name)

    items = []
    for tomo_name in tomo_names:
        tomo_row = tomo_lookup.get(tomo_name)
        item = {
            'id': tomo_name,
            'name': tomo_name,
            'label': tomo_name,
            'tomoId': tomo_name,
            'nCoords': _count_particles_for_tomo(particles_table, tomo_name),
        }
        if tomo_row:
            item['dims'] = _tomogram_dims(tomo_row)
            item['voxelSize'] = _tomogram_voxel_size(tomo_row)
            tomo_path = RelionStar.getTomogram(tomo_row)
            if not os.path.isabs(tomo_path):
                tomo_path = os.path.normpath(
                    os.path.join(os.path.dirname(paths['tomograms_star']), tomo_path)
                )
            item['tomogramPath'] = tomo_path
        items.append(item)

    return items


def load_coords3d_for_tomogram(root, output_path, tomo_id):
    """Return display coordinates in reconstructed tomogram pixel space."""
    paths = resolve_coords_set(root, output_path)
    particles_table = _load_particles_table(paths['particles_star'])
    tomo_table = _load_tomograms_table(paths['tomograms_star'])
    tomo_lookup = _build_tomo_lookup(tomo_table)

    tomo_name = _normalize_tomo_name(tomo_id)
    tomo_row = tomo_lookup.get(tomo_name)
    if tomo_row is None and tomo_lookup:
        raise Exception(f'Tomogram {tomo_name!r} not found in tomograms STAR file')

    coords = []
    for idx, row in enumerate(_iter_particles_for_tomo(particles_table, tomo_name)):
        if tomo_row is None:
            x, y, z = (
                float(row.rlnCoordinateX),
                float(row.rlnCoordinateY),
                float(row.rlnCoordinateZ),
            )
        else:
            x, y, z = _particle_pixel_coords(row, tomo_row)

        point = {
            'id': getattr(row, 'rlnTomoParticleId', idx + 1),
            'x': round(x),
            'y': round(y),
            'z': round(z),
            'tomoId': tomo_name,
        }
        if score := _particle_score(row):
            point['score'] = score
        if hasattr(row, 'rlnAngleRot'):
            point['angles'] = [float(getattr(row, c, 0) or 0) for c in ANGLE_COLUMNS]
        coords.append(point)

    result = {
        'tomoId': tomo_name,
        'tomogramLabel': tomo_name,
        'n': len(coords),
        'coords': coords,
    }
    if tomo_row:
        result['dims'] = _tomogram_dims(tomo_row)
        result['voxelSize'] = _tomogram_voxel_size(tomo_row)
    return result


def count_particles_for_tomo(root, output_path, tomo_name):
    """Return the number of particles in particles.star for one tomogram."""
    paths = resolve_coords_set(root, output_path)
    particles_table = _load_particles_table(paths['particles_star'])
    return _count_particles_for_tomo(particles_table, tomo_name)


def load_tomogram_coordinates(root, output_path, tomo_name):
    """Load display coordinates for one tomogram from a coordinates set."""
    payload = load_coords3d_for_tomogram(root, output_path, tomo_name)
    x, y, z = [], [], []
    angles = []
    for point in payload['coords']:
        x.append(point['x'])
        y.append(point['y'])
        z.append(point['z'])
        angles.append(point.get('angles'))
    result = {'x': x, 'y': y, 'z': z}
    if angles and all(angles):
        result['angles'] = angles
    return result


def load_tomogram_card_coordinates(root, output_path, tomo_name):
    """Load x/y/z arrays for the tomogram volume slider card."""
    if not output_path or not tomo_name:
        return {'x': [], 'y': [], 'z': []}
    result = load_tomogram_coordinates(root, output_path, tomo_name)
    if result['x']:
        template = load_particles_template(root, output_path)
        if template:
            result['template'] = template
    return result

def load_coords3d_tomogram_slice(root, output_path, tomo_id, slice_index, axis='z'):
    """Render one tomogram slice as a base64 PNG for the coords3d viewer."""
    from emtools.image import Thumbnail

    paths = resolve_coords_set(root, output_path)
    tomo_table = _load_tomograms_table(paths['tomograms_star'])
    tomo_lookup = _build_tomo_lookup(tomo_table)

    tomo_name = _normalize_tomo_name(tomo_id)
    tomo_row = tomo_lookup.get(tomo_name)
    if tomo_row is None:
        raise Exception(f'Tomogram {tomo_name!r} not found in tomograms STAR file')

    tomo_path = RelionStar.getTomogram(tomo_row)
    if not os.path.isabs(tomo_path):
        tomo_path = _resolve_linked_path(paths['tomograms_star'], tomo_path, root)
    if not os.path.exists(tomo_path):
        raise Exception(f'Tomogram file not found: {tomo_path}')

    import mrcfile

    axis = (axis or 'z').lower()
    with mrcfile.open(tomo_path, permissive=True) as mrc:
        data = mrc.data
        zdim, ydim, xdim = data.shape
        index = int(slice_index)
        if axis == 'x':
            if index < 0 or index >= xdim:
                raise Exception(f'X slice index {index} out of range [0, {xdim - 1}]')
            slice_array = data[:, :, index].T
        elif axis == 'y':
            if index < 0 or index >= ydim:
                raise Exception(f'Y slice index {index} out of range [0, {ydim - 1}]')
            slice_array = data[:, index, :]
        else:
            if index < 0 or index >= zdim:
                raise Exception(f'Z slice index {index} out of range [0, {zdim - 1}]')
            slice_array = data[index, :, :]

    thumb = Thumbnail(output_format='base64', contrast_factor=0.5)
    image_base64 = thumb.from_array(slice_array)
    dims = _tomogram_dims(tomo_row)
    return {
        'imageBase64': image_base64,
        'mime': 'image/png',
        'width': int(slice_array.shape[1]),
        'height': int(slice_array.shape[0]),
        'depth': dims[2 if axis == 'z' else 1 if axis == 'y' else 0],
        'voxelSize': _tomogram_voxel_size(tomo_row),
        'axis': axis,
        'index': index,
    }


def _find_template_path(root, output_path):
    """ Template map of the job that produced the particles: the 'template'
    option of the job.star found going up from the output file. """
    from emhub.data.processing import project_file_path

    project = resolve_project_root(root)
    folder = os.path.dirname(_resolve_star_path(root, output_path))
    while folder.startswith(project) and folder != project:
        job_star = os.path.join(folder, 'job.star')
        if os.path.exists(job_star):
            with open(job_star) as f:
                for name, value in _TEMPLATE_OPTION.findall(f.read()):
                    if 'mask' in name.lower():
                        continue
                    try:
                        path = project_file_path(root, value)
                    except ValueError:
                        continue
                    if path and os.path.exists(path):
                        return path
            return None
        folder = os.path.dirname(folder)
    return None


def _surface_nets(f):
    """ Triangle mesh of the surface f == 0 (inside is f > 0) of a 3D array,
    with numpy only. Returns (vertices in grid units, triangles). """
    import numpy as np

    n = f.shape
    cells = tuple(i - 1 for i in n)

    def corner(d):
        return f[d[0]:n[0] - 1 + d[0], d[1]:n[1] - 1 + d[1], d[2]:n[2] - 1 + d[2]]

    corners = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    edges = [(c, tuple(c[x] + (1 if x == a else 0) for x in range(3)))
             for c in corners for a in range(3) if c[a] == 0]
    total = np.zeros(cells + (3,))
    count = np.zeros(cells)
    for c0, c1 in edges:
        f0, f1 = corner(c0), corner(c1)
        cross = (f0 > 0) != (f1 > 0)
        t = np.divide(f0, f0 - f1, out=np.zeros_like(f0), where=cross)
        point = np.array(c0, dtype=float) + t[..., None] * (np.array(c1) - np.array(c0))
        total += cross[..., None] * point
        count += cross
    has = count > 0
    vid = -np.ones(cells, dtype=np.int64)
    vid[has] = np.arange(int(has.sum()))
    verts = total[has] / count[has][:, None] + np.argwhere(has)

    tris = []
    for a in range(3):
        b, c = (a + 1) % 3, (a + 2) % 3
        lo = [slice(1, n[x] - 1) for x in range(3)]
        lo[a] = slice(0, n[a] - 1)
        hi = list(lo)
        hi[a] = slice(1, n[a])
        f0, f1 = f[tuple(lo)], f[tuple(hi)]
        cross = (f0 > 0) != (f1 > 0)
        p = np.argwhere(cross)
        if not len(p):
            continue
        p[:, b] += 1
        p[:, c] += 1
        flip = ~(f0[cross] > 0)
        quad = []
        for db, dc in ((0, 0), (1, 0), (1, 1), (0, 1)):
            q = p.copy()
            q[:, b] -= db
            q[:, c] -= dc
            quad.append(vid[q[:, 0], q[:, 1], q[:, 2]])
        quad = np.stack(quad, axis=1)
        quad[flip] = quad[flip][:, ::-1]
        tris.append(quad[:, [0, 1, 2]])
        tris.append(quad[:, [0, 2, 3]])
    faces = np.concatenate(tris) if tris else np.zeros((0, 3), dtype=np.int64)
    return verts, faces[(faces >= 0).all(axis=1)]


@lru_cache(maxsize=8)
def _template_mesh(path, mtime):
    """ Iso-surface of a template map, centered, in Å (x, y, z order). """
    import mrcfile
    import numpy as np

    with mrcfile.open(path, permissive=True) as mrc:
        data = np.asarray(mrc.data, dtype=np.float32)
        voxel = float(mrc.voxel_size.x)
    if data.ndim != 3 or voxel <= 0:
        return None
    if abs(data.min()) > abs(data.max()):
        data = -data
    if data.max() <= 0:
        return None
    k = -(-max(data.shape) // TEMPLATE_MAX_GRID)
    if k > 1:
        crop = tuple(s - s % k for s in data.shape)
        data = data[:crop[0], :crop[1], :crop[2]]
        data = data.reshape(crop[0] // k, k, crop[1] // k, k, crop[2] // k, k).mean(axis=(1, 3, 5))
        voxel *= k
    # The padding closes the surface of a map that touches the box
    data = np.pad(data, 1)
    verts, faces = _surface_nets(data - 0.3 * float(data.max()))
    if not len(faces):
        return None
    verts = (verts - 1 - (np.array(data.shape) - 3) / 2.0) * voxel
    verts = verts[:, ::-1]  # (z, y, x) -> (x, y, z), which flips the winding
    faces = faces[:, ::-1]
    return {
        'vertices': [round(float(v), 2) for v in verts.ravel()],
        'faces': [int(i) for i in faces.ravel()],
    }


def load_particles_template(root, output_path):
    """ Surface of the template map used to pick the particles, or None. """
    try:
        path = _find_template_path(root, output_path)
        return _template_mesh(path, os.path.getmtime(path)) if path else None
    except Exception:
        return None
