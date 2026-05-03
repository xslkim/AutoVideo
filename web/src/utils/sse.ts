import type { ProgressEvent } from '../../../server/types/api'

// ---------------------------------------------------------------------------
// Handler callbacks
// ---------------------------------------------------------------------------

export interface SSEHandlers {
  onProgress: (data: ProgressEvent) => void
  onDone: (data: { status: string; durationMs: number }) => void
  onError: (data: { message: string; code: string; stage: string }) => void
  onCancelled: (data: { durationMs: number }) => void
}

// ---------------------------------------------------------------------------
// connectSSE — SSE connection with exponential backoff
//
// - Connects to GET /api/tasks/:id/events
// - On connection loss: calls onBeforeReconnect to sync state, then reconnects
//   with exponential backoff (1s → 2s → 4s → … → max 30s)
// - Returns { close } to permanently close the connection
// ---------------------------------------------------------------------------

export function connectSSE(
  taskId: string,
  handlers: SSEHandlers,
  onBeforeReconnect: () => Promise<void>,
): { close: () => void } {
  let backoff = 1000
  const MAX_BACKOFF = 30000
  let es: EventSource | null = null
  let closed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let sseErrorReceived = false

  function connect() {
    if (closed) return

    es = new EventSource(`/api/tasks/${taskId}/events`)

    es.addEventListener('progress', (e: Event) => {
      const me = e as MessageEvent
      if (me.data) {
        try { handlers.onProgress(JSON.parse(me.data)) } catch { /* ignore malformed */ }
      }
    })

    es.addEventListener('done', (e: Event) => {
      const me = e as MessageEvent
      if (me.data) {
        try { handlers.onDone(JSON.parse(me.data)) } catch { /* ignore */ }
        cleanup()
      }
    })

    es.addEventListener('cancelled', (e: Event) => {
      const me = e as MessageEvent
      if (me.data) {
        try { handlers.onCancelled(JSON.parse(me.data)) } catch { /* ignore */ }
        cleanup()
      }
    })

    // The SSE server sends "event: error" which fires this listener.
    // We distinguish it from a connection-level error by checking me.data.
    es.addEventListener('error', (e: Event) => {
      const me = e as MessageEvent
      if (me.data) {
        // Server-sent error event
        sseErrorReceived = true
        try { handlers.onError(JSON.parse(me.data)) } catch { /* ignore */ }
        cleanup()
      }
      // If no data, it's a connection-level error — handled by onerror below
    })

    // Connection-level error (network, non-200, wrong Content-Type)
    es.onerror = async () => {
      if (sseErrorReceived) {
        sseErrorReceived = false
        return // Already handled by the addEventListener('error', …) above
      }

      // Close the broken connection
      if (es) { es.close(); es = null }
      if (closed) return

      // Sync latest task state before reconnecting
      try { await onBeforeReconnect() } catch { /* ignore */ }

      if (closed) return

      // Reconnect with exponential backoff
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        backoff = Math.min(backoff * 2, MAX_BACKOFF)
        connect()
      }, backoff)
    }
  }

  function cleanup() {
    closed = true
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (es) { es.close(); es = null }
  }

  connect()

  return { close: cleanup }
}
