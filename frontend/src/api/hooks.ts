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
} from './types';

// ---------- объекты ----------

export function useObjects() {
  return useQuery({
    queryKey: ['objects'],
    queryFn: () => api<ConstructionObject[]>('/objects'),
  });
}

export function useSaveObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; code: string; name: string; address: string }) =>
      input.id
        ? api<ConstructionObject>(`/objects/${input.id}`, { method: 'PATCH', body: input })
        : api<ConstructionObject>('/objects', { body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  });
}

export function useDeleteObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/objects/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
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
    },
  });
}

// ---------- КС-6 ----------

export function useKs6Grid(objectId: string | null) {
  return useQuery({
    queryKey: ['ks6', objectId],
    queryFn: () => api<Ks6Grid>(`/objects/${objectId}/ks6`),
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
    }) => api<Ks2Document>(`/objects/${objectId}/ks2`, { body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ks6', objectId] }),
  });
}

export function useKs2Action(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'return' | 'delete' }) =>
      action === 'delete'
        ? api(`/ks2/${id}`, { method: 'DELETE' })
        : api(`/ks2/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ks6', objectId] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ks6', objectId] }),
  });
}

// ---------- импорт ----------

export function useUploadImport(objectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, kind }: { file: File; kind: 'psdc' | 'ks6' }) => {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      return api<ImportFileInfo>(`/objects/${objectId}/imports`, { formData: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['imports', objectId] }),
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
