// Read from runtime config injected by /config.js. Falls back to /api for
// dev (Vite proxy) or if the script hasn't loaded yet.
declare global {
  interface Window {
    __LENS_CONFIG__?: { API_BASE_URL?: string };
  }
}

export const API_BASE = window.__LENS_CONFIG__?.API_BASE_URL ?? '/api';
const BASE = API_BASE;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    throw new ApiError(`API ${res.status} ${path}`, res.status, body);
  }
  return body as T;
}

export type QueueItem = {
  documentId: string;
  filename: string;
  vendorName: string | null;
  total: number | null;
  currency: string | null;
  overallConfidence: number;
  hasError: boolean;
  missingRequiredCount: number;
  uploadedAt: string;
};

export type ValidationResult = {
  name: string;
  severity: 'error' | 'warning';
  passed: boolean;
  message?: string;
  suggestsField?: string;
  suggestsValue?: unknown;
};

export type FieldConfidence = {
  score: number;
  signals: Record<string, number>;
};

export type ExtractionDetail = {
  id: string;
  extractedJson: Record<string, unknown>;
  perFieldConfidence: Record<string, FieldConfidence>;
  overallConfidence: number;
  validationResults: ValidationResult[];
  status: string;
  version: number;
  model?: string;
  costUsd?: number | null;
  latencyMs?: number | null;
};

export type FieldDef =
  | {
      type: 'string' | 'number' | 'money' | 'date' | 'enum';
      required?: boolean;
      description?: string;
      pattern?: string;
      values?: string[];
    }
  | {
      type: 'list';
      required?: boolean;
      description?: string;
      element: Record<string, FieldDef>;
    };

export type DomainSchemaClient = {
  name: string;
  version: number;
  description?: string;
  fields: Record<string, FieldDef>;
  validations?: unknown[];
};

export type ReviewDetail = {
  document: {
    id: string;
    filename: string;
    mimeType: string;
    status: string;
    detectedType: string | null;
  };
  extraction: ExtractionDetail | null;
  schema: DomainSchemaClient | null;
};

export const reviewApi = {
  queue: () => apiFetch<{ queue: QueueItem[] }>('/reviews/queue'),
  detail: (documentId: string) => apiFetch<ReviewDetail>(`/reviews/${documentId}`),
  correct: (documentId: string, body: { fieldPath: string; newValue: unknown; note?: string; expectedVersion?: number }) =>
    apiFetch<ExtractionDetail>(`/reviews/${documentId}/correct`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approve: (documentId: string) =>
    apiFetch<{ ok: true }>(`/reviews/${documentId}/approve`, { method: 'POST' }),
  reject: (documentId: string, reason: string) =>
    apiFetch<{ ok: true }>(`/reviews/${documentId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

export const pdfUrl = (documentId: string) => `${API_BASE}/documents/${documentId}/pdf`;

export type Rule = {
  id: string;
  documentType: string;
  vendor: string;
  fieldPath: string;
  hint: string;
  note: string | null;
  status: 'suggested' | 'adopted' | 'ignored';
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
};

export const rulesApi = {
  list: (status?: Rule['status']) =>
    apiFetch<{ rules: Rule[] }>(`/rules${status ? `?status=${status}` : ''}`),
  adopt: (id: string) => apiFetch<{ ok: true; id: string }>(`/rules/${id}/adopt`, { method: 'POST' }),
  ignore: (id: string) => apiFetch<{ ok: true; id: string }>(`/rules/${id}/ignore`, { method: 'POST' }),
  modify: (id: string, hint: string) =>
    apiFetch<{ ok: true; id: string; hint: string }>(`/rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ hint }),
    }),
};

export type VendorSummary = {
  vendor: string;
  total: number;
  approved: number;
  autoApproved: number;
  pending: number;
  touchlessRate: number;
  lastSeen: string;
};

export type VendorDetail = {
  vendor: string;
  weekly: {
    weekStart: string;
    total: number;
    autoApproved: number;
    approved: number;
    touchlessRate: number;
  }[];
  hotspots: {
    fieldPath: string;
    totalCorrections: number;
    beforeAdopt: number;
    afterAdopt: number;
    adoptedAt: string | null;
  }[];
  adoptedHints: { id: string; hint: string; fieldPath: string; adoptedAt: string }[];
  recentDocuments: {
    id: string;
    filename: string;
    status: string;
    uploadedAt: string;
    confidence: number;
  }[];
};

export const vendorsApi = {
  list: () => apiFetch<{ vendors: VendorSummary[] }>('/vendors'),
  detail: (vendor: string) => apiFetch<VendorDetail>(`/vendors/${encodeURIComponent(vendor)}`),
};

export type Insight = { slug: string; title: string; description: string };
export type InsightDetail = Insight & { sql: string };
export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
};

export const queryApi = {
  insights: () => apiFetch<{ insights: Insight[] }>('/query/insights'),
  insight: (slug: string) => apiFetch<InsightDetail>(`/query/insights/${slug}`),
  run: (sqlText: string) =>
    apiFetch<QueryResult>('/query/run', { method: 'POST', body: JSON.stringify({ sql: sqlText }) }),
};

export type DocumentListItem = {
  id: string;
  filename: string;
  status: string;
  detectedType: string | null;
  detectedTypeConfidence: number | null;
  uploadedAt: string;
  extraction: {
    status: string;
    overallConfidence: number;
    vendorName: string | null;
    total: number | null;
    currency: string | null;
  } | null;
};

export const documentsApi = {
  list: (params?: { limit?: number; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    return apiFetch<{ documents: DocumentListItem[] }>(`/documents${qs ? `?${qs}` : ''}`);
  },
};
