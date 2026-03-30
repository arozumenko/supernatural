import type { JsonPatch } from '../../shared/src/index.ts';

/**
 * Minimal RFC 6902 JSON Patch implementation.
 * Supports: add, remove, replace. Handles array index and `/path/-` append.
 * Mutates the target object in place.
 */
export function applyJsonPatches(target: any, patches: JsonPatch[]): void {
  for (const patch of patches) {
    const segments = parsePath(patch.path);
    if (segments.length === 0) {
      throw new Error(`Invalid path: ${patch.path}`);
    }

    const parent = navigateTo(target, segments.slice(0, -1), patch.path);
    const lastKey = segments[segments.length - 1];

    switch (patch.op) {
      case 'replace': {
        if (Array.isArray(parent)) {
          const idx = parseInt(lastKey, 10);
          if (isNaN(idx) || idx < 0 || idx >= parent.length) {
            throw new Error(`Invalid array index in path: ${patch.path}`);
          }
          parent[idx] = patch.value;
        } else {
          if (!(lastKey in parent)) {
            throw new Error(`Path does not exist for replace: ${patch.path}`);
          }
          parent[lastKey] = patch.value;
        }
        break;
      }

      case 'add': {
        if (Array.isArray(parent)) {
          if (lastKey === '-') {
            parent.push(patch.value);
          } else {
            const idx = parseInt(lastKey, 10);
            if (isNaN(idx)) throw new Error(`Invalid array index: ${lastKey}`);
            parent.splice(idx, 0, patch.value);
          }
        } else {
          parent[lastKey] = patch.value;
        }
        break;
      }

      case 'remove': {
        if (Array.isArray(parent)) {
          const idx = parseInt(lastKey, 10);
          if (isNaN(idx) || idx < 0 || idx >= parent.length) {
            throw new Error(`Invalid array index for remove: ${patch.path}`);
          }
          parent.splice(idx, 1);
        } else {
          delete parent[lastKey];
        }
        break;
      }

      default:
        throw new Error(`Unsupported patch op: ${(patch as any).op}`);
    }
  }
}

function parsePath(path: string): string[] {
  if (!path.startsWith('/')) {
    throw new Error(`Path must start with /: ${path}`);
  }
  return path.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function navigateTo(obj: any, segments: string[], fullPath: string): any {
  let current = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      throw new Error(`Cannot navigate path: ${fullPath}`);
    }
    if (Array.isArray(current)) {
      const idx = parseInt(seg, 10);
      if (isNaN(idx)) throw new Error(`Expected array index at ${seg} in ${fullPath}`);
      current = current[idx];
    } else {
      current = current[seg];
    }
  }
  return current;
}
