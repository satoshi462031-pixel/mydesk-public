alter table products
  add column if not exists ports jsonb,
  add column if not exists specs_source_url text,
  add column if not exists specs_verified_at timestamptz;

alter table products
  add constraint products_ports_array_check
  check (ports is null or jsonb_typeof(ports) = 'array');
