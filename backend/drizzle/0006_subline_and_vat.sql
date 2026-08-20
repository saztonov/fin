-- Вид строки «в т.ч.» и ставка НДС по датам.
--
-- 1) В ведомостях заказчиков (ЗИЛ — 465 строк «в т.ч.» и 324 «не в системе»)
--    под номенклатурой идёт детализация. Её нужно хранить и показывать, но она
--    НЕ участвует в суммах — иначе разделы и итог задваиваются.
-- 2) Ставка НДС перестаёт быть константой 20%: с 01.01.2026 — 22%, а часть
--    договоров ведётся вообще без НДС (цены нетто).

ALTER TABLE work_items DROP CONSTRAINT IF EXISTS work_items_kind_check;
ALTER TABLE work_items
  ADD CONSTRAINT work_items_kind_check CHECK (kind IN ('kvr', 'nomenclature', 'subline'));

CREATE TABLE IF NOT EXISTS vat_rates (
  effective_from date PRIMARY KEY,
  rate numeric(5, 2) NOT NULL
);

INSERT INTO vat_rates (effective_from, rate) VALUES
  ('2019-01-01', 20.00),
  ('2026-01-01', 22.00)
ON CONFLICT (effective_from) DO NOTHING;

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS vat_mode text NOT NULL DEFAULT 'gross';
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_vat_mode_check;
ALTER TABLE contracts
  ADD CONSTRAINT contracts_vat_mode_check CHECK (vat_mode IN ('gross', 'net'));

COMMENT ON COLUMN contracts.vat_mode IS 'gross — цены с НДС (умолчание), net — договор без НДС';

-- Лист, с которого читали книгу: в книгах заказчиков листов несколько
-- («КС-6_Осн.дог» + «КС-6_ДС11», «КС6а ндс22%» + «КС6а 31.12.2025»),
-- и пользователь должен иметь возможность перечитать файл другим листом.
ALTER TABLE import_files
  ADD COLUMN IF NOT EXISTS sheet_name text;
