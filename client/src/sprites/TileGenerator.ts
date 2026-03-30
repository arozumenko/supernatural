/**
 * Tile texture generator with proper Tiled corner-based autotile rendering.
 *
 * Uses the Pipoya RPG Tileset 32x32 pre-composed autotile sheets (8×6 = 48 tiles
 * per terrain variant). Each tile's 4 corners are classified as "terrain" or "not
 * terrain" based on the 8 surrounding tiles, then mapped to the correct frame in
 * the autotile spritesheet.
 *
 * Corner layout: TL, TR, BL, BR — each 1 (terrain present) or 0 (not present).
 * A corner is "present" when ALL tiles sharing that corner vertex are the same
 * ground type as the current tile.
 */
import Phaser from 'phaser';
import { TileType } from '@supernatural/shared';

const S = 32;

// ─── Corner → autotile frame mapping ───
// Decoded from the Tiled TSX terrain definitions.
// Key = "TL,TR,BL,BR" where 1=terrain present, 0=not present.
// Value = frame index in the 8-col × 6-row spritesheet.
const CORNER_TO_FRAME: Record<string, number> = {
  '0,0,0,1': 5,   // outer corner: tiny terrain at BR
  '0,0,1,1': 6,   // north edge: terrain along bottom
  '0,0,1,0': 7,   // outer corner: tiny terrain at BL
  '0,1,0,1': 13,  // west edge: terrain along right
  '1,1,1,1': 14,  // center fill: full terrain
  '1,0,1,0': 15,  // east edge: terrain along left
  '0,1,0,0': 21,  // outer corner: tiny terrain at TR
  '1,1,0,0': 22,  // south edge: terrain along top
  '1,0,0,0': 23,  // outer corner: tiny terrain at TL
  '1,1,1,0': 28,  // inner corner: notch at BR
  '1,1,0,1': 29,  // inner corner: notch at BL
  '1,0,1,1': 36,  // inner corner: notch at TR
  '0,1,1,1': 37,  // inner corner: notch at TL
  // Diagonal cases (rare): fallback to center fill
  '0,1,1,0': 14,
  '1,0,0,1': 14,
  '0,0,0,0': -1,  // no terrain at all
};

// ─── Terrain classification ───

function groundType(t: number): number {
  if (t === TileType.TREE || t === TileType.TREE_STUMP ||
      t === TileType.BERRY_BUSH ||
      t === TileType.CAMPFIRE || t === TileType.WORKBENCH ||
      t === TileType.FORGE ||
      t === TileType.STORAGE || t === TileType.TENT ||
      t === TileType.BEDROLL || t === TileType.ANIMAL_PEN ||
      t === TileType.BONE_FENCE) return TileType.GRASS;
  if (t === TileType.IRON_ORE) return TileType.DIRT;
  return t;
}

function isGrassLike(t: number): boolean {
  return groundType(t) === TileType.GRASS;
}

function isWaterLike(t: number): boolean {
  return groundType(t) === TileType.WATER;
}

function isDirtLike(t: number): boolean {
  return groundType(t) === TileType.DIRT;
}

function isSandLike(t: number): boolean {
  return groundType(t) === TileType.SAND;
}

function isFloorLike(t: number): boolean {
  return t === TileType.BUILT_FLOOR;
}

// ─── Texture cache ───
const textureCache = new Set<string>();

// ─── Main API ───

export function generateTileTextures(scene: Phaser.Scene): void {
  textureCache.clear();

  // Generate masked autotile for built floor (no Pipoya original exists).
  // Uses dirt autotile shape (which has smooth hand-drawn edges) filled with the floor texture.
  generateMaskedAutotile(scene, 'at_floor', 'at_dirt', 'ts_floor');

  // Object tiles (composited on grass center fill)
  createTreeStump(scene);
  createStone(scene);
  createBerryBush(scene);
  createBuiltWall(scene);
  createCampfire(scene);
  createWorkbench(scene);
  createIronOre(scene);
  createPlaceholderTiles(scene);
}

/**
 * Generate a terrain autotile sheet by using an existing autotile's alpha shape
 * and filling it with a different texture. This lets us reuse the smooth
 * hand-drawn transition edges from the Pipoya autotile sheets.
 *
 * @param maskKey - Spritesheet to use as shape/alpha mask (e.g., 'at_dirt')
 * @param fillKey - Image to use as the fill texture (e.g., 'ts_floor')
 */
function generateMaskedAutotile(
  scene: Phaser.Scene, outputKey: string,
  maskKey: string, fillKey: string
): void {
  const maskSheet = scene.textures.get(maskKey).getSourceImage() as HTMLImageElement;
  const fillImg = scene.textures.get(fillKey).getSourceImage() as HTMLImageElement;
  const cols = 8, rows = 6;
  const canvas = document.createElement('canvas');
  canvas.width = cols * S;
  canvas.height = rows * S;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * S;
      const y = row * S;

      const tmp = document.createElement('canvas');
      tmp.width = S; tmp.height = S;
      const tctx = tmp.getContext('2d')!;
      tctx.imageSmoothingEnabled = false;

      // Step 1: Draw the mask autotile frame — defines the shape with smooth alpha edges
      tctx.drawImage(maskSheet, x, y, S, S, 0, 0, S, S);

      // Step 2: Replace the mask's color with the fill texture
      // 'source-in' keeps only the fill where the mask was opaque
      tctx.globalCompositeOperation = 'source-in';
      tctx.drawImage(fillImg, 0, 0, S, S, 0, 0, S, S);
      tctx.globalCompositeOperation = 'source-over';

      ctx.drawImage(tmp, 0, 0, S, S, x, y, S, S);
    }
  }

  scene.textures.addSpriteSheet(outputKey, canvas, { frameWidth: S, frameHeight: S });
}

/**
 * Get the texture key for tile at (x,y) with proper autotile transitions.
 * Creates the texture on first use, caches by corner pattern.
 *
 * Computes corners for 4 terrain layers: dirt, sand, grass, water.
 * Each layer's autotile is drawn in order (bottom to top) to produce
 * natural transitions between all terrain types.
 */
export function getBlendedTextureKey(scene: Phaser.Scene, tiles: number[][], x: number, y: number): string {
  const t = tiles[y][x];
  const gt = groundType(t);

  // Object tiles use their pre-built texture (except BUILT_FLOOR which gets autotile transitions)
  if (gt !== t) return `tile_${t}`;
  if (t === TileType.BUILT_WALL) return `tile_${TileType.BUILT_WALL}`;
  if (t === TileType.STONE_WALL) return `tile_${TileType.STONE_WALL}`;
  if (t === TileType.IRON_WALL) return `tile_${TileType.IRON_WALL}`;
  if (t === TileType.WOOD_DOOR) return `tile_${TileType.WOOD_DOOR}`;

  const h = tiles.length, w = tiles[0].length;

  // Helper: get ground type at position (clamped to edges)
  const g = (px: number, py: number) => {
    if (px < 0 || px >= w || py < 0 || py >= h) return gt;
    return groundType(tiles[py][px]);
  };

  // Compute corners for each terrain type.
  // A vertex has terrain X if ALL 4 tiles sharing that vertex are X-like.
  const cornerCalc = (check: (t: number) => boolean) => {
    const c = (px: number, py: number) => check(g(px, py));
    const tl = c(x,y) && c(x-1,y) && c(x,y-1) && c(x-1,y-1) ? 1 : 0;
    const tr = c(x,y) && c(x+1,y) && c(x,y-1) && c(x+1,y-1) ? 1 : 0;
    const bl = c(x,y) && c(x-1,y) && c(x,y+1) && c(x-1,y+1) ? 1 : 0;
    const br = c(x,y) && c(x+1,y) && c(x,y+1) && c(x+1,y+1) ? 1 : 0;
    return `${tl},${tr},${bl},${br}`;
  };

  const dirtCorners = cornerCalc(isDirtLike);
  const sandCorners = cornerCalc(isSandLike);
  const waterCorners = cornerCalc(isWaterLike);
  const floorCorners = cornerCalc(isFloorLike);

  const key = `at_${gt}_d${dirtCorners}_s${sandCorners}_w${waterCorners}_f${floorCorners}`;

  if (!textureCache.has(key) && !scene.textures.exists(key)) {
    createAutotileTile(scene, key, gt, dirtCorners, sandCorners, waterCorners, floorCorners);
    textureCache.add(key);
  }
  return key;
}

// ─── Autotile tile compositor ───

function createAutotileTile(
  scene: Phaser.Scene, key: string, type: number,
  dirtCorners: string, sandCorners: string, waterCorners: string, floorCorners: string
): void {
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // Step 1: GRASS everywhere as the base (the entire map is grass first)
  drawAutotileFrame(scene, ctx, 'at_grass', 14); // frame 14 = center fill

  // Step 2: Dirt overlay (original Pipoya autotile with hand-drawn gradient transitions)
  const dirtFrame = CORNER_TO_FRAME[dirtCorners];
  if (dirtFrame !== undefined && dirtFrame >= 0) {
    drawAutotileFrame(scene, ctx, 'at_dirt', dirtFrame);
  }

  // Step 3: Sand overlay (original Pipoya autotile with hand-drawn gradient transitions)
  const sandFrame = CORNER_TO_FRAME[sandCorners];
  if (sandFrame !== undefined && sandFrame >= 0) {
    drawAutotileFrame(scene, ctx, 'at_sand', sandFrame);
  }

  // Step 4: Built floor overlay (masked autotile — floor texture in grass shape)
  const floorFrame = CORNER_TO_FRAME[floorCorners];
  if (floorFrame !== undefined && floorFrame >= 0) {
    drawAutotileFrame(scene, ctx, 'at_floor', floorFrame);
  }

  // Step 5: Water overlay (water + sand shore + grass edge, on top of everything)
  const waterFrame = CORNER_TO_FRAME[waterCorners];
  if (waterFrame !== undefined && waterFrame >= 0) {
    drawAutotileFrame(scene, ctx, 'at_water', waterFrame);
  }

  scene.textures.addCanvas(key, canvas);
}

function drawProceduralWater(ctx: CanvasRenderingContext2D): void {
  const rand = seededRandom(77);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const noise = rand() * 0.12;
      const wave = Math.sin(x * 0.25 + y * 0.15) * 0.04 + Math.sin(x * 0.1 - y * 0.2) * 0.03;
      const val = 0.5 + noise + wave;
      ctx.fillStyle = `rgb(${Math.floor(25 + val * 20)},${Math.floor(75 + val * 40)},${Math.floor(135 + val * 50)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let i = 0; i < 6; i++) {
    const wy = 2 + Math.floor(rand() * (S - 4));
    const phase = rand() * Math.PI * 2;
    for (let x = 0; x < S; x++) {
      const waveY = Math.round(wy + Math.sin(x * 0.35 + phase) * 1.2);
      if (waveY >= 0 && waveY < S) { ctx.fillStyle = 'rgba(130,200,230,0.3)'; ctx.fillRect(x, waveY, 1, 1); }
    }
  }
}

function drawAutotileFrame(scene: Phaser.Scene, ctx: CanvasRenderingContext2D, sheetKey: string, frameIndex: number): void {
  const tex = scene.textures.get(sheetKey);
  const source = tex.getSourceImage() as HTMLImageElement;
  const cols = 8;
  const col = frameIndex % cols;
  const row = Math.floor(frameIndex / cols);
  ctx.drawImage(source, col * S, row * S, S, S, 0, 0, S, S);
}

// ─── Helpers ───

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1);
}
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
}
function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++)
    for (let dx = -rx; dx <= rx; dx++)
      if ((dx*dx)/(rx*rx) + (dy*dy)/(ry*ry) <= 1) ctx.fillRect(cx+dx, cy+dy, 1, 1);
}
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function createCanvas(scene: Phaser.Scene, key: string, draw: (ctx: CanvasRenderingContext2D) => void): void {
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  draw(ctx); scene.textures.addCanvas(key, c);
}

function createOnGrass(scene: Phaser.Scene, key: string, draw: (ctx: CanvasRenderingContext2D) => void): void {
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  // Grass center fill as base, then object on top
  drawAutotileFrame(scene, ctx, 'at_grass', 14); // frame 14 = center fill
  draw(ctx);
  scene.textures.addCanvas(key, c);
}

// ─── Object tile creators ───

function createTreeStump(scene: Phaser.Scene): void {
  // TREE tiles render as plain grass (visual tree is a separate sprite layer)
  // TREE_STUMP also renders as grass (stump visual is a separate sprite)
  // We still need a tile_${TileType.TREE} and tile_${TileType.TREE_STUMP} key
  // so the renderer doesn't error — just grass.
  createOnGrass(scene, `tile_${TileType.TREE}`, () => {});
  createOnGrass(scene, `tile_${TileType.TREE_STUMP}`, () => {});
}

function createStone(scene: Phaser.Scene): void {
  // Rocks are now entity sprites — no tile textures needed.
  // Keep fallback textures in case any old STONE tiles exist.
  createOnGrass(scene, `tile_${TileType.STONE}`, () => {});
  createOnGrass(scene, `tile_${TileType.ROCK_RUBBLE}`, () => {});
}

function createBerryBush(scene: Phaser.Scene): void {
  // Berry bushes are now entity sprites — keep a fallback grass tile
  createOnGrass(scene, `tile_${TileType.BERRY_BUSH}`, () => {});
}

function createBuiltWall(scene: Phaser.Scene): void {
  createCanvas(scene, `tile_${TileType.BUILT_WALL}`, (ctx) => {
    const rand = seededRandom(222);
    rect(ctx,0,0,S,S,'#5b4325');
    for (let py=0; py<S; py+=6) {
      rect(ctx,0,py,S,5, py%12===0?'#7b5f3f':'#6b4f2f');
      rect(ctx,0,py,S,1, py%12===0?'#8b6f4f':'#7b5f3f');
      rect(ctx,0,py+4,S,1,'#4b3315');
      for (let i=0;i<6;i++) px(ctx, Math.floor(rand()*S), py+1+Math.floor(rand()*3), py%12===0?'#8a6848':'#7a5838');
    }
    rect(ctx,0,0,2,S,'#4b3315'); rect(ctx,S-2,0,2,S,'#4b3315'); rect(ctx,0,0,S,1,'#8b7355');
  });
}

function createCampfire(scene: Phaser.Scene): void {
  createOnGrass(scene, `tile_${TileType.CAMPFIRE}`, (ctx) => {
    const rand = seededRandom(666);
    for (let dy=-10;dy<=10;dy++) for(let dx=-10;dx<=10;dx++) {
      const d=Math.sqrt(dx*dx+dy*dy); if(d<10&&d>5) { ctx.fillStyle=`rgba(255,140,40,${0.06*(1-d/10)})`; ctx.fillRect(16+dx,20+dy,1,1); }
    }
    for (const [sx,sy] of [[11,22],[14,24],[18,24],[21,22],[22,19],[21,16],[18,14],[14,14],[11,16],[10,19]])
      { rect(ctx,sx,sy,3,3,rand()>0.5?'#707070':'#606060'); px(ctx,sx,sy,'#888'); }
    rect(ctx,13,20,6,2,'#2a1a0a'); rect(ctx,12,19,2,4,'#2a1a0a'); rect(ctx,18,18,2,4,'#2a1a0a');
    for (const {y:fy,c} of [{y:20,c:['#cc3300','#aa2200']},{y:19,c:['#dd4400','#ff5500']},{y:18,c:['#ff6600','#ff7700']},{y:17,c:['#ff8800','#ffaa00']},{y:16,c:['#ffaa00','#ffcc00']},{y:15,c:['#ffcc00','#ffdd44']},{y:14,c:['#ffdd44']},{y:13,c:['#ffee88']}]) {
      const w=Math.max(1,4-Math.abs(fy-17));
      for(let dx=-w;dx<=w;dx++) if(rand()>0.12) px(ctx,16+dx,fy,c[Math.floor(rand()*c.length)]);
    }
  });
}

function createWorkbench(scene: Phaser.Scene): void {
  createOnGrass(scene, `tile_${TileType.WORKBENCH}`, (ctx) => {
    ellipse(ctx,16,28,10,3,'rgba(0,0,0,0.12)');
    rect(ctx,7,22,3,7,'#6b4a2a'); rect(ctx,22,22,3,7,'#6b4a2a');
    rect(ctx,10,25,12,1,'#5b3a1a');
    rect(ctx,5,14,22,8,'#a88060'); rect(ctx,5,14,22,2,'#b89070');
    rect(ctx,5,20,22,2,'#8a6a48'); rect(ctx,5,14,1,8,'#8a6a48'); rect(ctx,26,14,1,8,'#8a6a48');
    rect(ctx,5,18,22,1,'#96744e');
    rect(ctx,9,15,2,5,'#7a6040'); rect(ctx,7,15,6,2,'#8a8a8a'); px(ctx,7,15,'#a0a0a0');
    rect(ctx,18,15,1,5,'#6a5030'); rect(ctx,19,15,5,1,'#909090');
  });
}

function createIronOre(scene: Phaser.Scene): void {
  // Iron ore sits on dirt — draw dirt base then ore rock on top
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  // Dirt base from autotile center fill
  drawAutotileFrame(scene, ctx, 'at_dirt', 14);
  // Dark rock body
  const rand = seededRandom(999);
  ellipse(ctx, 16, 20, 9, 6, 'rgba(0,0,0,0.15)'); // shadow
  for (let dy = -5; dy <= 5; dy++) for (let dx = -7; dx <= 7; dx++) {
    const d = (dx*dx)/49 + (dy*dy)/25;
    if (d <= 1) {
      const n = rand();
      const r = Math.floor(70 + n * 25);
      const g = Math.floor(45 + n * 15);
      const b = Math.floor(40 + n * 12);
      px(ctx, 16+dx, 17+dy, `rgb(${r},${g},${b})`);
    }
  }
  // Reddish-orange ore streaks
  for (let i = 0; i < 8; i++) {
    const ox = 11 + Math.floor(rand() * 10);
    const oy = 13 + Math.floor(rand() * 8);
    ctx.fillStyle = rand() > 0.5 ? '#c06030' : '#b85525';
    ctx.fillRect(ox, oy, 2, 1);
  }
  // Metallic glint
  for (let i = 0; i < 3; i++) {
    const gx = 12 + Math.floor(rand() * 8);
    const gy = 14 + Math.floor(rand() * 5);
    px(ctx, gx, gy, '#e0c890');
  }
  scene.textures.addCanvas(`tile_${TileType.IRON_ORE}`, c);
}

function createPlaceholderTiles(scene: Phaser.Scene): void {
  // Forge
  createOnGrass(scene, `tile_${TileType.FORGE}`, (ctx) => {
    const rand = seededRandom(777);
    // Stone base
    rect(ctx, 6, 16, 20, 14, '#606060');
    rect(ctx, 6, 16, 20, 2, '#808080');
    rect(ctx, 6, 28, 20, 2, '#404040');
    // Fire glow
    for (let i = 0; i < 8; i++) {
      const fx = 10 + Math.floor(rand() * 12);
      const fy = 18 + Math.floor(rand() * 8);
      ctx.fillStyle = rand() > 0.5 ? '#ff6600' : '#ff9900';
      ctx.fillRect(fx, fy, 2, 2);
    }
  });

  // Stone Wall
  createCanvas(scene, `tile_${TileType.STONE_WALL}`, (ctx) => {
    const rand = seededRandom(333);
    rect(ctx, 0, 0, S, S, '#707070');
    for (let py = 0; py < S; py += 8) {
      const off = (py % 16 === 0) ? 0 : 8;
      for (let px2 = off; px2 < S; px2 += 16) {
        rect(ctx, px2, py, 15, 7, rand() > 0.5 ? '#808080' : '#686868');
        rect(ctx, px2, py, 15, 1, '#909090');
        rect(ctx, px2, py + 6, 15, 1, '#585858');
      }
    }
  });

  // Iron Wall
  createCanvas(scene, `tile_${TileType.IRON_WALL}`, (ctx) => {
    rect(ctx, 0, 0, S, S, '#606878');
    for (let py = 0; py < S; py += 8) {
      for (let px2 = 0; px2 < S; px2 += 16) {
        rect(ctx, px2, py, 15, 7, '#707888');
        rect(ctx, px2, py, 15, 1, '#888f98');
      }
    }
    // Rivets
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#a0a8b0';
      ctx.fillRect(4 + i * 8, 4, 2, 2);
      ctx.fillRect(4 + i * 8, 20, 2, 2);
    }
  });

  // Simple placeholder tiles
  createOnGrass(scene, `tile_${TileType.WOOD_DOOR}`, (ctx) => {
    rect(ctx, 8, 4, 16, 26, '#8b6914');
    rect(ctx, 8, 4, 16, 2, '#a07c20');
    rect(ctx, 8, 28, 16, 2, '#6b4f10');
    rect(ctx, 20, 16, 3, 3, '#c0a040');
  });

  createOnGrass(scene, `tile_${TileType.BONE_FENCE}`, (ctx) => {
    for (let i = 0; i < 4; i++) {
      rect(ctx, 4 + i * 7, 8, 3, 20, '#e8dcc8');
      rect(ctx, 4 + i * 7, 8, 3, 2, '#f0e8d8');
    }
    rect(ctx, 2, 14, 28, 3, '#d8ccb8');
  });

  createOnGrass(scene, `tile_${TileType.STORAGE}`, (ctx) => {
    rect(ctx, 6, 12, 20, 16, '#8b6914');
    rect(ctx, 6, 12, 20, 3, '#a07c20');
    rect(ctx, 6, 25, 20, 3, '#6b4f10');
    rect(ctx, 8, 18, 16, 2, '#604010');
  });

  createOnGrass(scene, `tile_${TileType.TENT}`, (ctx) => {
    // Triangular tent shape
    ctx.fillStyle = '#a08060';
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(4, 28);
    ctx.lineTo(28, 28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#806040';
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(16, 28);
    ctx.lineTo(28, 28);
    ctx.closePath();
    ctx.fill();
  });

  createOnGrass(scene, `tile_${TileType.BEDROLL}`, (ctx) => {
    rect(ctx, 6, 10, 20, 16, '#705030');
    rect(ctx, 8, 12, 16, 12, '#906848');
    rect(ctx, 8, 12, 16, 4, '#a08060');
  });

  createOnGrass(scene, `tile_${TileType.ANIMAL_PEN}`, (ctx) => {
    // Fence outline
    rect(ctx, 2, 2, 28, 3, '#6b4a2a');
    rect(ctx, 2, 27, 28, 3, '#6b4a2a');
    rect(ctx, 2, 2, 3, 28, '#6b4a2a');
    rect(ctx, 27, 2, 3, 28, '#6b4a2a');
  });
}

// ─── Agent Sprites ───

export function generateAgentTextures(scene: Phaser.Scene): void {
  const skins = [
    {b:'#f5d0a9',s:'#dbb889',h:'#fce0bf'},{b:'#d4a574',s:'#b88a5c',h:'#e4b88a'},
    {b:'#8d5524',s:'#74441a',h:'#a06630'},{b:'#c68642',s:'#a87038',h:'#d89a56'},
    {b:'#f1c27d',s:'#d5a865',h:'#ffd494'},{b:'#e0ac69',s:'#c49455',h:'#f0c080'},
  ];
  const hairs = [
    {b:'#2c1608',s:'#1a0c04',h:'#3e2410'},{b:'#4a2c0a',s:'#361e04',h:'#5e3c14'},
    {b:'#8b6914',s:'#72560e',h:'#a47c20'},{b:'#c0392b',s:'#a02e22',h:'#d84838'},
    {b:'#f39c12',s:'#d4860e',h:'#ffb030'},{b:'#ddd8d0',s:'#c0bab0',h:'#f0ece8'},
  ];
  const shirts = [
    {b:'#3478b0',s:'#28608c',h:'#4890c8'},{b:'#c0443c',s:'#9c3430',h:'#d85850'},
    {b:'#2eaa5e',s:'#228e48',h:'#40c470'},{b:'#8858a6',s:'#6e4488',h:'#a070c0'},
    {b:'#d4882a',s:'#b07020',h:'#e8a040'},{b:'#1a9a8a',s:'#148070',h:'#28b8a4'},
    {b:'#c47020',s:'#a45c18',h:'#dc8830'},{b:'#7a8890',s:'#626e76',h:'#90a0a8'},
  ];

  for (let i = 0; i < 12; i++) {
    createCanvas(scene, `agent_${i}`, (ctx) => {
      const sk=skins[i%6], hr=hairs[Math.floor(i/2)%6], sh=shirts[i%8], long=i%3===0;
      ctx.fillStyle='rgba(0,0,0,0.18)';
      for(let dy=-2;dy<=2;dy++) for(let dx=-5;dx<=5;dx++)
        if((dx*dx)/25+(dy*dy)/4<=1) ctx.fillRect(16+dx,30+dy,1,1);
      rect(ctx,12,25,4,4,'#384868'); rect(ctx,17,25,4,4,'#384868');
      rect(ctx,12,25,4,1,'#404e70'); rect(ctx,17,25,4,1,'#404e70');
      px(ctx,16,26,'#2c3c58'); px(ctx,16,27,'#2c3c58');
      rect(ctx,11,29,5,2,'#3a2818'); rect(ctx,16,29,5,2,'#3a2818');
      rect(ctx,11,17,10,8,sh.b); rect(ctx,11,17,1,8,sh.s); rect(ctx,20,17,1,8,sh.s);
      rect(ctx,15,18,2,5,sh.h); rect(ctx,13,17,6,1,sh.s);
      rect(ctx,11,24,10,1,'#3a2a1a'); px(ctx,16,24,'#c8a840');
      rect(ctx,8,18,3,5,sh.b); rect(ctx,8,18,1,5,sh.s);
      rect(ctx,21,18,3,5,sh.b); rect(ctx,23,18,1,5,sh.s);
      rect(ctx,8,23,3,2,sk.b); rect(ctx,21,23,3,2,sk.b);
      rect(ctx,12,7,8,10,sk.b); rect(ctx,19,8,1,8,sk.s); rect(ctx,12,8,1,6,sk.h);
      rect(ctx,13,16,6,1,sk.s);
      rect(ctx,13,12,3,2,'#fff'); rect(ctx,17,12,3,2,'#fff');
      px(ctx,14,12,'#1a1a2a'); px(ctx,14,13,'#1a1a2a');
      px(ctx,18,12,'#1a1a2a'); px(ctx,18,13,'#1a1a2a');
      px(ctx,15,12,'#c8c8e0'); px(ctx,19,12,'#c8c8e0');
      px(ctx,16,14,sk.s);
      px(ctx,14,15,'#c0605a'); px(ctx,15,15,'#c0605a'); px(ctx,16,15,'#c0605a');
      rect(ctx,13,11,3,1,hr.b); rect(ctx,17,11,3,1,hr.b);
      rect(ctx,11,5,10,3,hr.b); rect(ctx,12,7,8,2,hr.b);
      rect(ctx,12,5,6,1,hr.h); rect(ctx,11,7,1,2,hr.s); rect(ctx,20,7,1,2,hr.s);
      if(long) { rect(ctx,10,7,2,10,hr.b); rect(ctx,20,7,2,10,hr.b); px(ctx,10,7,hr.h); px(ctx,21,7,hr.s); }
      px(ctx,11,11,sk.b); px(ctx,20,11,sk.b);
    });
  }

  createCanvas(scene, 'agent_dead', (ctx) => {
    ctx.clearRect(0,0,S,S);
    ellipse(ctx,16,28,8,3,'#5a7a4a'); ellipse(ctx,16,27,7,2,'#4a6a3a');
    rect(ctx,12,10,8,18,'#6a6a6a'); rect(ctx,13,8,6,2,'#6a6a6a'); rect(ctx,14,7,4,1,'#6a6a6a');
    rect(ctx,12,10,1,16,'#808080'); rect(ctx,19,10,1,16,'#555');
    rect(ctx,15,12,2,8,'#555'); rect(ctx,13,14,6,2,'#555');
    px(ctx,10,26,'#44aa44'); px(ctx,10,25,'#dd5555');
  });
}
