import { readdirSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import type { BehaviorGenome } from '../../shared/src/index.ts';
import { validateGenome, clampGenome } from '../ai/BehaviorGenome.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENOMES_DIR = resolve(__dirname, '../../configs/genomes');

export interface GenomeEntry {
  id: string;         // filename without .json
  label: string;      // display name
  emoji: string;      // display emoji (from genome file)
  archetype: string;  // archetype name (warrior, scout, etc.)
  description: string;// short description
  stats: Record<string, number>; // base stats for this archetype
  genome: BehaviorGenome;
  rules: number;      // strategy rule count
  mutations: number;  // version - 1
}

let library: GenomeEntry[] = [];

export function loadGenomeLibrary(): GenomeEntry[] {
  library = [];

  if (!existsSync(GENOMES_DIR)) {
    console.log('No genomes/ directory — custom genomes disabled');
    return library;
  }

  const files = readdirSync(GENOMES_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const raw = readFileSync(resolve(GENOMES_DIR, file), 'utf-8');
      const genome = JSON.parse(raw) as BehaviorGenome;

      // Validate and clamp to safety bounds
      const validation = validateGenome(genome);
      if (!validation.valid) {
        console.warn(`Genome ${file}: validation warnings:`, validation.errors.slice(0, 3));
        clampGenome(genome);
      }

      const id = basename(file, '.json');
      const raw2 = JSON.parse(raw); // re-parse for extra fields
      const emoji = raw2.emoji ?? '🎲';
      const archetype = raw2.archetype ?? id;
      const description = raw2.description ?? '';
      const stats = raw2.stats ?? {};
      const label = raw2.emoji ? `${raw2.emoji} ${archetype.charAt(0).toUpperCase() + archetype.slice(1)}` :
        id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      library.push({
        id,
        label,
        emoji,
        archetype,
        description,
        stats,
        genome,
        rules: genome.strategyRules?.length ?? 0,
        mutations: (genome.version ?? 1) - 1,
      });

      console.log(`Loaded genome: ${label} (v${genome.version}, ${genome.strategyRules?.length ?? 0} rules)`);
    } catch (err) {
      console.error(`Failed to load genome ${file}:`, err);
    }
  }

  console.log(`Genome library: ${library.length} custom genomes loaded`);
  return library;
}

export function getGenomeLibrary(): GenomeEntry[] {
  return library;
}

export function getGenomeById(id: string): BehaviorGenome | null {
  const entry = library.find(e => e.id === id);
  return entry ? structuredClone(entry.genome) : null;
}

// ─── Species Genomes (for animals) ───

const SPECIES_GENOMES_DIR = resolve(GENOMES_DIR, 'species');
let speciesGenomes: Record<string, BehaviorGenome> = {};

export function loadSpeciesGenomes(): void {
  speciesGenomes = {};
  if (!existsSync(SPECIES_GENOMES_DIR)) {
    console.log('No species genomes directory — using code-generated defaults');
    return;
  }
  const files = readdirSync(SPECIES_GENOMES_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const raw = readFileSync(resolve(SPECIES_GENOMES_DIR, file), 'utf-8');
      const genome = JSON.parse(raw) as BehaviorGenome;
      clampGenome(genome);
      const id = basename(file, '.json');
      speciesGenomes[id] = genome;
    } catch (err) {
      console.error(`Failed to load species genome ${file}:`, err);
    }
  }
  console.log(`Species genomes: ${Object.keys(speciesGenomes).length} loaded`);
}

/** Get species genome template. Falls back to code-generated if no JSON. */
export function getSpeciesGenome(speciesId: string): BehaviorGenome | null {
  // Normalize ID: 'cow-0' → 'cow', 'dog-0' → 'dog'
  const normalized = speciesId.replace(/-\d+$/, '');
  const genome = speciesGenomes[normalized] ?? speciesGenomes[speciesId];
  return genome ? structuredClone(genome) : null;
}

/** Returns list safe for client (no full genome data) */
export function getPublicGenomeList(): { id: string; label: string; emoji: string; archetype: string; description: string; stats: Record<string, number>; rules: number; mutations: number }[] {
  return library.map(e => ({ id: e.id, label: e.label, emoji: e.emoji, archetype: e.archetype, description: e.description, stats: e.stats, rules: e.rules, mutations: e.mutations }));
}
