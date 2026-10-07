import { describe, expect, it } from 'vitest';
import {
  localDate,
  localDayBounds,
  summarise,
  type SiteObservations,
} from '../../src/services/summary.js';

const T = (iso: string) => new Date(iso);
const site = (id: string, o: Partial<SiteObservations>): SiteObservations => ({
  installation_id: id,
  current_ts: null,
  current_power_kw: null,
  start_ts: null,
  start_energy_kwh: null,
  end_ts: null,
  end_energy_kwh: null,
  reset_in_period: false,
  ...o,
});

describe('Asia/Colombo day bounds', () => {
  it('local midnight is 18:30 UTC the previous day, not UTC midnight', () => {
    expect(localDayBounds('2026-09-25')).toEqual({
      start: T('2026-09-24T18:30:00Z'),
      end: T('2026-09-25T18:30:00Z'),
    });
  });

  it('maps instants near midnight to the correct local date', () => {
    expect(localDate(T('2026-09-24T18:29:59Z'))).toBe('2026-09-24');
    expect(localDate(T('2026-09-24T18:30:00Z'))).toBe('2026-09-25');
  });
});

describe('summarise (hand-calculated fixture)', () => {
  // date 2026-09-25 local; as-of 12:00 local = 06:30Z; period 2026-09-24T18:30Z .. 06:30Z
  const asOf = T('2026-09-25T06:30:00Z');
  const start = T('2026-09-24T18:30:00Z');
  const sites: SiteObservations[] = [
    // A: exact boundaries, fresh 4.0 kW, energy 112.5 - 100 = 12.5
    site('A', {
      current_ts: asOf,
      current_power_kw: 4,
      start_ts: start,
      start_energy_kwh: 100,
      end_ts: asOf,
      end_energy_kwh: 112.5,
    }),
    // B: boundaries 10 min old (allowed), fresh 2.5 kW, energy 8
    site('B', {
      current_ts: T('2026-09-25T06:20:00Z'),
      current_power_kw: 2.5,
      start_ts: T('2026-09-24T18:20:00Z'),
      start_energy_kwh: 50,
      end_ts: T('2026-09-25T06:20:00Z'),
      end_energy_kwh: 58,
    }),
    // C: last reading 60 min old -> stale and end boundary too old -> incomplete
    site('C', {
      current_ts: T('2026-09-25T05:30:00Z'),
      current_power_kw: 1,
      start_ts: start,
      start_energy_kwh: 10,
      end_ts: T('2026-09-25T05:30:00Z'),
      end_energy_kwh: 15,
    }),
    // D: register went down overall -> reset, fresh 3.0 kW
    site('D', {
      current_ts: asOf,
      current_power_kw: 3,
      start_ts: start,
      start_energy_kwh: 900,
      end_ts: asOf,
      end_energy_kwh: 20,
    }),
    // E: reset inside the period although end > start; fresh but generating 0 kW (a real zero)
    site('E', {
      current_ts: asOf,
      current_power_kw: 0,
      start_ts: start,
      start_energy_kwh: 200,
      end_ts: asOf,
      end_energy_kwh: 250,
      reset_in_period: true,
    }),
    // F: never reported -> missing, incomplete
    site('F', {}),
    // G: first reading after the period start -> fresh 1.5 kW, no start boundary -> incomplete
    site('G', { current_ts: asOf, current_power_kw: 1.5, end_ts: asOf, end_energy_kwh: 5 }),
  ];
  const s = summarise({
    district_id: 'd',
    date: '2026-09-25',
    as_of: asOf,
    period_start: start,
    period_end: asOf,
    sites,
  });

  it('sums only fresh power and partitions fresh/stale/missing', () => {
    expect(s.current_power_kw).toBe(11); // 4 + 2.5 + 3 + 0 + 1.5
    expect([
      s.fresh_installation_count,
      s.stale_installation_count,
      s.missing_installation_count,
    ]).toEqual([5, 1, 1]);
    expect(
      s.fresh_installation_count + s.stale_installation_count + s.missing_installation_count,
    ).toBe(s.installation_count);
  });

  it('estimates energy from covered sites only and reports coverage', () => {
    expect(s.estimated_energy_kwh).toBe(20.5); // A 12.5 + B 8
    expect(s.energy_covered_installation_count).toBe(2);
    expect(s.energy_incomplete_installation_count).toBe(5);
    expect(s.meter_reset_installation_count).toBe(2);
  });

  it('reports the evaluation context explicitly', () => {
    expect(s).toMatchObject({
      timezone: 'Asia/Colombo',
      as_of: '2026-09-25T06:30:00.000Z',
      period_start: '2026-09-24T18:30:00.000Z',
      period_end: '2026-09-25T06:30:00.000Z',
      freshness_seconds: 1800,
      max_boundary_age_seconds: 900,
      installation_count: 7,
    });
  });

  it('returns null energy (not 0) and zero power when nothing is usable', () => {
    const empty = summarise({
      district_id: 'd',
      date: '2026-09-25',
      as_of: asOf,
      period_start: start,
      period_end: asOf,
      sites: [],
    });
    expect(empty).toMatchObject({
      estimated_energy_kwh: null,
      current_power_kw: 0,
      installation_count: 0,
    });
    const onlyMissing = summarise({
      district_id: 'd',
      date: '2026-09-25',
      as_of: asOf,
      period_start: start,
      period_end: asOf,
      sites: [site('F', {})],
    });
    expect(onlyMissing.estimated_energy_kwh).toBeNull();
  });

  it('treats a boundary reading 15 min old as acceptable and 15 min + 1 s as too old', () => {
    const at = (secondsBefore: number) =>
      summarise({
        district_id: 'd',
        date: '2026-09-25',
        as_of: asOf,
        period_start: start,
        period_end: asOf,
        sites: [
          site('X', {
            start_ts: new Date(start.getTime() - secondsBefore * 1000),
            start_energy_kwh: 1,
            end_ts: asOf,
            end_energy_kwh: 2,
          }),
        ],
      }).energy_covered_installation_count;
    expect(at(900)).toBe(1);
    expect(at(901)).toBe(0);
  });
});
