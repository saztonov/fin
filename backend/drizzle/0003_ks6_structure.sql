-- 0003: структура КС-6 — разделы и строки работ (КВР / номенклатура)

CREATE TABLE ks6_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  parent_id uuid REFERENCES ks6_sections(id),
  name text NOT NULL,
  sort_order int NOT NULL,
  amendment_id uuid REFERENCES amendments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX ks6_sections_contract_idx ON ks6_sections (contract_id, sort_order);

CREATE TABLE work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  section_id uuid NOT NULL REFERENCES ks6_sections(id),
  kind text NOT NULL CHECK (kind IN ('kvr', 'nomenclature')),
  kvr_item_id uuid REFERENCES work_items(id),
  kvr_code text NOT NULL DEFAULT '',
  name text NOT NULL,
  characteristic text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT '',
  contract_qty numeric(15,6) NOT NULL DEFAULT 0,
  unit_price numeric(18,2) NOT NULL DEFAULT 0,
  material_unit_cost numeric(18,2),
  work_unit_cost numeric(18,2),
  contract_total numeric(18,2) NOT NULL DEFAULT 0,
  budget_article text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  amendment_id uuid REFERENCES amendments(id),
  sort_order int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX work_items_contract_idx ON work_items (contract_id, sort_order);
CREATE INDEX work_items_section_idx ON work_items (section_id);
CREATE INDEX work_items_kvr_idx ON work_items (kvr_item_id);
