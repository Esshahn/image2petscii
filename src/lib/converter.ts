import type { CharBitmap } from "./charset";
import type { RGB } from "./colors";

// C64 screen resolution
export const C64_WIDTH = 320;
export const C64_HEIGHT = 200;

export interface PetsciiCell {
  charIndex: number;
  fgColorIndex: number;
  inverted: boolean;
}

export interface ConversionResult {
  cols: number;
  rows: number;
  cells: PetsciiCell[];
  ditheredBw: Uint8Array;
  width: number;
  height: number;
}

export type DitherMethod =
  | "floyd-steinberg"
  | "atkinson"
  | "jarvis"
  | "stucki"
  | "threshold";

export const DITHER_METHODS: { value: DitherMethod; label: string }[] = [
  { value: "floyd-steinberg", label: "Floyd-Steinberg" },
  { value: "atkinson", label: "Atkinson" },
  { value: "jarvis", label: "Jarvis-Judice-Ninke" },
  { value: "stucki", label: "Stucki" },
  { value: "threshold", label: "Threshold" },
];

export interface DitherSettings {
  method: DitherMethod;
  contrast: number;
  resolution: number;
  blackPoint: number;
  whitePoint: number;
  gamma: number;
}

export interface ConversionSettings {
  charset: CharBitmap[];
  palette: RGB[];
  bgColorIndex: number;
  excludedChars: Set<number>;
  excludedColors: Set<number>;
}

/**
 * Extract the distinct colors from an image, then reorder them to match
 * C64 color indices by greedy matching against all known palettes.
 */
export function extractPaletteFromImage(
  imageData: ImageData,
  allPalettes: RGB[][]
): RGB[] {
  const data = imageData.data;
  const pixels = imageData.width * imageData.height;

  // Step 1: Quantize pixels and count frequencies
  const colorCounts = new Map<number, { r: number; g: number; b: number; count: number }>();
  for (let i = 0; i < pixels; i++) {
    const idx = i * 4;
    const qr = data[idx] & 0xfc;
    const qg = data[idx + 1] & 0xfc;
    const qb = data[idx + 2] & 0xfc;
    const key = (qr << 16) | (qg << 8) | qb;
    const entry = colorCounts.get(key);
    if (entry) {
      entry.r += data[idx];
      entry.g += data[idx + 1];
      entry.b += data[idx + 2];
      entry.count++;
    } else {
      colorCounts.set(key, { r: data[idx], g: data[idx + 1], b: data[idx + 2], count: 1 });
    }
  }

  // Take top 16 most frequent distinct colors
  const sorted = [...colorCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 16);

  const extracted: RGB[] = sorted.map((e) => ({
    r: Math.round(e.r / e.count),
    g: Math.round(e.g / e.count),
    b: Math.round(e.b / e.count),
  }));

  // Step 2: Greedy bipartite matching — assign each extracted color to a C64 index.
  // Build all (extractedIdx, c64Index, distance) pairs, sort by distance,
  // then greedily assign closest pairs first.
  const pairs: { ei: number; ci: number; dist: number }[] = [];
  for (let ei = 0; ei < extracted.length; ei++) {
    const ec = extracted[ei];
    for (let ci = 0; ci < 16; ci++) {
      // Find minimum distance to this C64 index across all known palettes
      let minDist = Infinity;
      for (const pal of allPalettes) {
        const ref = pal[ci];
        const dist =
          2 * (ec.r - ref.r) * (ec.r - ref.r) +
          4 * (ec.g - ref.g) * (ec.g - ref.g) +
          3 * (ec.b - ref.b) * (ec.b - ref.b);
        if (dist < minDist) minDist = dist;
      }
      pairs.push({ ei, ci, dist: minDist });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);

  const result: RGB[] = new Array(16);
  const assignedExtracted = new Set<number>();
  const assignedC64 = new Set<number>();

  for (const { ei, ci } of pairs) {
    if (assignedExtracted.has(ei) || assignedC64.has(ci)) continue;
    result[ci] = extracted[ei];
    assignedExtracted.add(ei);
    assignedC64.add(ci);
    if (assignedC64.size === 16) break;
  }

  // Fill any unassigned C64 indices with fallback (averaged across palettes)
  for (let i = 0; i < 16; i++) {
    if (!result[i]) {
      let r = 0, g = 0, b = 0;
      for (const pal of allPalettes) {
        r += pal[i].r;
        g += pal[i].g;
        b += pal[i].b;
      }
      result[i] = {
        r: Math.round(r / allPalettes.length),
        g: Math.round(g / allPalettes.length),
        b: Math.round(b / allPalettes.length),
      };
    }
  }

  return result;
}

export function ditherImage(
  sourceImage: HTMLImageElement,
  settings: DitherSettings
): { bw: Uint8Array; imageData: ImageData; width: number; height: number } {
  // Full-res image data (for color pass)
  const canvas = document.createElement("canvas");
  canvas.width = C64_WIDTH;
  canvas.height = C64_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(sourceImage, 0, 0, C64_WIDTH, C64_HEIGHT);
  const imageData = ctx.getImageData(0, 0, C64_WIDTH, C64_HEIGHT);

  // Dither at reduced resolution
  const scale = Math.max(1, Math.round(settings.resolution));
  const dw = Math.floor(C64_WIDTH / scale);
  const dh = Math.floor(C64_HEIGHT / scale);

  const smallCanvas = document.createElement("canvas");
  smallCanvas.width = dw;
  smallCanvas.height = dh;
  const sctx = smallCanvas.getContext("2d")!;
  sctx.drawImage(sourceImage, 0, 0, dw, dh);
  const smallData = sctx.getImageData(0, 0, dw, dh).data;

  const smallPixels = dw * dh;
  const lum = new Float64Array(smallPixels);
  for (let i = 0; i < smallPixels; i++) {
    const idx = i * 4;
    lum[i] = 0.2126 * smallData[idx] + 0.7152 * smallData[idx + 1] + 0.0722 * smallData[idx + 2];
  }

  // Auto-levels
  let lumMin = 255, lumMax = 0;
  for (let i = 0; i < smallPixels; i++) {
    if (lum[i] < lumMin) lumMin = lum[i];
    if (lum[i] > lumMax) lumMax = lum[i];
  }
  const lumRange = lumMax - lumMin || 1;
  for (let i = 0; i < smallPixels; i++) {
    lum[i] = ((lum[i] - lumMin) / lumRange) * 255;
  }

  // Levels adjustment: remap blackPoint..whitePoint to 0..255, then apply gamma
  const bp = settings.blackPoint;
  const wp = settings.whitePoint;
  const lvlRange = Math.max(1, wp - bp);
  const gammaInv = 1.0 / Math.max(0.01, settings.gamma);
  if (bp > 0 || wp < 255 || Math.abs(settings.gamma - 1.0) > 0.01) {
    for (let i = 0; i < smallPixels; i++) {
      let v = (lum[i] - bp) / lvlRange;
      v = Math.max(0, Math.min(1, v));
      lum[i] = 255 * Math.pow(v, gammaInv);
    }
  }

  // S-curve contrast boost
  if (settings.contrast > 0) {
    for (let i = 0; i < smallPixels; i++) {
      const normalized = lum[i] / 255;
      lum[i] = 255 / (1 + Math.exp(-settings.contrast * (normalized - 0.5)));
    }
  }

  // Apply selected dithering method
  const smallBw = new Uint8Array(smallPixels);

  if (settings.method === "threshold") {
    for (let i = 0; i < smallPixels; i++) {
      smallBw[i] = lum[i] >= 128 ? 1 : 0;
    }
  } else {
    applyErrorDiffusion(lum, smallBw, dw, dh, settings.method);
  }

  // Upscale to full resolution
  const bw = new Uint8Array(C64_WIDTH * C64_HEIGHT);
  for (let y = 0; y < C64_HEIGHT; y++) {
    for (let x = 0; x < C64_WIDTH; x++) {
      const sx = Math.min(Math.floor(x / scale), dw - 1);
      const sy = Math.min(Math.floor(y / scale), dh - 1);
      bw[y * C64_WIDTH + x] = smallBw[sy * dw + sx];
    }
  }

  return { bw, imageData, width: C64_WIDTH, height: C64_HEIGHT };
}

// Error diffusion kernels: [dx, dy, weight]
const ERROR_KERNELS: Record<string, [number, number, number][]> = {
  "floyd-steinberg": [
    [1, 0, 7/16], [-1, 1, 3/16], [0, 1, 5/16], [1, 1, 1/16],
  ],
  "atkinson": [
    [1, 0, 1/8], [2, 0, 1/8],
    [-1, 1, 1/8], [0, 1, 1/8], [1, 1, 1/8],
    [0, 2, 1/8],
  ],
  "jarvis": [
    [1, 0, 7/48], [2, 0, 5/48],
    [-2, 1, 3/48], [-1, 1, 5/48], [0, 1, 7/48], [1, 1, 5/48], [2, 1, 3/48],
    [-2, 2, 1/48], [-1, 2, 3/48], [0, 2, 5/48], [1, 2, 3/48], [2, 2, 1/48],
  ],
  "stucki": [
    [1, 0, 8/42], [2, 0, 4/42],
    [-2, 1, 2/42], [-1, 1, 4/42], [0, 1, 8/42], [1, 1, 4/42], [2, 1, 2/42],
    [-2, 2, 1/42], [-1, 2, 2/42], [0, 2, 4/42], [1, 2, 2/42], [2, 2, 1/42],
  ],
};

function applyErrorDiffusion(
  lum: Float64Array,
  bw: Uint8Array,
  w: number,
  h: number,
  method: string
): void {
  const kernel = ERROR_KERNELS[method];
  if (!kernel) return;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const oldVal = lum[i];
      const newVal = oldVal >= 128 ? 255 : 0;
      bw[i] = newVal > 0 ? 1 : 0;
      const error = oldVal - newVal;

      for (const [dx, dy, weight] of kernel) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          lum[ny * w + nx] += error * weight;
        }
      }
    }
  }
}

export function convertFromDithered(
  imageData: ImageData,
  bw: Uint8Array,
  width: number,
  height: number,
  settings: ConversionSettings
): ConversionResult {
  const COLS = width / 8;
  const ROWS = height / 8;

  const bgColor = settings.palette[settings.bgColorIndex];
  const cells: PetsciiCell[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = matchBlock(
        imageData.data, bw, width, col * 8, row * 8, settings, bgColor
      );
      cells.push(cell);
    }
  }

  return { cols: COLS, rows: ROWS, cells, ditheredBw: bw, width, height };
}

function matchBlock(
  data: Uint8ClampedArray,
  bw: Uint8Array,
  imgWidth: number,
  bx: number,
  by: number,
  settings: ConversionSettings,
  bgColor: RGB
): PetsciiCell {
  const { charset, palette, excludedChars, excludedColors } = settings;

  const blockBw = new Uint8Array(64);
  const rr = new Float64Array(64);
  const gg = new Float64Array(64);
  const bb = new Float64Array(64);

  for (let py = 0; py < 8; py++) {
    for (let px = 0; px < 8; px++) {
      const imgIdx = (by + py) * imgWidth + (bx + px);
      const i = py * 8 + px;
      blockBw[i] = bw[imgIdx];
      const dataIdx = imgIdx * 4;
      rr[i] = data[dataIdx];
      gg[i] = data[dataIdx + 1];
      bb[i] = data[dataIdx + 2];
    }
  }

  // First pass: hamming scores for all non-excluded characters
  // Collect normal and inverted candidates SEPARATELY so both polarities
  // get a fair chance (important when background color is bright)
  const NUM_CHARS = charset.length;
  const normalScores: { ci: number; inverted: false; hamming: number }[] = [];
  const invertedScores: { ci: number; inverted: true; hamming: number }[] = [];

  for (let ci = 0; ci < NUM_CHARS; ci++) {
    if (excludedChars.has(ci)) continue;

    const bitmap = charset[ci];
    let matchNormal = 0;
    for (let i = 0; i < 64; i++) {
      if (bitmap[i] === (blockBw[i] === 1)) matchNormal++;
    }

    normalScores.push({ ci, inverted: false, hamming: matchNormal });
    invertedScores.push({ ci, inverted: true, hamming: 64 - matchNormal });
  }

  // Take top candidates from EACH polarity separately, then combine
  let bestNormal = 0, bestInvertedH = 0;
  for (const s of normalScores) {
    if (s.hamming > bestNormal) bestNormal = s.hamming;
  }
  for (const s of invertedScores) {
    if (s.hamming > bestInvertedH) bestInvertedH = s.hamming;
  }

  const candidates = [
    ...normalScores.filter((s) => s.hamming >= bestNormal - 2),
    ...invertedScores.filter((s) => s.hamming >= bestInvertedH - 2),
  ];

  // Second pass: per-pixel voting for foreground color, then rank by total error
  let bestTotalError = Infinity;
  let bestCharIndex = 0;
  let bestFgColorIndex = 0;
  let bestInverted = false;

  // Build list of available palette indices
  const availableColors: number[] = [];
  for (let fi = 0; fi < palette.length; fi++) {
    if (!excludedColors.has(fi)) availableColors.push(fi);
  }

  for (const cand of candidates) {
    const bitmap = charset[cand.ci];
    const inverted = cand.inverted;

    // Per-pixel vote: for each fg pixel, find nearest palette color
    const votes = new Int32Array(palette.length);
    let bgError = 0;

    for (let i = 0; i < 64; i++) {
      const isFg = inverted ? !bitmap[i] : bitmap[i];
      const r = rr[i], g = gg[i], b = bb[i];

      if (isFg) {
        let bestDist = Infinity;
        let bestIdx = 0;
        for (const fi of availableColors) {
          const fc = palette[fi];
          const dist =
            2 * (r - fc.r) * (r - fc.r) +
            4 * (g - fc.g) * (g - fc.g) +
            3 * (b - fc.b) * (b - fc.b);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = fi;
          }
        }
        votes[bestIdx]++;
      } else {
        bgError +=
          2 * (r - bgColor.r) * (r - bgColor.r) +
          4 * (g - bgColor.g) * (g - bgColor.g) +
          3 * (b - bgColor.b) * (b - bgColor.b);
      }
    }

    // Foreground color = majority vote
    let votedFg = availableColors[0] ?? 0;
    let maxVotes = 0;
    for (const fi of availableColors) {
      if (votes[fi] > maxVotes) {
        maxVotes = votes[fi];
        votedFg = fi;
      }
    }

    // Compute fg error using the voted color for ranking
    const fc = palette[votedFg];
    let fgError = 0;
    for (let i = 0; i < 64; i++) {
      const isFg = inverted ? !bitmap[i] : bitmap[i];
      if (isFg) {
        fgError +=
          2 * (rr[i] - fc.r) * (rr[i] - fc.r) +
          4 * (gg[i] - fc.g) * (gg[i] - fc.g) +
          3 * (bb[i] - fc.b) * (bb[i] - fc.b);
      }
    }

    const total = bgError + fgError;
    if (total < bestTotalError) {
      bestTotalError = total;
      bestCharIndex = cand.ci;
      bestFgColorIndex = votedFg;
      bestInverted = inverted;
    }
  }

  return {
    charIndex: bestCharIndex,
    fgColorIndex: bestFgColorIndex,
    inverted: bestInverted,
  };
}
