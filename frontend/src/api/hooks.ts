import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './client';
import type {
  AdminUser,
  Amendment,
  ApplyResult,
  ConstructionObject,
  Contract,
  ImportFileInfo,
  ImportPreview,
  Ks2Document,
  Ks6Grid,
  ObjectSummary,
  PartCode,
  VatView,
} from './types';

// ---------- объекты ----------

export function useObjects() {
  return useQuery({
    queryKey: ['objects'],
    queryFn: () => api<ConstructionObject[]>('/objects'),
  });
}

/** Объекты с суммой договора, выполнением и остатком — для карточек стартового экрана. */
export function useObjectsSummary() {
  return useQuery({
    queryKey: ['objects-summary'],
    queryFn: () => api<ObjectSummary[]>('/objects/summary'),
  });
}

export function useSaveObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; code: string; name: string; address: string }) =>
      input.id
        ? api<ConstructionObject>(`/objects/${input.id}`, { method: 'PATCH', body: input })
        : api<ConstructionObject>('/objects', { body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['objects'] });
      qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

export function useDeleteObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/objects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['objects'] });
      qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

// ---------- договор и ДС ----------

export function useContract(objectId: string | null) {
  return useQuery({
    queryKey: ['contract', objectId],
    queryFn: () =>
      api<{ contract: Contract | null; amendments: Amendment[] }>(`/objects/${objectId}/contract`),
    enabled: Boolean(objectId),
  });
}

export function useSaveContract(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Contract>) =>
      api<Contract>(`/objects/${objectId}/contract`, { method: 'PUT', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contract', objectId] });
      void qc.invalidateQueries({ queryKey: ['ks6', objectId] });
      void qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

export function useSaveAmendment(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      contractId: string;
      number: string;
      amount: string;
      dateSigned?: string | null;
      zosExtensionDate?: string | null;
      note?: string;
    }) =>
      input.id
        ? api<Amendment>(`/amendments/${input.id}`, { method: 'PATCH', body: input })
        : api<Amendment>(`/contracts/${input.contractId}/amendments`, { body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contract', objectId] });
      void qc.invalidateQueries({ queryKey: ['ks6', objectId] });
      void qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

export function useDeleteAmendment(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/amendments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contract', objectId] });
      void qc.invalidateQueries({ queryKey: ['ks6', objectId] });
      void qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

// ---------- КС-6 ----------

/**
 * Грид КС-6. Режим НДС входит в ключ запроса, поэтому переключение «с НДС / без НДС»
 * берётся из кеша, а не пересчитывается сервером заново. Инвалидация по префиксу
 * `['ks6', objectId]` гасит оба режима сразу.
 */
export function useKs6Grid(
  objectId: string | null,
  vatView: VatView = 'gross',
  part?: PartCode | null,
) {
  return useQuery({
    queryKey: ['ks6', objectId, vatView, part ?? null],
    queryFn: () =>
      api<Ks6Grid>(`/objects/${objectId}/ks6?vat=${vatView}${part ? `&part=${part}` : ''}`),
    enabled: Boolean(objectId),
    placeholderData: keepPreviousData,
  });
}

// ---------- КС-2 ----------

export function useCreateKs2(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      number: string;
      docDate?: string | null;
      periodFrom?: string | null;
      periodTo?: string | null;
      /** вкладка, в которой создаётся документ */
      part?: PartCode | null;
    }) => api<Ks2Document>(`/objects/${objectId}/ks2`, { body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ks6', objectId] });
      qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

export function useKs2Action(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'return' | 'delete' }) =>
      action === 'delete'
        ? api(`/ks2/${id}`, { method: 'DELETE' })
        : api(`/ks2/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ks6', objectId] });
      qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

/** Удаление всей истории КС-2 по объекту (только admin) — под перезаливку из Excel. */
export function useClearKs2(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ message: string; documents: number; lines: number }>(`/objects/${objectId}/ks2`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ks6', objectId] });
      qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

/**
 * Полная очистка сметы объекта (только admin): строки, разделы и вся история КС-2.
 * Гасим и договор, и сводку по объектам: после очистки меняются обе картины.
 */
export function useClearEstimate(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ message: string; sections: number; items: number; documents: number; lines: number }>(
        `/objects/${objectId}/estimate`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ks6', objectId] });
      qc.invalidateQueries({ queryKey: ['contract', objectId] });
      qc.invalidateQueries({ queryKey: ['objects-summary'] });
      qc.invalidateQueries({ queryKey: ['imports', objectId] });
    },
  });
}

export function useSaveKs2Lines(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lines }: { id: string; lines: { workItemId: string; qty: string }[] }) =>
      api<{ saved: number; totalAmount: string }>(`/ks2/${id}/lines`, {
        method: 'PUT',
        body: { lines },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ks6', objectId] });
      qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

// ---------- импорт ----------

export function useUploadImport(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      kind,
      part,
    }: {
      file: File;
      kind: 'psdc' | 'ks6';
      /** часть сметы для этого листа; по умолчанию единая смета */
      part?: PartCode;
    }) => {
      const fd = new FormData();
      fd.append('kind', kind);
      if (part) fd.append('part', part);
      fd.append('file', file);
      return api<ImportFileInfo>(`/objects/${objectId}/imports`, { formData: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['imports', objectId] }),
  });
}

/**
 * Вторая страница КС из той же книги: файл не перезагружается, создаётся парная
 * запись импорта со своим листом. Обе применяются потом одной транзакцией.
 */
export function useSplitImport(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ importId, sheet }: { importId: string; sheet: string }) =>
      api<{ id: string; batchId: string }>(`/imports/${importId}/split`, { body: { sheet } }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['import', vars.importId] });
      void qc.invalidateQueries({ queryKey: ['imports', objectId] });
    },
  });
}

export function useImportStatus(importId: string | null) {
  return useQuery({
    queryKey: ['import', importId],
    queryFn: () => api<ImportFileInfo>(`/imports/${importId}`),
    enabled: Boolean(importId),
    refetchInterval: (query) => {
      const st = query.state.data?.status;
      return st === 'uploaded' || st === 'parsing' ? 1500 : false;
    },
  });
}

/** Перечитать уже загруженный файл другим листом книги. */
export function useReparseImport(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ importId, sheet }: { importId: string; sheet: string }) =>
      api<{ message: string }>(`/imports/${importId}/reparse`, { body: { sheet } }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['import', vars.importId] });
      void qc.invalidateQueries({ queryKey: ['import-preview', vars.importId] });
      void qc.invalidateQueries({ queryKey: ['imports', objectId] });
    },
  });
}

export function useImportPreview(importId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['import-preview', importId],
    queryFn: () => api<ImportPreview>(`/imports/${importId}/preview`),
    enabled: Boolean(importId) && enabled,
  });
}

export interface ApplyImportInput {
  importId: string;
  amendmentId?: string | null;
  applyChanged: boolean;
  importHistory: boolean;
  overwriteKs2: boolean;
  periods: { index: number; number: string; periodFrom?: string | null; periodTo?: string | null }[];
}

export function useApplyImport(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ importId, ...body }: ApplyImportInput) =>
      api<ApplyResult>(`/imports/${importId}/apply`, { body: { ...body, approveImported: true } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ks6', objectId] });
      void qc.invalidateQueries({ queryKey: ['imports', objectId] });
      void qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

/**
 * Применение обеих страниц книги одним запросом: сервер кладёт их в одну
 * транзакцию, поэтому падение второго листа откатывает и первый.
 */
export function useApplyImportBatch(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, parts }: { batchId: string; parts: ApplyImportInput[] }) =>
      api<ApplyResult>(`/imports/batch/${batchId}/apply`, {
        body: { parts: parts.map((p) => ({ ...p, approveImported: true })) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ks6', objectId] });
      void qc.invalidateQueries({ queryKey: ['imports', objectId] });
      void qc.invalidateQueries({ queryKey: ['objects-summary'] });
    },
  });
}

// ---------- администрирование ----------

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: () => api<AdminUser[]>('/admin/users') });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      email: string;
      fullName: string;
      position: string;
      role: string;
      password: string;
    }) => api<{ id: string }>('/admin/users', { body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function usePatchUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api(`/admin/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useSetUserObjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, objectIds }: { id: string; objectIds: string[] }) =>
      api(`/admin/users/${id}/objects`, { method: 'PUT', body: { objectIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useSetUserPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api(`/admin/users/${id}/set-password`, { body: { password } }),
  });
}
