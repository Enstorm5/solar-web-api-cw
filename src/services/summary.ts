// District generation summary: pure arithmetic over per-installation boundary observations.
// Kept free of SQL and HTTP so the formula can be unit-tested against hand-calculated cases.

export const SUMMARY_TIMEZONE = 'Asia/Colombo';
/** A site's latest power counts as "current" only if observed within this window before as-of. */
export const FRESHNESS_SECONDS = 30 * 60;
/** Boundary readings may be at most one reporting interval older than the boundary they stand for. */
export const MAX_BOUNDARY_AGE_SECONDS = 15 * 60;

/** UTC offset in minutes of a time zone at an instant, via the platform's IANA tz database. */
function offsetMinutes(timeZone: string, at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')!.value; // e.g. "GMT+05:30"
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Calendar date (YYYY-MM-DD) of an instant in the summary time zone. */
export function localDate(at: Date, timeZone = SUMMARY_TIMEZONE): string {
  return new Date(at.getTime() + offsetMinutes(timeZone, at) * 60_000).toISOString().slice(0, 10);
}

/** UTC instants of local midnight at the start and end of a calendar date (never assumes UTC midnight). */
export function localDayBounds(
  date: string,
  timeZone = SUMMARY_TIMEZONE,
): { start: Date; end: Date } {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  const next = utcMidnight + 86_400_000;
  const start = utcMidnight - offsetMinutes(timeZone, new Date(utcMidnight)) * 60_000;
  const end = next - offsetMinutes(timeZone, new Date(next)) * 60_000;
  return { start: new Date(start), end: new Date(end) };
}

export interface SiteObservations {
  installation_id: string;
  /** Latest reading at or before as-of. */
  current_ts: Date | null;
  current_power_kw: number | null;
  /** Latest reading at or before the period start. */
  start_ts: Date | null;
  start_energy_kwh: number | null;
  /** Latest reading at or before the period end. */
  end_ts: Date | null;
  end_energy_kwh: number | null;
  /** A decrease of the cumulative register between the two boundary readings. */
  reset_in_period: boolean;
}

export interface SummaryInput {
  district_id: string;
  date: string;
  as_of: Date;
  period_start: Date;
  period_end: Date;
  sites: SiteObservations[];
}

export interface DistrictSummary {
  district_id: string;
  date: string;
  timezone: string;
  as_of: string;
  period_start: string;
  period_end: string;
  freshness_seconds: number;
  max_boundary_age_seconds: number;
  current_power_kw: number;
  estimated_energy_kwh: number | null;
  installation_count: number;
  fresh_installation_count: number;
  stale_installation_count: number;
  missing_installation_count: number;
  energy_covered_installation_count: number;
  energy_incomplete_installation_count: number;
  meter_reset_installation_count: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const ageSeconds = (boundary: Date, ts: Date) => (boundary.getTime() - ts.getTime()) / 1000;

/**
 * - Current power sums only fresh sites' latest power; stale or missing sites are counted, never
 *   assumed to be generating zero. A fresh reading of 0 kW (night, outage) is a real zero.
 *   fresh + stale + missing = installation_count.
 * - Energy is the difference of each site's cumulative register between the period boundaries
 *   (never a sum of registers or of power samples). A site is covered only if both boundary
 *   readings exist within MAX_BOUNDARY_AGE of their boundary and no reset occurred; otherwise it
 *   is incomplete. Resets are a subset of incomplete. No covered site -> null, not an invented 0.
 */
export function summarise(input: SummaryInput): DistrictSummary {
  let power = 0;
  let energy = 0;
  let fresh = 0;
  let stale = 0;
  let missing = 0;
  let covered = 0;
  let resets = 0;
  for (const s of input.sites) {
    if (s.current_ts === null) missing++;
    else if (ageSeconds(input.as_of, s.current_ts) <= FRESHNESS_SECONDS) {
      fresh++;
      power += s.current_power_kw ?? 0;
    } else stale++;

    const startOk =
      s.start_ts !== null && ageSeconds(input.period_start, s.start_ts) <= MAX_BOUNDARY_AGE_SECONDS;
    const endOk =
      s.end_ts !== null && ageSeconds(input.period_end, s.end_ts) <= MAX_BOUNDARY_AGE_SECONDS;
    const reset =
      s.reset_in_period ||
      (s.start_energy_kwh !== null &&
        s.end_energy_kwh !== null &&
        s.end_energy_kwh < s.start_energy_kwh);
    if (reset) resets++;
    if (startOk && endOk && !reset) {
      covered++;
      energy += s.end_energy_kwh! - s.start_energy_kwh!;
    }
  }
  return {
    district_id: input.district_id,
    date: input.date,
    timezone: SUMMARY_TIMEZONE,
    as_of: input.as_of.toISOString(),
    period_start: input.period_start.toISOString(),
    period_end: input.period_end.toISOString(),
    freshness_seconds: FRESHNESS_SECONDS,
    max_boundary_age_seconds: MAX_BOUNDARY_AGE_SECONDS,
    current_power_kw: round3(power),
    estimated_energy_kwh: covered > 0 ? round3(energy) : null,
    installation_count: input.sites.length,
    fresh_installation_count: fresh,
    stale_installation_count: stale,
    missing_installation_count: missing,
    energy_covered_installation_count: covered,
    energy_incomplete_installation_count: input.sites.length - covered,
    meter_reset_installation_count: resets,
  };
}
