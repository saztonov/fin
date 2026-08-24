-- Удаление договоров и дополнительных соглашений.
--
-- В портале остаются только объект строительства, смета (с частями по ставкам НДС)
-- и КС-2/КС-6. Договор был точкой привязки всего — сметы, актов, импорта — и заодно
-- нёс режим НДС и реквизиты печатных форм. Заказчик от обеих сущностей отказался:
-- в КС печатаются только данные самих КС, а НДС выделяется по дате (vat_rates),
-- без «договоров без НДС».
--
-- Новая точка привязки — объект. `estimate_parts` и `import_files` получают object_id;
-- у `ks6_sections`, `work_items` и `ks2_documents` contract_id просто исчезает —
-- part_id уже однозначно определяет объект, дублировать связь незачем.

-- --- 1. корень сметы переезжает на объект ---

ALTER TABLE estimate_parts ADD COLUMN object_id uuid REFERENCES construction_objects(id);
UPDATE estimate_parts p SET object_id = c.object_id FROM contracts c WHERE c.id = p.contract_id;
ALTER TABLE estimate_parts ALTER COLUMN object_id SET NOT NULL;

DROP INDEX estimate_parts_uq;
ALTER TABLE estimate_parts DROP COLUMN contract_id;
CREATE UNIQUE INDEX estimate_parts_uq ON estimate_parts (object_id, code);

COMMENT ON TABLE estimate_parts IS
  'Части сметы объекта: legacy — единая смета, vat20/vat22 — версии по ставкам НДС';
COMMENT ON COLUMN estimate_parts.vat_rate IS
  'Ставка части; NULL только у legacy — там ставка определяется датой периода';

-- --- 2. структура и документы: contract_id и amendment_id больше не нужны ---

DROP INDEX ks6_sections_contract_idx;
ALTER TABLE ks6_sections
  DROP COLUMN contract_id,
  DROP COLUMN amendment_id;
CREATE INDEX ks6_sections_part_sort_idx ON ks6_sections (part_id, sort_order);

DROP INDEX work_items_contract_idx;
ALTER TABLE work_items
  DROP COLUMN contract_id,
  DROP COLUMN amendment_id;
CREATE INDEX work_items_part_sort_idx ON work_items (part_id, sort_order);

-- номер КС-2 остаётся уникальным внутри части: часть однозначно определяет объект,
-- поэтому пара (part_id, number) равносильна прежней тройке с contract_id
DROP INDEX ks2_documents_number_uq;
DROP INDEX ks2_documents_period_idx;
ALTER TABLE ks2_documents DROP COLUMN contract_id;
CREATE UNIQUE INDEX ks2_documents_number_uq
  ON ks2_documents (part_id, number) WHERE deleted_at IS NULL;
CREATE INDEX ks2_documents_period_idx ON ks2_documents (part_id, period_from);

-- --- 3. файл импорта принадлежит объекту ---

ALTER TABLE import_files ADD COLUMN object_id uuid REFERENCES construction_objects(id);
UPDATE import_files f SET object_id = c.object_id FROM contracts c WHERE c.id = f.contract_id;
ALTER TABLE import_files ALTER COLUMN object_id SET NOT NULL;

DROP INDEX import_files_contract_idx;
ALTER TABLE import_files DROP COLUMN contract_id;
CREATE INDEX import_files_object_idx ON import_files (object_id, created_at);

-- --- 4. сами сущности ---

DROP TABLE amendments;
DROP TABLE contracts;
