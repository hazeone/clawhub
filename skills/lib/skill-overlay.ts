/**
 * Skill Overlay — three-layer skill resolution with user modification tracking.
 *
 * Layers (high → low priority):
 *   Layer 3 (user):     ~/.openclaw/financial-skills/<slug>/
 *   Layer 2 (managed):  ~/.openclaw/financial-skills/.managed/<slug>/
 *   Layer 1 (bundled):  <app>/resources/bundled-skills/<slug>/
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LayerName = 'bundled' | 'managed' | 'user';

export type ModificationLevel = 'level-0' | 'level-1' | 'level-2' | 'level-3';

export interface ResolvedFile {
  relPath: string;
  content: string;
  source: LayerName;
}

export interface ResolvedSkill {
  slug: string;
  files: Map<string, ResolvedFile>;
  hasUserOverrides: boolean;
  effectiveVersion: string;
  modificationLevel: ModificationLevel;
}

export interface SkillMeta {
  version: 1;
  slug: string;
  installed_version: string;
  current_upstream: string | null;
  modification_level: ModificationLevel;
  user_modified: boolean;
  user_modified_at: string | null;
  files_modified: string[];
  files_added: string[];
  files_deleted: string[];
  last_merge_result: MergeResultSummary | null;
  forked: boolean;
}

export interface SkillConfig {
  version: 1;
  skill_slug: string;
  base_version: string;
  params: Record<string, unknown>;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Merge types
// ---------------------------------------------------------------------------

export type MergeStatus = 'clean' | 'conflict' | 'skipped';

export interface ConflictRegion {
  section: string;
  base_content: string;
  theirs_content: string;
  ours_content: string;
  suggestion: string;
}

export interface MergeResult {
  status: MergeStatus;
  merged_files: Map<string, string>;
  conflicts: ConflictRegion[];
  stats: {
    files_unchanged: number;
    files_merged: number;
    files_conflicted: number;
    files_added_upstream: number;
    files_added_user: number;
  };
}

export interface MergeResultSummary {
  status: MergeStatus;
  merged_at: string;
  from_version: string;
  to_version: string;
  conflict_count: number;
}

export type RollbackTarget = 'baseline' | 'managed' | 'snapshot';

export interface Snapshot {
  timestamp: string;
  reason: 'user_edit' | 'merge' | 'rollback';
  base_version: string;
  files: string[];
}

// ---------------------------------------------------------------------------
// Modification classification
// ---------------------------------------------------------------------------

/**
 * Computes a rough similarity score between two texts (0..1).
 * Uses a simple trigram overlap approach — good enough for classifying
 * whether a user "lightly tweaked" vs "completely rewrote" a SKILL.md.
 */
export function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const trigramsA = extractTrigrams(a);
  const trigramsB = extractTrigrams(b);

  if (trigramsA.size === 0 && trigramsB.size === 0) return 1;
  if (trigramsA.size === 0 || trigramsB.size === 0) return 0;

  let intersection = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersection++;
  }

  return (2 * intersection) / (trigramsA.size + trigramsB.size);
}

function extractTrigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const trigrams = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Classifies the level of user modification by comparing to baseline.
 */
export function classifyModification(baseline: string, userVersion: string): ModificationLevel {
  const similarity = computeSimilarity(baseline, userVersion);

  if (similarity > 0.95) return 'level-0';
  if (similarity > 0.6) return 'level-1';
  if (similarity > 0.3) return 'level-2';
  return 'level-3';
}

// ---------------------------------------------------------------------------
// Section-based SKILL.md parsing
// ---------------------------------------------------------------------------

export interface SkillSection {
  heading: string;
  level: number;
  content: string;
}

export interface ParsedSkillMd {
  frontmatter: string;
  sections: SkillSection[];
}

/**
 * Parses a SKILL.md into frontmatter + sections for structural merging.
 */
export function parseSkillMd(content: string): ParsedSkillMd {
  let frontmatter = '';
  let body = content;

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fmMatch) {
    frontmatter = fmMatch[1];
    body = fmMatch[2];
  }

  const sections: SkillSection[] = [];
  const headingRe = /^(#{1,6})\s+(.+)$/gm;
  let lastIndex = 0;
  let lastHeading: { heading: string; level: number; start: number } | null = null;

  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(body)) !== null) {
    if (lastHeading) {
      sections.push({
        heading: lastHeading.heading,
        level: lastHeading.level,
        content: body.slice(lastHeading.start, match.index).trim(),
      });
    }
    lastHeading = {
      heading: match[2].trim(),
      level: match[1].length,
      start: match.index,
    };
    lastIndex = headingRe.lastIndex;
  }

  if (lastHeading) {
    sections.push({
      heading: lastHeading.heading,
      level: lastHeading.level,
      content: body.slice(lastHeading.start).trim(),
    });
  } else if (body.trim()) {
    sections.push({ heading: '__root__', level: 0, content: body.trim() });
  }

  return { frontmatter, sections };
}

// ---------------------------------------------------------------------------
// Three-way section merge
// ---------------------------------------------------------------------------

/**
 * Merges sections from base, theirs (upstream), and ours (user) versions.
 *
 * Strategy:
 * - If user didn't change a section → take upstream version
 * - If upstream didn't change a section → keep user version
 * - If both changed → mark as conflict
 * - New sections from either side are included
 */
export function mergeSections(
  baseSections: SkillSection[],
  theirsSections: SkillSection[],
  oursSections: SkillSection[],
): { merged: SkillSection[]; conflicts: ConflictRegion[] } {
  const baseMap = new Map(baseSections.map(s => [s.heading, s]));
  const theirsMap = new Map(theirsSections.map(s => [s.heading, s]));
  const oursMap = new Map(oursSections.map(s => [s.heading, s]));

  const allHeadings = [
    ...new Set([...theirsMap.keys(), ...oursMap.keys(), ...baseMap.keys()]),
  ];

  const merged: SkillSection[] = [];
  const conflicts: ConflictRegion[] = [];

  for (const heading of allHeadings) {
    const b = baseMap.get(heading);
    const t = theirsMap.get(heading);
    const o = oursMap.get(heading);

    if (b && t && o) {
      if (b.content === o.content) {
        merged.push(t);
      } else if (b.content === t.content) {
        merged.push(o);
      } else {
        conflicts.push({
          section: heading,
          base_content: b.content,
          theirs_content: t.content,
          ours_content: o.content,
          suggestion: 'Both upstream and user modified this section. Manual review needed.',
        });
        merged.push(o);
      }
    } else if (!b && t && !o) {
      merged.push(t);
    } else if (!b && !t && o) {
      merged.push(o);
    } else if (b && !t && o) {
      if (b.content === o.content) {
        // upstream removed, user didn't change → remove
      } else {
        conflicts.push({
          section: heading,
          base_content: b.content,
          theirs_content: '',
          ours_content: o.content,
          suggestion: 'Upstream removed this section but you modified it.',
        });
        merged.push(o);
      }
    } else if (b && t && !o) {
      // user removed, upstream may have updated → respect user deletion
    } else if (!b && t && o) {
      if (t.content === o.content) {
        merged.push(t);
      } else {
        conflicts.push({
          section: heading,
          base_content: '',
          theirs_content: t.content,
          ours_content: o.content,
          suggestion: 'Both sides added a section with the same heading.',
        });
        merged.push(o);
      }
    }
  }

  return { merged, conflicts };
}

// ---------------------------------------------------------------------------
// Full SKILL.md merge
// ---------------------------------------------------------------------------

export function mergeSkillMd(
  baseContent: string,
  theirsContent: string,
  oursContent: string,
): MergeResult {
  const base = parseSkillMd(baseContent);
  const theirs = parseSkillMd(theirsContent);
  const ours = parseSkillMd(oursContent);

  const { merged: mergedSections, conflicts } = mergeSections(
    base.sections,
    theirs.sections,
    ours.sections,
  );

  const mergedFrontmatter = theirs.frontmatter;

  const lines: string[] = [];
  if (mergedFrontmatter) {
    lines.push('---', mergedFrontmatter, '---', '');
  }
  for (const section of mergedSections) {
    lines.push(section.content, '');
  }

  const mergedFiles = new Map<string, string>();
  mergedFiles.set('SKILL.md', lines.join('\n'));

  return {
    status: conflicts.length > 0 ? 'conflict' : 'clean',
    merged_files: mergedFiles,
    conflicts,
    stats: {
      files_unchanged: 0,
      files_merged: 1,
      files_conflicted: conflicts.length > 0 ? 1 : 0,
      files_added_upstream: 0,
      files_added_user: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

export function createSkillMeta(slug: string, version: string): SkillMeta {
  return {
    version: 1,
    slug,
    installed_version: version,
    current_upstream: null,
    modification_level: 'level-0',
    user_modified: false,
    user_modified_at: null,
    files_modified: [],
    files_added: [],
    files_deleted: [],
    last_merge_result: null,
    forked: false,
  };
}

export function createSkillConfig(slug: string, baseVersion: string): SkillConfig {
  return {
    version: 1,
    skill_slug: slug,
    base_version: baseVersion,
    params: {},
    updated_at: new Date().toISOString(),
  };
}
