/**
 * Capability Profile — persistent record of user's data source / tool availability.
 *
 * File: ~/.openclaw/clawx-capabilities.json
 *
 * Read by Agent sessions at startup and injected into system prompt context
 * so Skills can make data-source decisions without re-probing.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type CapabilityStatus = 'available' | 'unavailable' | 'degraded' | 'unchecked';

export interface DataSourceCapability {
  status: CapabilityStatus;
  detected_at: string | null;
  last_checked_at: string | null;
  check_method: string | null;
  details: Record<string, unknown> | null;
  user_override: UserOverride | null;
}

export interface UserOverride {
  status: CapabilityStatus;
  reason: string;
  set_at: string;
  api_endpoint?: string;
}

export interface ToolCapability {
  status: CapabilityStatus;
  version: string | null;
  path: string | null;
}

export interface McpConnectorStatus {
  status: CapabilityStatus;
  url: string | null;
  last_health_check: string | null;
}

export interface CapabilityProfile {
  version: 1;
  updated_at: string;
  data_sources: Record<string, DataSourceCapability>;
  tools: Record<string, ToolCapability>;
  mcp_connectors: Record<string, McpConnectorStatus>;
}

// ---------------------------------------------------------------------------
// Change events
// ---------------------------------------------------------------------------

export interface CapabilityChangeEvent {
  source: string;
  previous_status: CapabilityStatus;
  new_status: CapabilityStatus;
  reason: string;
  detected_at: string;
  permissions_changed?: {
    added: string[];
    removed: string[];
  };
}

// ---------------------------------------------------------------------------
// Detection results
// ---------------------------------------------------------------------------

export interface DetectionCheck {
  name: string;
  passed: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

export interface CapabilityDetectionResult {
  source: string;
  status: CapabilityStatus;
  checks: DetectionCheck[];
  details: Record<string, unknown> | null;
  check_method: string;
}

// ---------------------------------------------------------------------------
// Effective status resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the effective status for a data source, considering user overrides.
 * user_override takes precedence over detected status.
 */
export function resolveEffectiveStatus(cap: DataSourceCapability): CapabilityStatus {
  if (cap.user_override) {
    return cap.user_override.status;
  }
  return cap.status;
}

/**
 * Determines whether a data source satisfies a Skill's requirement.
 */
export function isCapabilitySatisfied(
  cap: DataSourceCapability,
  requiredPermissions?: string[],
): boolean {
  const effective = resolveEffectiveStatus(cap);
  if (effective === 'unavailable' || effective === 'unchecked') return false;

  if (!requiredPermissions || requiredPermissions.length === 0) return true;

  const permissions = (cap.details?.permissions ?? {}) as Record<string, boolean>;
  return requiredPermissions.every(p => permissions[p] === true);
}

/**
 * Selects the best available data source from a prioritized list.
 *
 * Used by Skills that declare fallback data sources:
 *   primary: wind
 *   fallback:
 *     - { source: tushare, covers: [cn_a_equity] }
 *     - { source: akshare, covers: [cn_a_equity] }
 */
export function selectDataSource(
  profile: CapabilityProfile,
  primary: string,
  fallbacks: Array<{ source: string; covers: string[] }>,
  requiredPermissions: string[],
): { source: string; status: CapabilityStatus; via: 'primary' | 'fallback' } | null {
  const primaryCap = profile.data_sources[primary];
  if (primaryCap && isCapabilitySatisfied(primaryCap, requiredPermissions)) {
    return { source: primary, status: resolveEffectiveStatus(primaryCap), via: 'primary' };
  }

  for (const fb of fallbacks) {
    const fbCap = profile.data_sources[fb.source];
    if (!fbCap) continue;

    const coversRequired = requiredPermissions.every(p => fb.covers.includes(p));
    if (!coversRequired) continue;

    if (resolveEffectiveStatus(fbCap) === 'available') {
      return { source: fb.source, status: 'available', via: 'fallback' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Status transition logic
// ---------------------------------------------------------------------------

const DEGRADED_THRESHOLD = 3;

export interface TransitionContext {
  current: CapabilityStatus;
  consecutiveFailures: number;
  checkPassed: boolean;
}

/**
 * Determines the next status based on the current state and check result.
 * Implements the state machine:
 *   unchecked   → available | unavailable (first check)
 *   available   → degraded (single failure)
 *   degraded    → available (success) | unavailable (3 consecutive failures)
 *   unavailable → available (re-check success)
 */
export function nextStatus(ctx: TransitionContext): CapabilityStatus {
  if (ctx.checkPassed) return 'available';

  switch (ctx.current) {
    case 'unchecked':
      return 'unavailable';
    case 'available':
      return 'degraded';
    case 'degraded':
      return ctx.consecutiveFailures >= DEGRADED_THRESHOLD ? 'unavailable' : 'degraded';
    case 'unavailable':
      return 'unavailable';
  }
}

// ---------------------------------------------------------------------------
// Profile I/O
// ---------------------------------------------------------------------------

export function createEmptyProfile(): CapabilityProfile {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    data_sources: {},
    tools: {},
    mcp_connectors: {},
  };
}

export function createUncheckedDataSource(): DataSourceCapability {
  return {
    status: 'unchecked',
    detected_at: null,
    last_checked_at: null,
    check_method: null,
    details: null,
    user_override: null,
  };
}

/**
 * Generates the XML context block that gets injected into Agent system prompts.
 */
export function buildCapabilityContextXml(profile: CapabilityProfile): string {
  const lines: string[] = ['<capability_context>'];

  lines.push('  <data_sources>');
  for (const [name, cap] of Object.entries(profile.data_sources)) {
    const effective = resolveEffectiveStatus(cap);
    if (effective === 'unchecked') continue;

    const attrs = [`name="${name}"`, `status="${effective}"`];
    if (cap.user_override) attrs.push('override="true"');

    if (effective === 'unavailable') {
      lines.push(`    <source ${attrs.join(' ')} />`);
      continue;
    }

    lines.push(`    <source ${attrs.join(' ')}>`);
    if (cap.details) {
      const perms = cap.details.permissions as Record<string, boolean> | undefined;
      if (perms) {
        const available = Object.entries(perms)
          .filter(([, v]) => v)
          .map(([k]) => k);
        if (available.length > 0) {
          lines.push(`      <permissions>${available.join(', ')}</permissions>`);
        }
      }
      if (cap.details.api_type) {
        lines.push(`      <api_type>${cap.details.api_type}</api_type>`);
      }
    }
    lines.push('    </source>');
  }
  lines.push('  </data_sources>');

  lines.push('  <tools>');
  for (const [name, tool] of Object.entries(profile.tools)) {
    if (tool.status !== 'available') continue;
    const vAttr = tool.version ? ` version="${tool.version}"` : '';
    lines.push(`    <tool name="${name}"${vAttr} />`);
  }
  lines.push('  </tools>');

  lines.push('</capability_context>');
  return lines.join('\n');
}
