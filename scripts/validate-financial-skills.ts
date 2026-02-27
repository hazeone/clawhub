/**
 * Validates all financial skills in the skills/ directory.
 *
 * Checks:
 * - SKILL.md exists in every skill directory
 * - YAML frontmatter is valid and contains required fields
 * - clawx-finance metadata is well-formed
 * - Slugs match directory names
 * - Versions are valid semver
 * - Bundle references point to existing skills
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';

const SKILLS_DIR = join(import.meta.dirname ?? '.', '..', 'skills');
const BUNDLES_DIR = join(SKILLS_DIR, 'bundles');

const VALID_LAYERS = ['data', 'tool', 'indicator', 'backtest', 'model', 'monitor', 'report', 'compliance'] as const;
const VALID_RUN_MODES = ['oneshot', 'daemon', 'cron'] as const;
const VALID_MARKETS = ['cn-a', 'hk', 'us', 'crypto', 'jp', 'kr', '*'] as const;
const VALID_ASSETS = ['equity', 'bond', 'fund', 'derivative', 'commodity', 'fx', 'crypto', 'reit', 'multi', '*'] as const;
const VALID_ROLES = ['pm', 'researcher', 'trader', 'risk', 'compliance', 'analyst', 'sales', 'ib'] as const;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

interface ValidationError {
  skill: string;
  field: string;
  message: string;
}

const errors: ValidationError[] = [];
const allSlugs = new Set<string>();

function addError(skill: string, field: string, message: string) {
  errors.push({ skill, field, message });
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yamlText = match[1];
  const result: Record<string, unknown> = {};

  let currentKey = '';
  let currentValue = '';
  let inMultiline = false;
  let indent = 0;

  for (const line of yamlText.split('\n')) {
    const simpleMatch = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (simpleMatch && !inMultiline) {
      if (currentKey) result[currentKey] = currentValue.trim();
      currentKey = simpleMatch[1];
      currentValue = simpleMatch[2];
      continue;
    }

    const blockStart = line.match(/^(\w[\w-]*)\s*:\s*\|?\s*$/);
    if (blockStart) {
      if (currentKey) result[currentKey] = currentValue.trim();
      currentKey = blockStart[1];
      currentValue = '';
      inMultiline = true;
      indent = 2;
      continue;
    }

    if (inMultiline && line.startsWith(' '.repeat(indent))) {
      currentValue += line.trim() + '\n';
    }
  }
  if (currentKey) result[currentKey] = currentValue.trim();

  return result;
}

function validateSkill(skillDir: string, layerDir: string) {
  const slug = basename(skillDir);
  const skillMdPath = join(skillDir, 'SKILL.md');

  if (!existsSync(skillMdPath)) {
    addError(slug, 'SKILL.md', 'Missing SKILL.md file');
    return;
  }

  allSlugs.add(slug);

  const content = readFileSync(skillMdPath, 'utf-8');

  if (!content.startsWith('---')) {
    addError(slug, 'frontmatter', 'Missing YAML frontmatter');
    return;
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    addError(slug, 'frontmatter', 'Invalid YAML frontmatter format');
    return;
  }

  const fmText = fmMatch[1];

  const nameMatch = fmText.match(/^name:\s*(.+)$/m);
  if (!nameMatch) {
    addError(slug, 'name', 'Missing "name" field in frontmatter');
  } else if (nameMatch[1].trim() !== slug) {
    addError(slug, 'name', `Name "${nameMatch[1].trim()}" does not match directory name "${slug}"`);
  }

  const descMatch = fmText.match(/^description:/m);
  if (!descMatch) {
    addError(slug, 'description', 'Missing "description" field');
  }

  const versionMatch = fmText.match(/^version:\s*(.+)$/m);
  if (!versionMatch) {
    addError(slug, 'version', 'Missing "version" field');
  } else if (!SEMVER_RE.test(versionMatch[1].trim())) {
    addError(slug, 'version', `Invalid semver: "${versionMatch[1].trim()}"`);
  }

  if (!fmText.includes('clawx-finance:')) {
    addError(slug, 'metadata.clawx-finance', 'Missing clawx-finance metadata block');
    return;
  }

  const layerMatch = fmText.match(/layer:\s*(\w+)/);
  if (!layerMatch) {
    addError(slug, 'layer', 'Missing "layer" in clawx-finance metadata');
  } else if (!(VALID_LAYERS as readonly string[]).includes(layerMatch[1])) {
    addError(slug, 'layer', `Invalid layer: "${layerMatch[1]}"`);
  } else {
    const expectedLayer = basename(layerDir);
    if (layerMatch[1] !== expectedLayer) {
      addError(slug, 'layer', `Layer "${layerMatch[1]}" does not match directory "${expectedLayer}"`);
    }
  }

  const runModeMatch = fmText.match(/run_mode:\s*(\w+)/);
  if (!runModeMatch) {
    addError(slug, 'run_mode', 'Missing "run_mode" in clawx-finance metadata');
  } else if (!(VALID_RUN_MODES as readonly string[]).includes(runModeMatch[1])) {
    addError(slug, 'run_mode', `Invalid run_mode: "${runModeMatch[1]}"`);
  }

  if (runModeMatch?.[1] === 'cron') {
    if (!fmText.includes('cron_schedule:')) {
      addError(slug, 'cron_schedule', 'Cron mode skill must specify cron_schedule');
    }
  }

  const marketsMatch = fmText.match(/markets:\s*\[([^\]]+)\]/);
  if (!marketsMatch) {
    addError(slug, 'markets', 'Missing "markets" array');
  }

  const assetsMatch = fmText.match(/assets:\s*\[([^\]]+)\]/);
  if (!assetsMatch) {
    addError(slug, 'assets', 'Missing "assets" array');
  }

  const body = content.split('---').slice(2).join('---').trim();
  if (body.length < 200) {
    addError(slug, 'body', `Skill body too short (${body.length} chars, minimum 200)`);
  }
}

function validateBundle(bundlePath: string) {
  const bundleName = basename(bundlePath, '.json');
  try {
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf-8'));

    if (!bundle.id) addError(`bundle:${bundleName}`, 'id', 'Missing bundle id');
    if (!bundle.name_zh) addError(`bundle:${bundleName}`, 'name_zh', 'Missing Chinese name');
    if (!bundle.skills || !Array.isArray(bundle.skills)) {
      addError(`bundle:${bundleName}`, 'skills', 'Missing or invalid skills array');
      return;
    }

    for (const skillSlug of bundle.skills) {
      if (!allSlugs.has(skillSlug)) {
        addError(`bundle:${bundleName}`, 'skills', `References non-existent skill: "${skillSlug}"`);
      }
    }
  } catch {
    addError(`bundle:${bundleName}`, 'json', 'Invalid JSON');
  }
}

function main() {
  console.log('Validating ClawX Financial Skills...\n');

  const layerDirs = readdirSync(SKILLS_DIR).filter(d => {
    const p = join(SKILLS_DIR, d);
    return statSync(p).isDirectory() && !['bundles', 'pipelines'].includes(d);
  });

  let skillCount = 0;
  for (const layerDir of layerDirs) {
    const layerPath = join(SKILLS_DIR, layerDir);
    const skillDirs = readdirSync(layerPath).filter(d =>
      statSync(join(layerPath, d)).isDirectory()
    );

    for (const skillDir of skillDirs) {
      validateSkill(join(layerPath, skillDir), layerPath);
      skillCount++;
    }
  }

  console.log(`Validated ${skillCount} skills across ${layerDirs.length} layers`);
  console.log(`Slugs found: ${allSlugs.size}\n`);

  if (existsSync(BUNDLES_DIR)) {
    const bundles = readdirSync(BUNDLES_DIR).filter(f => f.endsWith('.json'));
    for (const bundle of bundles) {
      validateBundle(join(BUNDLES_DIR, bundle));
    }
    console.log(`Validated ${bundles.length} bundles\n`);
  }

  if (errors.length === 0) {
    console.log('All validations passed!');
    process.exit(0);
  } else {
    console.error(`Found ${errors.length} validation errors:\n`);
    for (const err of errors) {
      console.error(`  [${err.skill}] ${err.field}: ${err.message}`);
    }
    process.exit(1);
  }
}

main();
