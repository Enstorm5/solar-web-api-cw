// `SIM_BASE_URL=https://... npm run simulate -- [--meters MTR-000001,MTR-000002] [--max-steps 96]`
// Emulates metering devices: for each installation it reads the last-known reading (with an
// analyst token, as a test harness) and then POSTs the missing 15-minute readings up to now
// *as that installation's device*, integrating energy so the register stays continuous.
// It only appends history through the public API; it never edits or backdates existing data.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { importPrivateKey, signAccessToken } from '../src/auth/tokens.js';
import {
  clearSkyFraction,
  colomboHour,
  floorToInterval,
  INTERVAL_MS,
  rng,
  seedUuid,
} from '../src/seed/generate.js';

const { values } = parseArgs({
  options: {
    meters: { type: 'string' },
    count: { type: 'string', default: '200' },
    'max-steps': { type: 'string', default: '96' },
    concurrency: { type: 'string', default: '8' },
  },
});
const base =
  (process.env.SIM_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/solar/v1.0';
const issuer = process.env.JWT_ISSUER ?? 'https://auth.slsea.example/solar';
const audience = process.env.JWT_AUDIENCE ?? 'solar-api';
const privateKey = await importPrivateKey(
  readFileSync(process.env.JWT_PRIVATE_KEY_FILE ?? '.secrets/jwt-private.pem', 'utf8'),
);
const sign = (principal: 'user' | 'device', subject: string, scope: string) =>
  signAccessToken({ privateKey, issuer, audience, subject, principal, scope, expiresIn: '15m' });

const meters = values.meters
  ? values.meters.split(',')
  : Array.from({ length: Number(values.count) }, (_, i) => `MTR-${String(i + 1).padStart(6, '0')}`);
const maxSteps = Number(values['max-steps']);
const analyst = await sign('user', 'analyst-national', 'analyst-read-national');
const now = floorToInterval(Date.now());

let posted = 0;
let skipped = 0;
const failures: string[] = [];

async function simulate(meter: string) {
  const id = seedUuid(`installation:${meter}`);
  const headers = { Authorization: `Bearer ${analyst}` };
  const inst = await fetch(`${base}/installations/${id}`, { headers });
  if (inst.status !== 200) return void failures.push(`${meter}: installation ${inst.status}`);
  const { capacity_kw: capacity } = (await inst.json()) as { capacity_kw: number };
  const last = await fetch(`${base}/installations/${id}/last-known-reading`, { headers });
  if (last.status !== 200)
    return void failures.push(`${meter}: no last-known reading (${last.status})`);
  const prev = (await last.json()) as {
    timestamp: string;
    power_kw: number;
    cumulative_energy_kwh: number;
  };

  const device = await sign('device', id, 'installation-write');
  const rand = rng(`simulate:${meter}:${now}`);
  let ts = Date.parse(prev.timestamp) + INTERVAL_MS;
  let energy = prev.cumulative_energy_kwh;
  let power = prev.power_kw;
  let steps = 0;
  if (ts > now) skipped++;
  for (; ts <= now && steps < maxSteps; ts += INTERVAL_MS, steps++) {
    const next =
      Math.round(capacity * clearSkyFraction(colomboHour(ts)) * (0.6 + rand() * 0.35) * 1000) /
      1000;
    energy += ((power + next) / 2) * (INTERVAL_MS / 3_600_000);
    power = next;
    const res = await fetch(`${base}/installations/${id}/readings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${device}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date(ts).toISOString(),
        power_kw: power,
        cumulative_energy_kwh: Math.round(energy * 1000) / 1000,
        voltage_v: Math.round((228 + rand() * 6) * 100) / 100,
      }),
    });
    if (res.status === 201) posted++;
    else if (res.status !== 409)
      failures.push(`${meter} ${new Date(ts).toISOString()}: ${res.status}`);
  }
}

const queue = [...meters];
const started = Date.now();
await Promise.all(
  Array.from({ length: Number(values.concurrency) }, async () => {
    for (let m = queue.shift(); m; m = queue.shift()) await simulate(m);
  }),
);
console.log(
  JSON.stringify(
    {
      target: base,
      up_to_utc: new Date(now).toISOString(),
      installations: meters.length,
      readings_posted: posted,
      already_current: skipped,
      failures: failures.length,
      seconds: Math.round((Date.now() - started) / 1000),
    },
    null,
    2,
  ),
);
if (failures.length) console.error(failures.slice(0, 10).join('\n'));
process.exitCode = failures.length ? 1 : 0;
