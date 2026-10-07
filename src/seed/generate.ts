// Pure, deterministic seed-data generation. No database access here so it can be unit-tested.
import { createHash } from 'node:crypto';
import { EXTRA_SUBSTATION_DISTRICTS, PROVINCES } from './geography.js';

export const INTERVAL_MINUTES = 15;
export const INTERVAL_MS = INTERVAL_MINUTES * 60_000;
/** Sri Lanka has no daylight saving: local time is always UTC+05:30. */
export const COLOMBO_OFFSET_MINUTES = 330;

const UUID_NAMESPACE = 'slsea-solar-seed-v1';

/** Name-based (SHA-1, RFC 4122 version 5 layout) UUID so reruns produce identical IDs. */
export function seedUuid(name: string): string {
  const h = createHash('sha1').update(`${UUID_NAMESPACE}:${name}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** mulberry32 PRNG seeded from a string key, giving an independent stream per key. */
export function rng(key: string): () => number {
  let a = createHash('sha256').update(key).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

export interface ProvinceRow { id: string; code: string; name: string }
export interface DistrictRow { id: string; province_id: string; code: string; name: string }
export interface SubstationRow { id: string; district_id: string; code: string; name: string }
export interface InstallationRow {
  id: string;
  substation_id: string;
  meter_id: string;
  label: string;
  capacity_kw: number;
  commissioned_on: string;
  active: boolean;
  /** false = newly commissioned site that has not reported yet (empty-history demonstration). */
  reporting: boolean;
}
export interface UserRow {
  id: string;
  subject: string;
  display_name: string;
  role: 'national' | 'provincial' | 'district';
  province_id: string | null;
  district_id: string | null;
}

export interface Hierarchy {
  provinces: ProvinceRow[];
  districts: DistrictRow[];
  substations: SubstationRow[];
  installations: InstallationRow[];
  users: UserRow[];
}

export interface SeedOptions {
  randomSeed: string;
  /** Number of reporting installations (excludes the one non-reporting demo site). */
  installationCount: number;
  /** End of the generated history (exclusive), floored to the reporting interval. */
  anchorMs: number;
}

export function buildHierarchy(opts: SeedOptions): Hierarchy {
  const provinces: ProvinceRow[] = [];
  const districts: DistrictRow[] = [];
  const substations: SubstationRow[] = [];
  for (const p of PROVINCES) {
    const provinceId = seedUuid(`province:${p.code}`);
    provinces.push({ id: provinceId, code: p.code, name: p.name });
    for (const d of p.districts) {
      const districtId = seedUuid(`district:${d.code}`);
      districts.push({ id: districtId, province_id: provinceId, code: d.code, name: d.name });
      const count = EXTRA_SUBSTATION_DISTRICTS.includes(d.code) ? 2 : 1;
      for (let n = 1; n <= count; n++) {
        const code = `GSS-${d.code}-${String(n).padStart(2, '0')}`;
        substations.push({
          id: seedUuid(`substation:${code}`),
          district_id: districtId,
          code,
          name: `${d.name} Grid Substation ${n} (synthetic)`,
        });
      }
    }
  }

  const rand = rng(`${opts.randomSeed}:installations`);
  const capacities = [3, 4, 5, 5.5, 6, 8, 10, 12, 15, 20];
  const installations: InstallationRow[] = [];
  for (let i = 0; i < opts.installationCount + 1; i++) {
    const n = i + 1;
    const meterId = `MTR-${String(n).padStart(6, '0')}`;
    const reporting = i < opts.installationCount;
    const commissionedDaysAgo = reporting ? 60 + Math.floor(rand() * 2500) : 1;
    installations.push({
      id: seedUuid(`installation:${meterId}`),
      substation_id: substations[i % substations.length]!.id,
      meter_id: meterId,
      label: `Rooftop site ${n} (synthetic)`,
      capacity_kw: capacities[Math.floor(rand() * capacities.length)]!,
      commissioned_on: new Date(opts.anchorMs - commissionedDaysAgo * 86_400_000)
        .toISOString()
        .slice(0, 10),
      active: true,
      reporting,
    });
  }

  const byCode = (code: string) => districts.find((d) => d.code === code)!.id;
  const provinceByCode = (code: string) => provinces.find((p) => p.code === code)!.id;
  const user = (
    subject: string,
    display_name: string,
    role: UserRow['role'],
    province_id: string | null,
    district_id: string | null,
  ): UserRow => ({ id: seedUuid(`user:${subject}`), subject, display_name, role, province_id, district_id });
  const users: UserRow[] = [
    user('analyst-national', 'National analyst (synthetic)', 'national', null, null),
    user('analyst-wp', 'Western Province analyst (synthetic)', 'provincial', provinceByCode('WP'), null),
    user('analyst-cp', 'Central Province analyst (synthetic)', 'provincial', provinceByCode('CP'), null),
    user('analyst-cmb', 'Colombo District analyst (synthetic)', 'district', null, byCode('CMB')),
    user('analyst-kdy', 'Kandy District analyst (synthetic)', 'district', null, byCode('KDY')),
  ];

  return { provinces, districts, substations, installations, users };
}

/** Floors a time to the reporting interval. */
export function floorToInterval(ms: number): number {
  return Math.floor(ms / INTERVAL_MS) * INTERVAL_MS;
}

/** Decimal hour of day in Asia/Colombo local time. */
export function colomboHour(ms: number): number {
  const local = new Date(ms + COLOMBO_OFFSET_MINUTES * 60_000);
  return local.getUTCHours() + local.getUTCMinutes() / 60;
}

/** Clear-sky fraction of capacity: zero overnight, smooth bell between ~06:00 and ~18:15 local. */
export function clearSkyFraction(hour: number): number {
  const sunrise = 6.0;
  const sunset = 18.25;
  if (hour <= sunrise || hour >= sunset) return 0;
  return Math.sin((Math.PI * (hour - sunrise)) / (sunset - sunrise)) ** 1.3;
}

export interface ReadingRow {
  installation_id: string;
  timestamp: Date;
  power_kw: number;
  cumulative_energy_kwh: number;
  voltage_v: number;
  received_at: Date;
}

/**
 * Generates `count` readings for one installation at a fixed 15-minute interval starting at
 * `startMs`. Energy integrates power with the trapezoidal rule over each 0.25 h step, so the
 * cumulative register never decreases.
 */
export function generateReadings(
  inst: Pick<InstallationRow, 'id' | 'capacity_kw'> & { district_code: string },
  startMs: number,
  count: number,
  randomSeed: string,
): ReadingRow[] {
  const site = rng(`${randomSeed}:site:${inst.id}`);
  const efficiency = 0.78 + site() * 0.14; // inverter/orientation derating
  let energy = inst.capacity_kw * (300 + site() * 6000); // prior lifetime energy, kWh
  const nominalV = 228 + site() * 6;
  const rows: ReadingRow[] = [];
  let prevPower = 0;
  for (let i = 0; i < count; i++) {
    const ts = startMs + i * INTERVAL_MS;
    const dayKey = Math.floor((ts + COLOMBO_OFFSET_MINUTES * 60_000) / 86_400_000);
    // District-wide daily cloudiness plus per-reading passing-cloud noise.
    const dayCloud = 0.55 + rng(`${randomSeed}:weather:${inst.district_code}:${dayKey}`)() * 0.45;
    const noise = Math.min(1.05, Math.max(0.6, 1 + gaussian(site) * 0.06));
    const fraction = clearSkyFraction(colomboHour(ts));
    const power = fraction === 0 ? 0 : round(Math.min(inst.capacity_kw * 0.97, inst.capacity_kw * fraction * efficiency * dayCloud * noise), 3);
    if (i > 0) energy += ((prevPower + power) / 2) * (INTERVAL_MINUTES / 60);
    prevPower = power;
    const voltage = round(Math.min(250, Math.max(212, nominalV + gaussian(site) * 2.5)), 2);
    rows.push({
      installation_id: inst.id,
      timestamp: new Date(ts),
      power_kw: power,
      cumulative_energy_kwh: round(energy, 3),
      voltage_v: voltage,
      received_at: new Date(ts + 2_000 + Math.floor(site() * 28_000)),
    });
  }
  return rows;
}
