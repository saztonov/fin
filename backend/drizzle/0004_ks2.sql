-- 0004: документы КС-2 и строки выполнения

CREATE TABLE ks2_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  number text NOT NULL,
  doc_date date,
  period_from date,
  period_to date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  import_label text,
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX ks2_documents_number_uq ON ks2_documents (contract_id, number) WHERE deleted_at IS NULL;
CREATE INDEX ks2_documents_period_idx ON ks2_documents (contract_id, period_from);

CREATE TABLE ks2_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ks2_document_id uuid NOT NULL REFERENCES ks2_documents(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  qty numeric(15,6) NOT NULL DEFAULT 0,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ks2_document_id, work_item_id)
);

CREATE INDEX ks2_lines_work_item_idx ON ks2_lines (work_item_id);
