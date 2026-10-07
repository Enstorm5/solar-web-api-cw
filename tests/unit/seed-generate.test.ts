import { describe, expect, it } from 'vitest';
import {
  buildHierarchy,
  clearSkyFraction,
  colomboHour,
  generateReadings,
  INTERVAL_MS,
  seedUuid,
} from '../../src/seed/generate.js';

const anchorMs = Date.parse('2026-10-01T00:00:00Z');

describe('seedUuid', () => {
  it('is deterministic and RFC 4122 version-5 shaped', () => {
    expect(seedUuid('province:WP')).toBe(seedUuid('province:WP'));
    expect(seedUuid('province:WP')).not.toBe(seedUuid('province:CP'));
    expect(seedUuid('x')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('buildHierarchy', () => {
  const h = buildHierarchy({ randomSeed: 's', installationCount: 200, anchorMs });

  it('produces the brief-scale hierarchy', () => {
    expect(h.provinces).toHaveLength(9);
    expect(h.districts).toHaveLength(25);
    expect(h.substations).toHaveLength(30);
    expect(h.installations.filter((i) => i.reporting)).toHaveLength(200);
    expect(h.installations.filter((i) => !i.reporting)).toHaveLength(1);
  });

  it('keeps every foreign key inside the generated set', () => {
    const provinceIds = new Set(h.provinces.map((p) => p.id));
    const districtIds = new Set(h.districts.map((d) => d.id));
    const substationIds = new Set(h.substations.map((s) => s.id));
    expect(h.districts.every((d) => provinceIds.has(d.province_id))).toBe(true);
    expect(h.substations.every((s) => districtIds.has(s.district_id))).toBe(true);
    expect(h.installations.every((i) => substationIds.has(i.substation_id))).toBe(true);
    for (const d of h.districts) {
      expect(h.substations.some((s) => s.district_id === d.id)).toBe(true);
    }
  });

  it('gives unique meter ids and consistent user jurisdictions', () => {
    expect(new Set(h.installations.map((i) => i.meter_id)).size).toBe(h.installations.length);
    for (const u of h.users) {
      if (u.role === 'national') expect([u.province_id, u.district_id]).toEqual([null, null]);
      if (u.role === 'provincial') expect(u.province_id && !u.district_id).toBeTruthy();
      if (u.role === 'district') expect(!u.province_id && u.district_id).toBeTruthy();
    }
  });

  it('dates commissioning relative to the anchor', () => {
    for (const i of h.installations) {
      expect(i.commissioned_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(i.commissioned_on)).toBeLessThan(anchorMs);
    }
  });
});

describe('solar model', () => {
  it('converts UTC to Asia/Colombo (UTC+05:30)', () => {
    expect(colomboHour(Date.parse('2026-10-01T06:30:00Z'))).toBe(12);
    expect(colomboHour(Date.parse('2026-09-30T18:30:00Z'))).toBe(0);
  });

  it('is zero at night and positive around midday', () => {
    expect(clearSkyFraction(0)).toBe(0);
    expect(clearSkyFraction(5.5)).toBe(0);
    expect(clearSkyFraction(20)).toBe(0);
    expect(clearSkyFraction(12)).toBeGreaterThan(0.9);
  });

  it('generates a deterministic fixed-interval series with trapezoidal cumulative energy', () => {
    const inst = { id: seedUuid('i1'), capacity_kw: 5, district_code: 'CMB' };
    const start = anchorMs - 2 * 86_400_000;
    const a = generateReadings(inst, start, 192, 'seed');
    const b = generateReadings(inst, start, 192, 'seed');
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) {
      const prev = a[i - 1]!;
      const cur = a[i]!;
      expect(cur.timestamp.getTime() - prev.timestamp.getTime()).toBe(INTERVAL_MS);
      const expected = ((prev.power_kw + cur.power_kw) / 2) * 0.25;
      expect(cur.cumulative_energy_kwh - prev.cumulative_energy_kwh).toBeCloseTo(expected, 2);
      expect(cur.power_kw).toBeLessThanOrEqual(5);
      expect(cur.received_at.getTime()).toBeGreaterThan(cur.timestamp.getTime());
    }
    const night = a.filter((r) => colomboHour(r.timestamp.getTime()) < 5);
    expect(night.length).toBeGreaterThan(0);
    expect(night.every((r) => r.power_kw === 0)).toBe(true);
  });
});
