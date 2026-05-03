import { createDiscreteApi } from 'naive-ui'

const { message } = createDiscreteApi(['message'])

// ---------------------------------------------------------------------------
// ETag cache: url → etag
// ---------------------------------------------------------------------------

const etagCache = new Map<string, string>()

export function getEtag(url: string): string | undefined {
  return etagCache.get(url)
}

export function setEtag(url: string, etag: string): void {
  etagCache.set(url, etag)
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ConflictData {
  currentContent: string
  currentEtag: string
}

export interface ApiError {
  message: string
  status: number
}

export type ApiResult<T> =
  | { ok: true; data: T; etag?: string }
  | { ok: false; conflict: ConflictData; error?: undefined }
  | { ok: false; conflict?: undefined; error: ApiError }

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  opts: { silent?: boolean } = {},
): Promise<ApiResult<T>> {
  try {
    const resp = await fetch(url, options)

    if (resp.status === 409) {
      const body = await resp.json() as ConflictData
      return { ok: false, conflict: body }
    }

    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`
      try {
        const err = await resp.json() as { error?: { message?: string } }
        if (err.error?.message) msg = err.error.message
      } catch { /* ignore */ }
      if (!opts.silent) message.error(msg)
      return { ok: false, error: { message: msg, status: resp.status } }
    }

    const etag = resp.headers.get('ETag') ?? undefined
    if (etag) etagCache.set(url, etag)

    const data = await resp.json() as T
    return { ok: true, data, etag }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!opts.silent) message.error(msg)
    return { ok: false, error: { message: msg, status: 0 } }
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export function apiGet<T>(url: string, opts?: { silent?: boolean }): Promise<ApiResult<T>> {
  return apiFetch<T>(url, {}, opts)
}

export function apiPut<T>(
  url: string,
  body: unknown,
  ifMatch?: string,
  opts?: { silent?: boolean },
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (ifMatch) headers['If-Match'] = ifMatch
  return apiFetch<T>(url, { method: 'PUT', headers, body: JSON.stringify(body) }, opts)
}

export function apiPost<T>(
  url: string,
  body?: unknown,
  opts?: { silent?: boolean },
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  return apiFetch<T>(
    url,
    { method: 'POST', headers, body: body !== undefined ? JSON.stringify(body) : undefined },
    opts,
  )
}

export function apiDelete<T>(
  url: string,
  opts?: { silent?: boolean },
): Promise<ApiResult<T>> {
  return apiFetch<T>(url, { method: 'DELETE' }, opts)
}
