type Part = readonly [sx: number, sy: number, w: number, h: number, dx: number, dy: number];

export type FigureSide = 'front' | 'back';
export type Sheet = HTMLImageElement | HTMLCanvasElement;

export const FIGURE_SIZE = { width: 16, height: 32 } as const;
export const CAPE_SIZE = { width: 10, height: 16 } as const;
export const FACE_SIZE = 8;

const SKIN_SIZE = 64;
const CAPE_SHEET_WIDTH = 64;
const BASE_LAYER: readonly (readonly [x: number, y: number, w: number, h: number])[] = [
  [0, 0, 32, 16],
  [0, 16, 56, 16],
  [16, 48, 32, 16],
];

function frontParts(arm: number): Part[] {
  return [
    [8, 8, 8, 8, 4, 0],
    [20, 20, 8, 12, 4, 8],
    [44, 20, arm, 12, 4 - arm, 8],
    [36, 52, arm, 12, 12, 8],
    [4, 20, 4, 12, 4, 20],
    [20, 52, 4, 12, 8, 20],
    [40, 8, 8, 8, 4, 0],
    [20, 36, 8, 12, 4, 8],
    [44, 36, arm, 12, 4 - arm, 8],
    [52, 52, arm, 12, 12, 8],
    [4, 36, 4, 12, 4, 20],
    [4, 52, 4, 12, 8, 20],
  ];
}

function backParts(arm: number): Part[] {
  return [
    [24, 8, 8, 8, 4, 0],
    [32, 20, 8, 12, 4, 8],
    [40 + arm, 52, arm, 12, 4 - arm, 8],
    [48 + arm, 20, arm, 12, 12, 8],
    [28, 52, 4, 12, 4, 20],
    [12, 20, 4, 12, 8, 20],
    [56, 8, 8, 8, 4, 0],
    [32, 36, 8, 12, 4, 8],
    [56 + arm, 52, arm, 12, 4 - arm, 8],
    [48 + arm, 36, arm, 12, 12, 8],
    [12, 52, 4, 12, 4, 20],
    [12, 36, 4, 12, 8, 20],
  ];
}

function context(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return null;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function drawCapeOn(ctx: CanvasRenderingContext2D, cape: Sheet, dx: number, dy: number): void {
  const scale = cape.width / CAPE_SHEET_WIDTH;
  const { width, height } = CAPE_SIZE;
  ctx.drawImage(cape, scale, scale, width * scale, height * scale, dx, dy, width, height);
}

export function drawFigure(
  canvas: HTMLCanvasElement,
  sheet: Sheet,
  slim: boolean,
  side: FigureSide = 'front',
  cape: Sheet | null = null,
): void {
  const ctx = context(canvas, FIGURE_SIZE.width, FIGURE_SIZE.height);
  if (ctx === null) {
    return;
  }
  const arm = slim ? 3 : 4;
  for (const [sx, sy, w, h, dx, dy] of side === 'back' ? backParts(arm) : frontParts(arm)) {
    ctx.drawImage(sheet, sx, sy, w, h, dx, dy, w, h);
  }
  if (side === 'back' && cape !== null) {
    drawCapeOn(ctx, cape, 3, 8);
  }
}

export function drawFace(canvas: HTMLCanvasElement, sheet: Sheet): void {
  const ctx = context(canvas, FACE_SIZE, FACE_SIZE);
  if (ctx === null) {
    return;
  }
  ctx.drawImage(sheet, 8, 8, FACE_SIZE, FACE_SIZE, 0, 0, FACE_SIZE, FACE_SIZE);
  ctx.drawImage(sheet, 40, 8, FACE_SIZE, FACE_SIZE, 0, 0, FACE_SIZE, FACE_SIZE);
}

export function drawCape(canvas: HTMLCanvasElement, sheet: Sheet): void {
  const ctx = context(canvas, CAPE_SIZE.width, CAPE_SIZE.height);
  if (ctx !== null) {
    drawCapeOn(ctx, sheet, 0, 0);
  }
}

const textures = new Map<string, Promise<HTMLImageElement | null>>();
const loaded = new Map<string, HTMLImageElement>();

export function loadedTexture(url: string): HTMLImageElement | null {
  return loaded.get(url) ?? null;
}

function fetchTexture(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = (): void => {
      loaded.set(url, image);
      resolve(image);
    };
    image.onerror = (): void => {
      textures.delete(url);
      resolve(null);
    };
    image.src = url;
  });
}

export function loadTexture(url: string): Promise<HTMLImageElement | null> {
  const known = textures.get(url);
  if (known !== undefined) {
    return known;
  }
  const loading = fetchTexture(url);
  textures.set(url, loading);
  return loading;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let plain: HTMLCanvasElement | null = null;

// What the figure wears while a texture is loading or could not be loaded.
export function plainSkin(): HTMLCanvasElement {
  if (plain !== null) {
    return plain;
  }
  const canvas = document.createElement('canvas');
  const ctx = context(canvas, SKIN_SIZE, SKIN_SIZE);
  if (ctx !== null) {
    ctx.fillStyle = token('--mc-text-dim');
    for (const [x, y, w, h] of BASE_LAYER) {
      ctx.fillRect(x, y, w, h);
    }
  }
  plain = canvas;
  return canvas;
}
