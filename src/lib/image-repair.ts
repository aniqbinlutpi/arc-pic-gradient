"use client";

function isLikelyBrokenJfifHeader(bytes: Uint8Array) {
  const hasJfifSignature =
    bytes[6] === 0x4a &&
    bytes[7] === 0x46 &&
    bytes[8] === 0x49 &&
    bytes[9] === 0x46;
  const hasExifSignature =
    bytes[6] === 0x45 &&
    bytes[7] === 0x78 &&
    bytes[8] === 0x69 &&
    bytes[9] === 0x66;

  return (
    bytes.length > 12 &&
    !(bytes[0] === 0xff && bytes[1] === 0xd8) &&
    bytes[3] === 0xe0 &&
    (hasJfifSignature || hasExifSignature)
  );
}

async function readSourceAsBytes(source: Blob | string) {
  if (typeof source === "string") {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to read image source: ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  return new Uint8Array(await source.arrayBuffer());
}

async function normalizeBrokenImageSource(source: Blob | string) {
  const bytes = await readSourceAsBytes(source);

  if (!isLikelyBrokenJfifHeader(bytes)) {
    return source instanceof Blob ? source : new Blob([bytes]);
  }

  const repairedBytes = new Uint8Array(bytes);
  repairedBytes[0] = 0xff;
  repairedBytes[1] = 0xd8;
  repairedBytes[2] = 0xff;
  repairedBytes[3] = 0xe0;

  return new Blob([repairedBytes], { type: "image/jpeg" });
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function colorDistance(a: [number, number, number], b: [number, number, number]) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function readPixel(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const index = (y * width + x) * 4;
  return [data[index], data[index + 1], data[index + 2], data[index + 3]];
}

function writePixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rgba: [number, number, number, number],
) {
  const index = (y * width + x) * 4;
  data[index] = clampChannel(rgba[0]);
  data[index + 1] = clampChannel(rgba[1]);
  data[index + 2] = clampChannel(rgba[2]);
  data[index + 3] = clampChannel(rgba[3]);
}

function averageRgb(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function getScaledSize(width: number, height: number, maxDimension = 1600) {
  const largestSide = Math.max(width, height);
  if (largestSide <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / largestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function repairDamagedRows(data: Uint8ClampedArray, width: number, height: number) {
  const rowAverages: [number, number, number][] = [];

  for (let y = 0; y < height; y += 1) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      sumR += data[index];
      sumG += data[index + 1];
      sumB += data[index + 2];
    }

    rowAverages.push([sumR / width, sumG / width, sumB / width]);
  }

  for (let y = 1; y < height - 1; y += 1) {
    const previous = rowAverages[y - 1];
    const current = rowAverages[y];
    const next = rowAverages[y + 1];
    const neighborsDistance = colorDistance(previous, next);
    const currentJump = Math.min(colorDistance(current, previous), colorDistance(current, next));

    if (currentJump < 48 || neighborsDistance > currentJump * 0.5) {
      continue;
    }

    for (let x = 0; x < width; x += 1) {
      const above = readPixel(data, width, x, y - 1);
      const below = readPixel(data, width, x, y + 1);
      writePixel(data, width, x, y, [
        (above[0] + below[0]) / 2,
        (above[1] + below[1]) / 2,
        (above[2] + below[2]) / 2,
        (above[3] + below[3]) / 2,
      ]);
    }
  }
}

function repairDamagedColumns(data: Uint8ClampedArray, width: number, height: number) {
  const columnAverages: [number, number, number][] = [];

  for (let x = 0; x < width; x += 1) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    for (let y = 0; y < height; y += 1) {
      const index = (y * width + x) * 4;
      sumR += data[index];
      sumG += data[index + 1];
      sumB += data[index + 2];
    }

    columnAverages.push([sumR / height, sumG / height, sumB / height]);
  }

  for (let x = 1; x < width - 1; x += 1) {
    const previous = columnAverages[x - 1];
    const current = columnAverages[x];
    const next = columnAverages[x + 1];
    const neighborsDistance = colorDistance(previous, next);
    const currentJump = Math.min(colorDistance(current, previous), colorDistance(current, next));

    if (currentJump < 48 || neighborsDistance > currentJump * 0.5) {
      continue;
    }

    for (let y = 0; y < height; y += 1) {
      const left = readPixel(data, width, x - 1, y);
      const right = readPixel(data, width, x + 1, y);
      writePixel(data, width, x, y, [
        (left[0] + right[0]) / 2,
        (left[1] + right[1]) / 2,
        (left[2] + right[2]) / 2,
        (left[3] + right[3]) / 2,
      ]);
    }
  }
}

function repairArtifactPixels(data: Uint8ClampedArray, width: number, height: number) {
  const source = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const current = readPixel(source, width, x, y);
      const left = readPixel(source, width, x - 1, y);
      const right = readPixel(source, width, x + 1, y);
      const up = readPixel(source, width, x, y - 1);
      const down = readPixel(source, width, x, y + 1);

      if (current[3] < 16) {
        continue;
      }

      const horizontalAverage = averageRgb(
        [left[0], left[1], left[2]],
        [right[0], right[1], right[2]],
      );
      const verticalAverage = averageRgb(
        [up[0], up[1], up[2]],
        [down[0], down[1], down[2]],
      );
      const localAverage: [number, number, number] = [
        (horizontalAverage[0] + verticalAverage[0]) / 2,
        (horizontalAverage[1] + verticalAverage[1]) / 2,
        (horizontalAverage[2] + verticalAverage[2]) / 2,
      ];
      const neighborSpread = Math.max(
        colorDistance([left[0], left[1], left[2]], [right[0], right[1], right[2]]),
        colorDistance([up[0], up[1], up[2]], [down[0], down[1], down[2]]),
      );
      const anomaly = colorDistance([current[0], current[1], current[2]], localAverage);

      if (anomaly < 64 || neighborSpread > 52) {
        continue;
      }

      writePixel(data, width, x, y, [
        localAverage[0] * 0.72 + current[0] * 0.28,
        localAverage[1] * 0.72 + current[1] * 0.28,
        localAverage[2] * 0.72 + current[2] * 0.28,
        current[3],
      ]);
    }
  }
}

export async function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = url;
  });
}

export async function createRenderableImageUrl(source: Blob | string) {
  const normalizedSource = await normalizeBrokenImageSource(source);
  return URL.createObjectURL(normalizedSource);
}

export function revokeObjectUrls(...urls: Array<string | null | undefined>) {
  const uniqueUrls = new Set(urls.filter((url): url is string => Boolean(url?.startsWith("blob:"))));
  for (const url of uniqueUrls) {
    URL.revokeObjectURL(url);
  }
}

export async function repairImageUrl(source: Blob | string): Promise<string> {
  const normalizedUrl = await createRenderableImageUrl(source);
  const image = await loadImageFromUrl(normalizedUrl);
  const scaledSize = getScaledSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const canvas = document.createElement("canvas");
  canvas.width = scaledSize.width;
  canvas.height = scaledSize.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    revokeObjectUrls(normalizedUrl);
    throw new Error("Canvas is unavailable");
  }

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  repairDamagedRows(imageData.data, canvas.width, canvas.height);
  repairDamagedColumns(imageData.data, canvas.width, canvas.height);
  repairArtifactPixels(imageData.data, canvas.width, canvas.height);

  ctx.putImageData(imageData, 0, 0);

  const repairedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to export repaired image"));
        return;
      }

      resolve(blob);
    }, "image/png");
  });

  revokeObjectUrls(normalizedUrl);
  return URL.createObjectURL(repairedBlob);
}
