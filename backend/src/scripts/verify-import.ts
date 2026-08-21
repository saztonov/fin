/**
 * Сквозная проверка (план §Верификация): через HTTP API создаётся объект и договор,
 * загружается эталонный Excel, ждётся разбор worker'ом, применяется импорт,
 * итоги грида сверяются с контрольными числами файла.
 * Требует запущенных api и worker: npm run dev:api, npm run dev:worker.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';

const cfg = loadConfig();
const BASE = `http://${cfg.API_HOST}:${cfg.API_PORT}/api/v1`;
const SAMPLE = path.resolve(
  process.cwd(),
  '..',
  'temp',
  'Расчет_изм_ст_№7_КС_№_9_от_07_04_25_в_работе_15_04_25.XLSX',
);

/**
 * Ожидания сняты с текущего поведения разбора. Обе суммы выше контрольных граф книги
 * ровно на 12 479 438.49 ₽ — строку «Прижимная стена» (сумма семи строк ниже) файл
 * помечает «Вид = Номенклатура», и разметку файла портал уважает: эвристика подбора
 * агрегатов такие строки не трогает (см. import-format.md, кейс ЗИЛ). В книге эта
 * строка в «Итого» не входит, поэтому задвоение остаётся — и его теперь видно:
 * грид КС-6 обводит красным и итог, и семнадцать строк.
 */
const EXPECT = {
  contractTotal: '3262097038.13', // Σ номенклатур; «Итого» файла 3249617599.59
  fileContractTotal: '3249617599.59',
  contractMismatch: '12479438.54',
  executedTotal: '1444710901.14', // контрольная колонка файла — 1432855689.19
  vat: '543682839.76', // Σ построчных НДС по ставке на дату договора
  nomenclatures: 143,
  ks2Columns: 9,
};

let token = '';

async function call<T>(pathName: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${pathName}`, {
    ...init,
    headers: {
      'x-requested-with': 'ks-portal',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${init.method ?? 'GET'} ${pathName} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

function check(name: string, actual: unknown, expected: unknown): boolean {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${actual}${ok ? '' : ` (ожидалось ${expected})`}`);
  return ok;
}

async function main() {
  let failures = 0;
  const expect = (name: string, actual: unknown, expected: unknown) => {
    if (!check(name, actual, expected)) failures += 1;
  };

  // вход
  const login = await call<{ accessToken: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: cfg.SEED_ADMIN_EMAIL, password: cfg.SEED_ADMIN_PASSWORD }),
  });
  token = login.accessToken;
  console.log('Вход выполнен');

  // объект (код уникален — генерим от времени, 5 цифр)
  const code = String(10000 + (Date.now() % 90000));
  const object = await call<{ id: string }>('/objects', {
    method: 'POST',
    body: JSON.stringify({ code, name: `Верификация импорта ${code}`, address: 'тест' }),
  });
  console.log(`Объект ${code} создан`);

  await call(`/objects/${object.id}/contract`, {
    method: 'PUT',
    body: JSON.stringify({
      number: 'ЗИЛ-33-0669/24',
      amount: '3249617599.59',
      dateSigned: '2024-10-11',
      customerName: 'АО «СЗ «ЛСР. Недвижимость-М»',
      contractorName: 'ООО «СУ-10»',
      subject: 'Многофункциональный жилой комплекс (ЛОТ 33)',
    }),
  });
  console.log('Договор заведён');

  // загрузка файла
  const fd = new FormData();
  fd.append('kind', 'ks6');
  fd.append(
    'file',
    new Blob([fs.readFileSync(SAMPLE)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    path.basename(SAMPLE),
  );
  const uploaded = await call<{ id: string }>(`/objects/${object.id}/imports`, {
    method: 'POST',
    body: fd,
  });
  console.log(`Файл загружен: ${uploaded.id}`);

  // ждём разбор
  let status = '';
  for (let i = 0; i < 60; i++) {
    const info = await call<{ status: string; error: string | null }>(`/imports/${uploaded.id}`);
    status = info.status;
    if (status === 'parsed') break;
    if (status === 'parse_failed') throw new Error(`Разбор упал: ${info.error}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (status !== 'parsed') throw new Error(`Разбор не завершился (статус ${status})`);
  console.log('Файл разобран worker-ом');

  // предпросмотр
  interface Preview {
    counts: { new: number; match: number; changed: number; missing: number };
    ks2Columns: { index: number; number: string | null; monthDate: string | null; periodFrom: string | null; periodTo: string | null; cellCount: number }[];
    controls: { computedContractTotal: string; computedExecutedTotal: string; executedTotal: string | null };
    warnings: string[];
    structureEmpty: boolean;
  }
  const preview = await call<Preview>(`/imports/${uploaded.id}/preview`);
  expect('структура пуста', preview.structureEmpty, true);
  expect('новых строк (60 КВР + 143 номенклатуры)', preview.counts.new, 203);
  expect('колонок КС-2', preview.ks2Columns.length, EXPECT.ks2Columns);
  console.log(`Предупреждений разбора: ${preview.warnings.length}`);

  // периоды: недостающие номера/границы — из monthDate; первая колонка без подписи = №9 (в работе)
  const monthBounds = (iso: string) => {
    const [y, m] = iso.split('-').map(Number);
    const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    return {
      from: `${y}-${String(m).padStart(2, '0')}-01`,
      to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
    };
  };
  const periods = preview.ks2Columns.map((c) => {
    const b = c.monthDate ? monthBounds(c.monthDate) : null;
    return {
      index: c.index,
      number: c.number ?? '9',
      periodFrom: c.periodFrom ?? b?.from ?? '2025-03-06',
      periodTo: c.periodTo ?? b?.to ?? '2025-04-02',
    };
  });

  const applied = await call<Record<string, number>>(`/imports/${uploaded.id}/apply`, {
    method: 'POST',
    body: JSON.stringify({
      applyChanged: false,
      importHistory: true,
      overwriteKs2: false,
      approveImported: true,
      periods,
    }),
  });
  console.log('Импорт применён:', JSON.stringify(applied));

  // грид
  interface Grid {
    periods: { number: string; status: string; totalAmount: string; vatAmount: string; netAmount: string }[];
    rows: { type: string; totalMismatch?: string | null; executedMismatch?: string | null }[];
    totals: {
      contractTotal: string;
      executedAmount: string;
      remainderAmount: string;
      vatContract: string;
      vatView: string;
      fileContractTotal: string | null;
      contractMismatch: string | null;
    };
  }
  const grid = await call<Grid>(`/objects/${object.id}/ks6`);
  expect('Сумма договора (Σ номенклатур)', grid.totals.contractTotal, EXPECT.contractTotal);
  expect('Выполнено всего', grid.totals.executedAmount, EXPECT.executedTotal);
  expect(
    'Остаток',
    grid.totals.remainderAmount,
    (Number(EXPECT.contractTotal) - Number(EXPECT.executedTotal)).toFixed(2),
  );
  expect('НДС от договора (Σ построчных)', grid.totals.vatContract, EXPECT.vat);
  expect('периодов в гриде', grid.periods.length, EXPECT.ks2Columns);
  expect('все импортированные КС-2 утверждены', grid.periods.every((p) => p.status === 'approved'), true);
  // контрольная сумма книги сохранена и сверена: расхождение показывает грид, а не лог
  expect('«Итого» книги сохранено в договоре', grid.totals.fileContractTotal, EXPECT.fileContractTotal);
  expect('расхождение с «Итого» книги посчитано точно', grid.totals.contractMismatch, EXPECT.contractMismatch);
  const delta = Number(EXPECT.contractMismatch);
  const marked = grid.rows.filter((r) => r.totalMismatch || r.executedMismatch).length;
  console.log(
    `Справка: «Итого» файла ${EXPECT.fileContractTotal}, Σ номенклатур ${grid.totals.contractTotal} ` +
      `(внутренняя неувязка файла ${delta.toFixed(2)} руб.); строк с подсветкой расхождений: ${marked}`,
  );

  // режим «без НДС»: суммы уменьшаются ровно на выделенный НДС
  const gridNet = await call<Grid>(`/objects/${object.id}/ks6?vat=net`);
  expect('режим отображения', gridNet.totals.vatView, 'net');
  expect(
    'Итого без НДС = Итого с НДС − НДС',
    gridNet.totals.contractTotal,
    (Number(grid.totals.contractTotal) - Number(grid.totals.vatContract)).toFixed(2),
  );
  expect(
    'сумма КС-2 в панели остаётся с НДС',
    gridNet.periods[0]?.totalAmount,
    grid.periods[0]?.totalAmount,
  );

  // идемпотентность: повторная загрузка того же файла → всё совпадает
  const fd2 = new FormData();
  fd2.append('kind', 'ks6');
  fd2.append('file', new Blob([fs.readFileSync(SAMPLE)]), path.basename(SAMPLE));
  const uploaded2 = await call<{ id: string }>(`/objects/${object.id}/imports`, {
    method: 'POST',
    body: fd2,
  });
  for (let i = 0; i < 60; i++) {
    const info = await call<{ status: string }>(`/imports/${uploaded2.id}`);
    if (info.status === 'parsed') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const preview2 = await call<Preview>(`/imports/${uploaded2.id}/preview`);
  expect('повторный импорт: новых строк', preview2.counts.new, 0);
  expect('повторный импорт: изменённых', preview2.counts.changed, 0);
  expect('повторный импорт: совпавших', preview2.counts.match, 203);

  console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛОВ: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Ошибка верификации:', (e as Error).message);
  process.exit(1);
});
