-- 0005: импорт Excel — файлы и staging разбора

CREATE TABLE import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('psdc', 'ks6')),
  original_name text NOT NULL,
  storage_key text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  mime_detected text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'parsing', 'parsed', 'parse_failed', 'applied', 'discarded')),
  error text,
  parser_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX import_files_contract_idx ON import_files (contract_id, created_at);

CREATE TABLE import_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_file_id uuid NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX import_staging_file_uq ON import_staging (import_file_id);
