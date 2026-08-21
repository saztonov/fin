-- Части сметы по ставкам НДС.
--
-- С 01.01.2026 ставка 22 % вместо 20 %, и заказчики ведут ведомость двумя листами:
-- «КС6а 31.12.2025» и «КС6а ндс22%» (см. Сторис.xlsx). Это НЕ разные работы, а две
-- перекрывающиеся версии одной сметы: у листов совпадает большинство номенклатур,
-- отличаются цены. Поэтому части нельзя складывать — их можно только показывать
-- по отдельности, и у каждой свои контрольные суммы книги.
--
-- Часть — сущность, а не колонка-перечисление: на ней живут ставка, снимок
-- контрольных сумм последнего импорта и порядок вкладок. Существующие сметы
-- переносятся в часть 'legacy' — в ней ставка берётся по дате, как и раньше.

CREATE TABLE estimate_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  code text NOT NULL CHECK (code IN ('legacy', 'vat20', 'vat22')),
  -- NULL только у legacy: там ставка определяется датой договора/ДС и периода
  vat_rate numeric(5, 2),
  sort_order int NOT NULL DEFAULT 0,
  file_contract_total numeric(18, 2),
  file_executed_total numeric(18, 2),
  file_totals_import_id uuid REFERENCES import_files(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX estimate_parts_uq ON estimate_parts (contract_id, code);

COMMENT ON TABLE estimate_parts IS
  'Части сметы договора: legacy — единая смета, vat20/vat22 — версии по ставкам НДС';

-- каждому существующему договору — часть legacy с его контрольными суммами
INSERT INTO estimate_parts (contract_id, code, vat_rate, sort_order,
                            file_contract_total, file_executed_total, file_totals_import_id)
SELECT id, 'legacy', NULL, 0, file_contract_total, file_executed_total, file_totals_import_id
FROM contracts;

-- --- привязка структуры и документов к части ---

ALTER TABLE ks6_sections  ADD COLUMN part_id uuid REFERENCES estimate_parts(id);
ALTER TABLE work_items    ADD COLUMN part_id uuid REFERENCES estimate_parts(id);
ALTER TABLE ks2_documents ADD COLUMN part_id uuid REFERENCES estimate_parts(id);

UPDATE ks6_sections s SET part_id = p.id
  FROM estimate_parts p WHERE p.contract_id = s.contract_id AND p.code = 'legacy';
UPDATE work_items w SET part_id = p.id
  FROM estimate_parts p WHERE p.contract_id = w.contract_id AND p.code = 'legacy';
UPDATE ks2_documents d SET part_id = p.id
  FROM estimate_parts p WHERE p.contract_id = d.contract_id AND p.code = 'legacy';

ALTER TABLE ks6_sections  ALTER COLUMN part_id SET NOT NULL;
ALTER TABLE work_items    ALTER COLUMN part_id SET NOT NULL;
ALTER TABLE ks2_documents ALTER COLUMN part_id SET NOT NULL;

CREATE INDEX ks6_sections_part_idx  ON ks6_sections (part_id);
CREATE INDEX work_items_part_idx    ON work_items (part_id);
CREATE INDEX ks2_documents_part_idx ON ks2_documents (part_id);

-- --- целостность: строка выполнения не может связать документ одной части
--     с работой другой. Проверкой в сервисе это не удержать: точек входа много ---

ALTER TABLE work_items    ADD CONSTRAINT work_items_id_part_uq    UNIQUE (id, part_id);
ALTER TABLE ks2_documents ADD CONSTRAINT ks2_documents_id_part_uq UNIQUE (id, part_id);

ALTER TABLE ks2_lines ADD COLUMN part_id uuid;
UPDATE ks2_lines l SET part_id = d.part_id
  FROM ks2_documents d WHERE d.id = l.ks2_document_id;
ALTER TABLE ks2_lines ALTER COLUMN part_id SET NOT NULL;
ALTER TABLE ks2_lines
  ADD CONSTRAINT ks2_lines_doc_part_fk
    FOREIGN KEY (ks2_document_id, part_id) REFERENCES ks2_documents (id, part_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT ks2_lines_item_part_fk
    FOREIGN KEY (work_item_id, part_id) REFERENCES work_items (id, part_id);

-- номер КС-2 уникален внутри части: в частях 20 % и 22 % свои сквозные нумерации,
-- и КС-2 №1 законно существует в обеих
DROP INDEX ks2_documents_number_uq;
CREATE UNIQUE INDEX ks2_documents_number_uq
  ON ks2_documents (contract_id, part_id, number) WHERE deleted_at IS NULL;

-- --- контрольные суммы книги переезжают на часть ---

ALTER TABLE contracts
  DROP COLUMN file_contract_total,
  DROP COLUMN file_executed_total,
  DROP COLUMN file_totals_import_id;

-- --- импорт: пара файлов одной книги и лист под свою часть ---

ALTER TABLE import_files ADD COLUMN batch_id uuid;
ALTER TABLE import_files ADD COLUMN part_code text
  CHECK (part_code IS NULL OR part_code IN ('legacy', 'vat20', 'vat22'));

CREATE INDEX import_files_batch_idx ON import_files (batch_id);

COMMENT ON COLUMN import_files.batch_id IS
  'Общий id двух записей одной книги при импорте «две страницы КС»';
COMMENT ON COLUMN import_files.part_code IS
  'В какую часть сметы применяется лист; задаёт сервер, не клиент';
