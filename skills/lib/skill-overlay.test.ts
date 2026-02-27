import { describe, it, expect } from 'vitest';
import {
  computeSimilarity,
  classifyModification,
  parseSkillMd,
  mergeSections,
  mergeSkillMd,
  createSkillMeta,
  type SkillSection,
} from './skill-overlay';

describe('computeSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(computeSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    const a = 'aaaa bbbb cccc dddd eeee';
    const b = 'xxxx yyyy zzzz wwww vvvv';
    expect(computeSimilarity(a, b)).toBeLessThan(0.1);
  });

  it('returns high similarity for minor edits', () => {
    const a = 'The quick brown fox jumps over the lazy dog near the river bank';
    const b = 'The quick brown fox leaps over the lazy dog near the river bank';
    expect(computeSimilarity(a, b)).toBeGreaterThan(0.8);
  });

  it('returns moderate similarity for partial rewrites', () => {
    const a = 'Calculate Sharpe Ratio using daily returns with 252 trading days annualization factor';
    const b = 'Calculate Information Ratio using weekly returns with 52 weeks annualization factor and custom benchmark selection';
    const sim = computeSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.2);
    expect(sim).toBeLessThan(0.7);
  });

  it('handles empty strings', () => {
    expect(computeSimilarity('', '')).toBe(1);
    expect(computeSimilarity('hello', '')).toBe(0);
    expect(computeSimilarity('', 'world')).toBe(0);
  });
});

describe('classifyModification', () => {
  it('level-0 for nearly identical content', () => {
    const base = 'The quick brown fox jumps over the lazy dog. This is a test.';
    const user = 'The quick brown fox jumps over the lazy dog. This is a test!';
    expect(classifyModification(base, user)).toBe('level-0');
  });

  it('level-1 for light customization', () => {
    const base = `# Sharpe Ratio
Calculate using daily returns. Default risk-free rate is 2.1%.
Use 252 trading days for annualization.
Standard formula: (Rp - Rf) / sigma_p`;

    const user = `# Sharpe Ratio
Calculate using daily returns. Default risk-free rate is 2.5%.
Use 252 trading days for annualization.
Standard formula: (Rp - Rf) / sigma_p
Note: Our fund uses custom benchmark CSI500.`;

    expect(classifyModification(base, user)).toBe('level-1');
  });

  it('level-3 for complete rewrite', () => {
    const base = 'Calculate Sharpe Ratio using standard method with daily returns and benchmark comparison.';
    const user = 'Deploy a monitoring daemon that watches portfolio positions every 60 seconds and sends alerts via WeChat.';
    expect(classifyModification(base, user)).toBe('level-3');
  });
});

describe('parseSkillMd', () => {
  it('parses frontmatter and sections', () => {
    const content = `---
name: test-skill
version: 1.0.0
---

# Title

Some intro text.

## Section One

Content of section one.

## Section Two

Content of section two.
`;

    const result = parseSkillMd(content);
    expect(result.frontmatter).toContain('name: test-skill');
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].heading).toBe('Title');
    expect(result.sections[1].heading).toBe('Section One');
    expect(result.sections[2].heading).toBe('Section Two');
  });

  it('handles content without frontmatter', () => {
    const content = `# Just a heading

Some content.`;

    const result = parseSkillMd(content);
    expect(result.frontmatter).toBe('');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].heading).toBe('Just a heading');
  });
});

describe('mergeSections', () => {
  const makeSection = (heading: string, content: string): SkillSection => ({
    heading,
    level: 2,
    content,
  });

  it('takes upstream when user did not change', () => {
    const base = [makeSection('A', 'original')];
    const theirs = [makeSection('A', 'updated by upstream')];
    const ours = [makeSection('A', 'original')];

    const { merged, conflicts } = mergeSections(base, theirs, ours);
    expect(conflicts).toHaveLength(0);
    expect(merged[0].content).toBe('updated by upstream');
  });

  it('keeps user version when upstream did not change', () => {
    const base = [makeSection('A', 'original')];
    const theirs = [makeSection('A', 'original')];
    const ours = [makeSection('A', 'user modified')];

    const { merged, conflicts } = mergeSections(base, theirs, ours);
    expect(conflicts).toHaveLength(0);
    expect(merged[0].content).toBe('user modified');
  });

  it('flags conflict when both sides changed', () => {
    const base = [makeSection('A', 'original')];
    const theirs = [makeSection('A', 'upstream version')];
    const ours = [makeSection('A', 'user version')];

    const { merged, conflicts } = mergeSections(base, theirs, ours);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].section).toBe('A');
    expect(conflicts[0].theirs_content).toBe('upstream version');
    expect(conflicts[0].ours_content).toBe('user version');
    expect(merged[0].content).toBe('user version');
  });

  it('includes new sections from upstream', () => {
    const base = [makeSection('A', 'a')];
    const theirs = [makeSection('A', 'a'), makeSection('B', 'new from upstream')];
    const ours = [makeSection('A', 'a')];

    const { merged, conflicts } = mergeSections(base, theirs, ours);
    expect(conflicts).toHaveLength(0);
    expect(merged).toHaveLength(2);
    expect(merged[1].heading).toBe('B');
  });

  it('preserves new sections from user', () => {
    const base = [makeSection('A', 'a')];
    const theirs = [makeSection('A', 'a')];
    const ours = [makeSection('A', 'a'), makeSection('C', 'user custom section')];

    const { merged, conflicts } = mergeSections(base, theirs, ours);
    expect(conflicts).toHaveLength(0);
    expect(merged).toHaveLength(2);
    expect(merged[1].heading).toBe('C');
    expect(merged[1].content).toBe('user custom section');
  });

  it('respects user deletion when upstream also unchanged', () => {
    const base = [makeSection('A', 'a'), makeSection('B', 'b')];
    const theirs = [makeSection('A', 'a'), makeSection('B', 'b')];
    const ours = [makeSection('A', 'a')];

    const { merged, conflicts } = mergeSections(base, theirs, ours);
    expect(conflicts).toHaveLength(0);
    expect(merged).toHaveLength(1);
    expect(merged[0].heading).toBe('A');
  });

  it('flags conflict when upstream removed a section user modified', () => {
    const base = [makeSection('A', 'original')];
    const theirs: SkillSection[] = [];
    const ours = [makeSection('A', 'user modified')];

    const { merged, conflicts } = mergeSections(base, theirs, ours);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].suggestion).toContain('removed');
  });
});

describe('mergeSkillMd', () => {
  it('performs a clean merge when changes are non-overlapping', () => {
    const base = `---
name: test
version: 1.0.0
---

# Title

Original intro.

## Section A

Original A content.

## Section B

Original B content.
`;

    const theirs = `---
name: test
version: 1.1.0
---

# Title

Updated intro by upstream.

## Section A

Original A content.

## Section B

Original B content.

## Section C

New section from upstream.
`;

    const ours = `---
name: test
version: 1.0.0
---

# Title

Original intro.

## Section A

User modified A content.

## Section B

Original B content.
`;

    const result = mergeSkillMd(base, theirs, ours);
    expect(result.status).toBe('clean');

    const merged = result.merged_files.get('SKILL.md')!;
    expect(merged).toContain('User modified A content');
    expect(merged).toContain('Updated intro by upstream');
    expect(merged).toContain('Section C');
  });
});

describe('createSkillMeta', () => {
  it('creates valid initial meta', () => {
    const meta = createSkillMeta('indicator-return-metrics', '1.0.0');
    expect(meta.slug).toBe('indicator-return-metrics');
    expect(meta.installed_version).toBe('1.0.0');
    expect(meta.user_modified).toBe(false);
    expect(meta.forked).toBe(false);
    expect(meta.modification_level).toBe('level-0');
  });
});
