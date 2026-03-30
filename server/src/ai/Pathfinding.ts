import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/src/index.ts';
import { World } from '../World.ts';

interface Node {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: Node | null;
}

export function findPath(
  world: World,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  maxIterations: number = 500,
  excludeTiles?: number[]
): { x: number; y: number }[] {
  if (startX === endX && startY === endY) return [];

  // If target not walkable, find nearest walkable adjacent tile
  let targetX = endX;
  let targetY = endY;
  if (!world.isWalkable(endX, endY)) {
    const adj = world.findNearestWalkable(startX, startY, endX, endY);
    targetX = adj.x;
    targetY = adj.y;
  }

  const open: Node[] = [];
  const closed = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;

  const heuristic = (x: number, y: number) =>
    Math.abs(x - targetX) + Math.abs(y - targetY);

  const startNode: Node = {
    x: startX, y: startY,
    g: 0, h: heuristic(startX, startY), f: heuristic(startX, startY),
    parent: null,
  };
  open.push(startNode);

  const dirs = [
    { dx: 0, dy: -1 }, { dx: 1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
  ];

  let iterations = 0;
  while (open.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find lowest f score
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];

    if (current.x === targetX && current.y === targetY) {
      // Reconstruct path
      const path: { x: number; y: number }[] = [];
      let node: Node | null = current;
      while (node && !(node.x === startX && node.y === startY)) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      return path;
    }

    closed.add(key(current.x, current.y));

    for (const { dx, dy } of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;

      if (nx < 0 || nx >= WORLD_WIDTH || ny < 0 || ny >= WORLD_HEIGHT) continue;
      if (closed.has(key(nx, ny))) continue;
      if (!world.isWalkable(nx, ny)) continue;
      if (excludeTiles && excludeTiles.includes(world.getTile(nx, ny))) continue;

      const g = current.g + 1;
      const h = heuristic(nx, ny);
      const f = g + h;

      // Check if already in open with better g
      const existing = open.find(n => n.x === nx && n.y === ny);
      if (existing && existing.g <= g) continue;

      if (existing) {
        existing.g = g;
        existing.f = f;
        existing.parent = current;
      } else {
        open.push({ x: nx, y: ny, g, h, f, parent: current });
      }
    }
  }

  // No path found - return partial path towards target
  return [];
}
