-- Копеечная точность импорта и контрольные суммы исходного Excel.
--
-- 1) Расценка в ведомостях заказчиков почти всегда с 4–6 знаками
--    («1 234,5678 руб./м3»). numeric(18,2) резал её до копеек, и qty × price при
--    ручном вводе КС-2 переставал сходиться с суммой, взятой из файла.
-- 2) Расхождения портала с исходной книгой должны быть видны в гриде КС-6
--    постоянно, а не только в предпросмотре импорта. Для этого контрольные графы
--    файла («Итого», «Выполнено с начала строительства») сохраняются рядом с
--    данными — как снимок последнего применённого импорта.

ALTER TABLE work_items
  ALTER COLUMN unit_price         TYPE numeric(18, 6),
  ALTER COLUMN material_unit_cost TYPE numeric(18, 6),
  ALTER COLUMN work_unit_cost     TYPE numeric(18, 6);

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS file_executed_total numeric(18, 2);

COMMENT ON COLUMN work_items.file_executed_total IS
  'Контрольная графа «Выполнено с нач. ст-ва» из файла импорта; данными не является — только для сверки';

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS file_contract_total   numeric(18, 2),
  ADD COLUMN IF NOT EXISTS file_executed_total   numeric(18, 2),
  ADD COLUMN IF NOT EXISTS file_totals_import_id uuid REFERENCES import_files(id);

COMMENT ON COLUMN contracts.file_contract_total IS
  '«Итого» по договору из последнего применённого файла импорта — для сверки в гриде КС-6';
COMMENT ON COLUMN contracts.file_executed_total IS
  'Контрольная колонка выполнения с начала строительства из того же файла';
