import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveStatus,
  isCapabilitySatisfied,
  selectDataSource,
  nextStatus,
  buildCapabilityContextXml,
  createEmptyProfile,
  type DataSourceCapability,
  type CapabilityProfile,
} from './capability-profile';

describe('resolveEffectiveStatus', () => {
  it('returns detected status when no override', () => {
    const cap: DataSourceCapability = {
      status: 'available',
      detected_at: null,
      last_checked_at: null,
      check_method: null,
      details: null,
      user_override: null,
    };
    expect(resolveEffectiveStatus(cap)).toBe('available');
  });

  it('returns override status when user override is set', () => {
    const cap: DataSourceCapability = {
      status: 'unavailable',
      detected_at: null,
      last_checked_at: null,
      check_method: null,
      details: null,
      user_override: {
        status: 'available',
        reason: 'Remote API available',
        set_at: '2026-02-27T10:00:00.000Z',
      },
    };
    expect(resolveEffectiveStatus(cap)).toBe('available');
  });
});

describe('isCapabilitySatisfied', () => {
  it('returns true when available with no permission requirements', () => {
    const cap: DataSourceCapability = {
      status: 'available',
      detected_at: null,
      last_checked_at: null,
      check_method: null,
      details: null,
      user_override: null,
    };
    expect(isCapabilitySatisfied(cap)).toBe(true);
  });

  it('returns false when unavailable', () => {
    const cap: DataSourceCapability = {
      status: 'unavailable',
      detected_at: null,
      last_checked_at: null,
      check_method: null,
      details: null,
      user_override: null,
    };
    expect(isCapabilitySatisfied(cap)).toBe(false);
  });

  it('returns false when unchecked', () => {
    const cap: DataSourceCapability = {
      status: 'unchecked',
      detected_at: null,
      last_checked_at: null,
      check_method: null,
      details: null,
      user_override: null,
    };
    expect(isCapabilitySatisfied(cap)).toBe(false);
  });

  it('checks permissions when required', () => {
    const cap: DataSourceCapability = {
      status: 'available',
      detected_at: null,
      last_checked_at: null,
      check_method: null,
      details: {
        permissions: {
          cn_a_equity: true,
          hk_equity: true,
          us_equity: false,
        },
      },
      user_override: null,
    };

    expect(isCapabilitySatisfied(cap, ['cn_a_equity'])).toBe(true);
    expect(isCapabilitySatisfied(cap, ['cn_a_equity', 'hk_equity'])).toBe(true);
    expect(isCapabilitySatisfied(cap, ['us_equity'])).toBe(false);
    expect(isCapabilitySatisfied(cap, ['cn_a_equity', 'us_equity'])).toBe(false);
  });

  it('considers degraded as satisfiable', () => {
    const cap: DataSourceCapability = {
      status: 'degraded',
      detected_at: null,
      last_checked_at: null,
      check_method: null,
      details: { permissions: { cn_a_equity: true } },
      user_override: null,
    };
    expect(isCapabilitySatisfied(cap, ['cn_a_equity'])).toBe(true);
  });
});

describe('selectDataSource', () => {
  const baseProfile: CapabilityProfile = {
    ...createEmptyProfile(),
    data_sources: {
      wind: {
        status: 'available',
        detected_at: null,
        last_checked_at: null,
        check_method: null,
        details: { permissions: { cn_a_equity: true, historical_data: true } },
        user_override: null,
      },
      tushare: {
        status: 'available',
        detected_at: null,
        last_checked_at: null,
        check_method: null,
        details: null,
        user_override: null,
      },
    },
  };

  it('selects primary when available', () => {
    const result = selectDataSource(
      baseProfile,
      'wind',
      [{ source: 'tushare', covers: ['cn_a_equity', 'historical_data'] }],
      ['cn_a_equity'],
    );
    expect(result).toEqual({ source: 'wind', status: 'available', via: 'primary' });
  });

  it('falls back when primary unavailable', () => {
    const profile = {
      ...baseProfile,
      data_sources: {
        ...baseProfile.data_sources,
        wind: { ...baseProfile.data_sources.wind, status: 'unavailable' as const },
      },
    };
    const result = selectDataSource(
      profile,
      'wind',
      [{ source: 'tushare', covers: ['cn_a_equity', 'historical_data'] }],
      ['cn_a_equity'],
    );
    expect(result).toEqual({ source: 'tushare', status: 'available', via: 'fallback' });
  });

  it('returns null when no source satisfies requirements', () => {
    const profile = {
      ...baseProfile,
      data_sources: {
        wind: { ...baseProfile.data_sources.wind, status: 'unavailable' as const },
        tushare: { ...baseProfile.data_sources.tushare, status: 'unavailable' as const },
      },
    };
    const result = selectDataSource(
      profile,
      'wind',
      [{ source: 'tushare', covers: ['cn_a_equity'] }],
      ['cn_a_equity'],
    );
    expect(result).toBeNull();
  });

  it('skips fallback that does not cover required permissions', () => {
    const profile = {
      ...baseProfile,
      data_sources: {
        wind: { ...baseProfile.data_sources.wind, status: 'unavailable' as const },
        tushare: baseProfile.data_sources.tushare,
      },
    };
    const result = selectDataSource(
      profile,
      'wind',
      [{ source: 'tushare', covers: ['cn_a_equity'] }],
      ['cn_a_equity', 'realtime_quote'],
    );
    expect(result).toBeNull();
  });
});

describe('nextStatus', () => {
  it('unchecked → available on success', () => {
    expect(nextStatus({ current: 'unchecked', consecutiveFailures: 0, checkPassed: true }))
      .toBe('available');
  });

  it('unchecked → unavailable on failure', () => {
    expect(nextStatus({ current: 'unchecked', consecutiveFailures: 1, checkPassed: false }))
      .toBe('unavailable');
  });

  it('available → degraded on single failure', () => {
    expect(nextStatus({ current: 'available', consecutiveFailures: 1, checkPassed: false }))
      .toBe('degraded');
  });

  it('degraded → available on success', () => {
    expect(nextStatus({ current: 'degraded', consecutiveFailures: 0, checkPassed: true }))
      .toBe('available');
  });

  it('degraded → unavailable after 3 consecutive failures', () => {
    expect(nextStatus({ current: 'degraded', consecutiveFailures: 3, checkPassed: false }))
      .toBe('unavailable');
  });

  it('degraded stays degraded under threshold', () => {
    expect(nextStatus({ current: 'degraded', consecutiveFailures: 2, checkPassed: false }))
      .toBe('degraded');
  });

  it('unavailable → available on success', () => {
    expect(nextStatus({ current: 'unavailable', consecutiveFailures: 0, checkPassed: true }))
      .toBe('available');
  });
});

describe('buildCapabilityContextXml', () => {
  it('generates valid XML context', () => {
    const profile: CapabilityProfile = {
      version: 1,
      updated_at: '2026-02-27T08:30:00.000Z',
      data_sources: {
        wind: {
          status: 'available',
          detected_at: '2026-02-27T08:30:00.000Z',
          last_checked_at: '2026-02-27T08:30:00.000Z',
          check_method: 'process+api',
          details: {
            api_type: 'windpy',
            permissions: { cn_a_equity: true, hk_equity: true, us_equity: false },
          },
          user_override: null,
        },
        bloomberg: {
          status: 'unavailable',
          detected_at: null,
          last_checked_at: null,
          check_method: null,
          details: null,
          user_override: null,
        },
      },
      tools: {
        python3: { status: 'available', version: '3.12.3', path: '/usr/bin/python3' },
      },
      mcp_connectors: {},
    };

    const xml = buildCapabilityContextXml(profile);
    expect(xml).toContain('<capability_context>');
    expect(xml).toContain('name="wind" status="available"');
    expect(xml).toContain('cn_a_equity, hk_equity');
    expect(xml).toContain('<api_type>windpy</api_type>');
    expect(xml).toContain('name="bloomberg" status="unavailable"');
    expect(xml).toContain('name="python3" version="3.12.3"');
    expect(xml).not.toContain('us_equity');
  });

  it('skips unchecked data sources', () => {
    const profile: CapabilityProfile = {
      ...createEmptyProfile(),
      data_sources: {
        ifind: {
          status: 'unchecked',
          detected_at: null,
          last_checked_at: null,
          check_method: null,
          details: null,
          user_override: null,
        },
      },
    };
    const xml = buildCapabilityContextXml(profile);
    expect(xml).not.toContain('ifind');
  });
});
