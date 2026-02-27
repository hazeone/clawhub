/**
 * Builds the registry.json for ClawX Financial Skills.
 *
 * Scans skills/ directory, parses SKILL.md frontmatter, and generates
 * a single registry.json that ClawX uses for bundled skill discovery.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';

const SKILLS_DIR = join(import.meta.dirname ?? '.', '..', 'skills');
const BUNDLES_DIR = join(SKILLS_DIR, 'bundles');
const OUTPUT_PATH = join(SKILLS_DIR, 'registry.json');

interface SkillEntry {
  slug: string;
  version: string;
  layer: string;
  run_mode: string;
  markets: string[];
  assets: string[];
  roles: string[];
  quality_level: string;
  display_name_zh: string;
  display_name_en: string;
  description: string;
  sha256: string;
  cron_schedule?: string;
  timeout?: number;
  depends_on_skills?: string[];
}

interface BundleEntry {
  id: string;
  name_zh: string;
  name_en: string;
  description_zh: string;
  description_en?: string;
  icon: string;
  skills: string[];
  recommended: boolean;
}

function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function extractField(text: string, field: string): string | null {
  const re = new RegExp(`^\\s*${field}:\\s*(.+)$`, 'm');
  const m = text.match(re);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

function extractArray(text: string, field: string): string[] {
  const re = new RegExp(`${field}:\\s*\\[([^\\]]+)\\]`);
  const m = text.match(re);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function extractMultilineDescription(text: string): string {
  const match = text.match(/description:\s*\|\s*\n([\s\S]*?)(?=\n\w|\n---)/);
  if (match) {
    return match[1].split('\n').map(l => l.trim()).filter(Boolean).join(' ');
  }
  return extractField(text, 'description') ?? '';
}

function parseSkill(skillDir: string): SkillEntry | null {
  const slug = basename(skillDir);
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath)) return null;

  const content = readFileSync(skillMdPath, 'utf-8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];

  const skillDeps = extractArray(fm, 'skills');

  return {
    slug,
    version: extractField(fm, 'version') ?? '0.0.0',
    layer: extractField(fm, 'layer') ?? 'unknown',
    run_mode: extractField(fm, 'run_mode') ?? 'oneshot',
    markets: extractArray(fm, 'markets'),
    assets: extractArray(fm, 'assets'),
    roles: extractArray(fm, 'roles'),
    quality_level: 'verified',
    display_name_zh: extractField(fm, 'display_name_zh') ?? slug,
    display_name_en: extractField(fm, 'display_name_en') ?? slug,
    description: extractMultilineDescription(fm),
    sha256: computeSha256(content),
    cron_schedule: extractField(fm, 'cron_schedule') ?? undefined,
    timeout: Number(extractField(fm, 'timeout')) || undefined,
    depends_on_skills: skillDeps.length > 0 ? skillDeps : undefined,
  };
}

function parseBundles(): BundleEntry[] {
  if (!existsSync(BUNDLES_DIR)) return [];

  return readdirSync(BUNDLES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const data = JSON.parse(readFileSync(join(BUNDLES_DIR, f), 'utf-8'));
      return {
        id: data.id,
        name_zh: data.name_zh,
        name_en: data.name_en ?? '',
        description_zh: data.description_zh ?? '',
        description_en: data.description_en,
        icon: data.icon ?? 'package',
        skills: data.skills ?? [],
        recommended: data.recommended ?? false,
      };
    });
}

function main() {
  console.log('Building ClawX Financial Skills registry...\n');

  const skills: SkillEntry[] = [];

  const layerDirs = readdirSync(SKILLS_DIR).filter(d => {
    const p = join(SKILLS_DIR, d);
    return statSync(p).isDirectory() && !['bundles', 'pipelines'].includes(d);
  });

  for (const layerDir of layerDirs) {
    const layerPath = join(SKILLS_DIR, layerDir);
    const skillDirs = readdirSync(layerPath).filter(d =>
      statSync(join(layerPath, d)).isDirectory()
    );

    for (const skillDir of skillDirs) {
      const entry = parseSkill(join(layerPath, skillDir));
      if (entry) {
        skills.push(entry);
      }
    }
  }

  skills.sort((a, b) => a.slug.localeCompare(b.slug));

  const bundles = parseBundles();

  const registry = {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    skills_count: skills.length,
    skills,
    bundles,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2) + '\n');

  console.log(`Generated registry with ${skills.length} skills and ${bundles.length} bundles`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main();
