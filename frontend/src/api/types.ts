export type Role = 'admin' | 'manager' | 'economist';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  position: string;
  role: Role;
}

export interface ConstructionObject {
  id: string;
  code: string;
  name: string;
  address: string;
}

export interface Contract {
  id: string;
  objectId: string;
  number: string;
  amount: string;
  dateSigned: string | null;
  zosDate: string | null;
  customerName: string;
  contractorName: string;
  subject: string;
}

export interface Amendment {
  id: string;
  contractId: string;
  number: string;
  amount: string;
  dateSigned: string | null;
  zosExtensionDate: string | null;
  note: string;
}

export type Ks2Status = 'draft' | 'approved';

export interface PeriodInfo {
  id: string;
  number: string;
  docDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  status: Ks2Status;
  source: 'manual' | 'import';
  importLabel: string | null;
  /** сумма документа с НДС — независимо от режима отображения таблицы */
  totalAmount: string;
  /** ставка на дату периода; 0 — договор без НДС */
  vatRate: number;
  vatAmount: string;
  netAmount: string;
}

/** Режим отображения сумм на странице КС. */
export type VatView = 'gross' | 'net';

export interface PeriodCell {
  qty: string;
  amount: string;
}

export interface GridItemRow {
  type: 'item';
  id: string;
  kind: 'kvr' | 'nomenclature' | 'subline';
  sectionId: string;
  kvrItemId: string | null;
  kvrCode: string;
  name: string;
  characteristic: string;
  unit: string;
  contractQty: string;
  unitPrice: string;
  /** цена как в договоре (с НДС) — для предпросмотра правки объёма */
  unitPriceGross: string;
  materialUnitCost: string | null;
  workUnitCost: string | null;
  contractTotal: string;
  amendmentId: string | null;
  amendmentNumber: string | null;
  sortOrder: number;
  executedQty: string;
  executedAmount: string;
  remainderQty: string;
  remainderAmount: string;
  byPeriod: Record<string, PeriodCell>;
  /** расхождения с исходным Excel; null — сверять не с чем либо сходится до копейки */
  totalMismatch: string | null;
  fileExecutedTotal: string | null;
  executedMismatch: string | null;
}

export interface GridSectionRow {
  type: 'section';
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  sortOrder: number;
  amendmentId: string | null;
  amendmentNumber: string | null;
  contractTotal: string;
  executedAmount: string;
  remainderAmount: string;
  byPeriod: Record<string, string>;
}

export type GridRow = GridSectionRow | GridItemRow;

export interface Ks6Grid {
  contract: Contract | null;
  amendments: Amendment[];
  periods: PeriodInfo[];
  rows: GridRow[];
  totals: {
    contractTotal: string;
    executedAmount: string;
    remainderAmount: string;
    /** режим цен договора: gross — с НДС, net — договор без НДС */
    vatMode: 'gross' | 'net';
    /** режим отображения, в котором посчитаны суммы выше */
    vatView: VatView;
    vatContract: string;
    vatExecuted: string;
    vatRateContract: number;
    byPeriod: Record<string, string>;
    catalogAmount: string;
    catalogMismatch: boolean;
    /** контрольные суммы последнего применённого импорта и расхождения с ними */
    fileContractTotal: string | null;
    contractMismatch: string | null;
    fileExecutedTotal: string | null;
    executedMismatch: string | null;
    fileTotalsSource: { fileName: string; appliedAt: string } | null;
  };
}

export interface Ks2Document {
  id: string;
  contractId: string;
  number: string;
  docDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  status: Ks2Status;
  source: 'manual' | 'import';
  importLabel: string | null;
  createdBy: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  position: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  objects: { id: string; code: string; name: string }[];
}

export type ImportStatus =
  | 'uploaded'
  | 'parsing'
  | 'parsed'
  | 'parse_failed'
  | 'applied'
  | 'discarded';

export interface ImportFileInfo {
  id: string;
  kind: 'psdc' | 'ks6';
  originalName: string;
  sizeBytes: number;
  status: ImportStatus;
  error: string | null;
  createdAt: string;
  sheetName?: string | null;
  summary?: {
    sections: number;
    kvrItems: number;
    nomenclatureItems: number;
    sublineItems?: number;
    ks2Columns: number;
    sheetName?: string;
    sheetCandidates?: {
      name: string;
      state: 'visible' | 'hidden' | 'veryHidden';
      score: number | null;
      rows: number | null;
      periods: number | null;
    }[];
    vat?: { rate: number | null; mode: 'gross' | 'net' | null };
    warnings: string[];
  } | null;
}

export type ItemDiffStatus = 'new' | 'match' | 'changed' | 'missing';

export interface ItemDiff {
  status: ItemDiffStatus;
  staged?: {
    tmpId: string;
    kind: 'kvr' | 'nomenclature' | 'subline';
    kvrCode: string;
    name: string;
    unit: string;
    contractQty: string;
    unitPrice: string;
    contractTotal: string;
    rowNumber: number;
  };
  existingId?: string;
  existingName?: string;
  changes?: { field: string; from: string; to: string }[];
}

export interface Ks2ColumnDiff {
  index: number;
  label: string | null;
  number: string | null;
  monthDate: string | null;
  docDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  cellCount: number;
  totalAmount: string;
  existingDocId: string | null;
  existingDocStatus: string | null;
}

export interface ImportPreview {
  importFileId: string;
  kind: 'psdc' | 'ks6';
  header: {
    contractNumber: string | null;
    contractDate: string | null;
    amendmentNumber: string | null;
    amendmentDate: string | null;
  };
  sections: { tmpId: string; name: string; level: number; exists: boolean }[];
  items: ItemDiff[];
  ks2Columns: Ks2ColumnDiff[];
  counts: { new: number; match: number; changed: number; missing: number };
  controls: {
    contractTotal: string | null;
    vat: string | null;
    executedTotal: string | null;
    computedContractTotal: string;
    computedExecutedTotal: string;
    executedMismatch: string | null;
  };
  warnings: string[];
  structureEmpty: boolean;
  amendmentRequired: boolean;
}

export interface ApplyResult {
  sectionsCreated: number;
  itemsCreated: number;
  itemsUpdated: number;
  ks2Created: number;
  ks2Overwritten: number;
  ks2Skipped: number;
  linesCreated: number;
}
