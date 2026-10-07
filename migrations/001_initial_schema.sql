-- Six-entity model: Province > District > GridSubstation > SolarInstallation > GenerationReading, plus User.
-- Readings are an append-only time series; the meter identifier is an installation attribute.

CREATE TABLE provinces (
  id          uuid PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,4}$'),
  name        text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 100),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE districts (
  id           uuid PRIMARY KEY,
  province_id  uuid NOT NULL REFERENCES provinces (id) ON DELETE RESTRICT,
  code         text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{3}$'),
  name         text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 100),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX districts_province_id_idx ON districts (province_id);

CREATE TABLE grid_substations (
  id           uuid PRIMARY KEY,
  district_id  uuid NOT NULL REFERENCES districts (id) ON DELETE RESTRICT,
  code         text NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 40),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grid_substations_district_id_idx ON grid_substations (district_id);

CREATE TABLE solar_installations (
  id               uuid PRIMARY KEY,
  substation_id    uuid NOT NULL REFERENCES grid_substations (id) ON DELETE RESTRICT,
  meter_id         text NOT NULL UNIQUE CHECK (length(meter_id) BETWEEN 1 AND 40),
  label            text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  capacity_kw      numeric(9, 3) NOT NULL CHECK (capacity_kw > 0),
  commissioned_on  date NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_installations_substation_id_idx ON solar_installations (substation_id);

CREATE TABLE generation_readings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id        uuid NOT NULL REFERENCES solar_installations (id) ON DELETE RESTRICT,
  "timestamp"            timestamptz NOT NULL,
  power_kw               numeric(10, 3) NOT NULL CHECK (power_kw >= 0),
  cumulative_energy_kwh  numeric(14, 3) NOT NULL CHECK (cumulative_energy_kwh >= 0),
  voltage_v              numeric(6, 2) NOT NULL CHECK (voltage_v BETWEEN 0 AND 1000),
  received_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT generation_readings_installation_timestamp_key UNIQUE (installation_id, "timestamp")
);
-- The unique constraint's index serves per-installation history and latest-reading lookups.
CREATE INDEX generation_readings_timestamp_idx ON generation_readings ("timestamp", installation_id, id);

-- History is immutable even for privileged SQL sessions that bypass the API.
CREATE FUNCTION generation_readings_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'generation_readings is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER generation_readings_no_update_delete
  BEFORE UPDATE OR DELETE ON generation_readings
  FOR EACH ROW EXECUTE FUNCTION generation_readings_append_only();

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  subject       text NOT NULL UNIQUE CHECK (length(subject) BETWEEN 1 AND 100),
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  role          text NOT NULL CHECK (role IN ('national', 'provincial', 'district')),
  province_id   uuid REFERENCES provinces (id) ON DELETE RESTRICT,
  district_id   uuid REFERENCES districts (id) ON DELETE RESTRICT,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_jurisdiction_check CHECK (
    (role = 'national'   AND province_id IS NULL     AND district_id IS NULL) OR
    (role = 'provincial' AND province_id IS NOT NULL AND district_id IS NULL) OR
    (role = 'district'   AND province_id IS NULL     AND district_id IS NOT NULL)
  )
);
