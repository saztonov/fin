-- 0002: справочники — объекты строительства, назначения, договоры, доп.соглашения

CREATE TABLE construction_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(5) NOT NULL,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX construction_objects_code_uq ON construction_objects (code) WHERE deleted_at IS NULL;

CREATE TABLE user_object_assignments (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_id uuid NOT NULL REFERENCES construction_objects(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, object_id)
);

CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id uuid NOT NULL REFERENCES construction_objects(id),
  number text NOT NULL,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  date_signed date,
  zos_date date,
  customer_name text NOT NULL DEFAULT '',
  contractor_name text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- один объект = один договор
CREATE UNIQUE INDEX contracts_object_uq ON contracts (object_id) WHERE deleted_at IS NULL;

CREATE TABLE amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  number text NOT NULL,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  date_signed date,
  zos_extension_date date,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX amendments_contract_number_uq ON amendments (contract_id, number) WHERE deleted_at IS NULL;
