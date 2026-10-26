/// <reference lib="webworker" />

type RegionRequest = {
  dims: [number, number, number];
  values: Float32Array;
  level: number;
  minRegionVoxels: number;
  maxRegions: number;
};

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<RegionRequest>) => {
  const {
    dims,
    values,
    level,
    minRegionVoxels,
    maxRegions,
  } = event.data;

  const [xDim, yDim, zDim] = dims;
  const total = xDim * yDim * zDim;

  if (!total || values.length !== total) {
    workerScope.postMessage({
      error: "Invalid volume dimensions for region analysis.",
    });
    return;
  }

  const labels = new Int32Array(total);
  const queue = new Int32Array(total);
  const sizes: number[] = [0];

  const xy = xDim * yDim;
  let nextRegionId = 1;

  const pushNeighbor = (
    index: number,
    regionId: number,
    tail: number,
  ) => {
    if (
      labels[index] !== 0 ||
      !Number.isFinite(values[index]) ||
      values[index] < level
    ) {
      return tail;
    }

    labels[index] = regionId;
    queue[tail] = index;
    return tail + 1;
  };

  for (let seed = 0; seed < total; seed++) {
    if (
      labels[seed] !== 0 ||
      !Number.isFinite(values[seed]) ||
      values[seed] < level
    ) {
      continue;
    }

    const regionId = nextRegionId++;
    let head = 0;
    let tail = 0;
    let size = 0;

    labels[seed] = regionId;
    queue[tail++] = seed;

    while (head < tail) {
      const index = queue[head++];
      size++;

      const z = Math.floor(index / xy);
      const remainder = index - z * xy;
      const y = Math.floor(remainder / xDim);
      const x = remainder - y * xDim;

      if (x > 0) {
        tail = pushNeighbor(index - 1, regionId, tail);
      }

      if (x + 1 < xDim) {
        tail = pushNeighbor(index + 1, regionId, tail);
      }

      if (y > 0) {
        tail = pushNeighbor(index - xDim, regionId, tail);
      }

      if (y + 1 < yDim) {
        tail = pushNeighbor(index + xDim, regionId, tail);
      }

      if (z > 0) {
        tail = pushNeighbor(index - xy, regionId, tail);
      }

      if (z + 1 < zDim) {
        tail = pushNeighbor(index + xy, regionId, tail);
      }
    }

    sizes[regionId] = size;
  }

  const selectedRegions = sizes
    .map((size, id) => ({ id, size }))
    .filter(
      ({ id, size }) =>
        id > 0 &&
        size >= Math.max(1, minRegionVoxels),
    )
    .sort((a, b) => b.size - a.size)
    .slice(0, Math.min(254, Math.max(1, maxRegions)));

  const remap = new Uint8Array(nextRegionId);

  selectedRegions.forEach(({ id }, index) => {
    remap[id] = index + 1;
  });

  const compact = new Uint8Array(total);

  for (let index = 0; index < total; index++) {
    compact[index] = remap[labels[index]] ?? 0;
  }

  workerScope.postMessage(
    {
      labelsBuffer: compact.buffer,
      regionCount: selectedRegions.length,
      dims,
    },
    [compact.buffer],
  );
};

export {};