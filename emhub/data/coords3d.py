"""Load Relion 5 tomography coordinates and convert them for display."""

import os

from emtools.metadata import StarFile, RelionStar

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
        return star_path
    return os.path.join(root, star_path)


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
        candidates.append(os.path.normpath(os.path.join(root, linked_path)))

    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate

    return candidates[-1] if root else candidates[0]


def _read_first_table(star_path):
    with StarFile(star_path) as sf:
        table_names = sf.getTableNames()
        if not table_names:
            raise Exception(f'STAR file has no tables: {star_path}')
        table_name = table_names[0]
        table = sf.getTable(table_name)
        if not table:
            raise Exception(f'Could not read table {table_name!r} from {star_path}')
        return table, table_name


def resolve_coords_set(root, output_path):
    """Resolve optimisation_set.star or particles.star to linked STAR files."""
    coords_star = _resolve_star_path(root, output_path)
    if not os.path.exists(coords_star):
        raise Exception(f'Coordinates STAR file not found: {output_path}')

    particles_star = coords_star
    tomograms_star = None

    if coords_star.endswith('optimisation_set.star'):
        with StarFile(coords_star) as sf:
            table_names = sf.getTableNames()
            if not table_names:
                raise Exception(f'STAR file has no tables: {coords_star}')
            table_name = (
                'optimisation_set' if 'optimisation_set' in table_names
                else table_names[0]
            )
            opt_table = sf.getTable(table_name)
            if not opt_table:
                raise Exception(
                    f'Could not read table {table_name!r} from {coords_star}'
                )
        opt_row = opt_table[0]._asdict()
        particles_rel = opt_row.get('rlnTomoParticlesFile')
        tomograms_rel = opt_row.get('rlnTomoTomogramsFile')
        if not particles_rel:
            raise Exception(
                f'{output_path} does not contain column rlnTomoParticlesFile'
            )
        particles_star = _resolve_linked_path(coords_star, particles_rel, root)
        if tomograms_rel:
            tomograms_star = _resolve_linked_path(coords_star, tomograms_rel, root)
    elif not coords_star.endswith('particles.star'):
        raise Exception(
            'Coordinates input must be optimisation_set.star or particles.star'
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
    table = StarFile.getTableFromFile('particles', particles_star)
    if not table:
        raise Exception(f"Could not read 'particles' table from {particles_star}")
    return table


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
    for point in payload['coords']:
        x.append(point['x'])
        y.append(point['y'])
        z.append(point['z'])
    return {'x': x, 'y': y, 'z': z}


def load_tomogram_card_coordinates(root, output_path, tomo_name):
    """Load x/y/z arrays for the tomogram volume slider card."""
    if not output_path or not tomo_name:
        return {'x': [], 'y': [], 'z': []}
    return load_tomogram_coordinates(root, output_path, tomo_name)

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
