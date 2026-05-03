/**
 * Task API + SSE routes — WEB_PRD.md §5.4
 *
 * Endpoints:
 *   GET    /api/tasks              → task list (last 50, ?project= filter)
 *   GET    /api/tasks/:id          → task detail
 *   POST   /api/tasks              → create task
 *   DELETE /api/tasks/:id          → cancel task
 *   GET    /api/tasks/:id/events   → SSE progress stream
 *   GET    /api/tasks/:id/log      → full log (text/plain)
 */

import { Hono } from 'hono';
import { TaskQueue } from '../services/taskQueue.js';
import type { Stage, TaskRecord, ProgressEvent } from '../types/api.js';

const STAGES_WITH_BLOCK_IDS: Stage[] = ['tts', 'visuals', 'render'];

const VALID_STAGES: Stage[] = ['compile', 'tts', 'visuals', 'render', 'build', 'merge'];

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createTaskRoutes(taskQueue: TaskQueue) {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/tasks — task list (last 50, optional ?project= filter)
  // -------------------------------------------------------------------------
  app.get('/', (c) => {
    const project = c.req.query('project');
    const tasks = taskQueue.listTasks(project || undefined);
    return c.json(tasks);
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks — create a new task
  // body: { project, stage, blockIds?, force? }
  // -------------------------------------------------------------------------
  app.post('/', async (c) => {
    const body = await c.req.json<{
      project: string;
      stage: Stage;
      blockIds?: string[];
      force?: boolean;
    }>();

    // Validate required fields
    if (!body.project || typeof body.project !== 'string') {
      return c.json(
        { error: { code: 'ERR_INVALID_BODY', message: 'project is required' } },
        400,
      );
    }

    if (!body.stage || !VALID_STAGES.includes(body.stage)) {
      return c.json(
        { error: { code: 'ERR_INVALID_BODY', message: `stage must be one of: ${VALID_STAGES.join(', ')}` } },
        400,
      );
    }

    // blockIds only accepted for tts/visuals/render
    if (body.blockIds && body.blockIds.length > 0) {
      if (!STAGES_WITH_BLOCK_IDS.includes(body.stage)) {
        return c.json(
          {
            error: {
              code: 'ERR_INVALID_BLOCK_IDS',
              message: `blockIds not accepted for stage "${body.stage}". Only tts/visuals/render accept blockIds.`,
            },
          },
          400,
        );
      }
    }

    const task = taskQueue.enqueue({
      project: body.project,
      stage: body.stage,
      blockIds: body.blockIds,
      force: body.force ?? false,
    });

    return c.json(task, 201);
  });

  // -------------------------------------------------------------------------
  // GET /api/tasks/:id — task detail
  // -------------------------------------------------------------------------
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const task = taskQueue.getTask(id);
    if (!task) {
      return c.json(
        { error: { code: 'ERR_NOT_FOUND', message: `Task ${id} not found` } },
        404,
      );
    }
    return c.json(task);
  });

  // -------------------------------------------------------------------------
  // DELETE /api/tasks/:id — cancel a task
  // -------------------------------------------------------------------------
  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    const task = taskQueue.cancel(id);
    if (!task) {
      return c.json(
        { error: { code: 'ERR_NOT_FOUND', message: `Task ${id} not found` } },
        404,
      );
    }
    return c.json(task);
  });

  // -------------------------------------------------------------------------
  // GET /api/tasks/:id/events — SSE progress stream
  //
  // Event format (WEB_PRD.md §5.4):
  //   event: progress
  //   data: {"percent":60,"step":"...","stage":"...","blockId":"..."}
  //
  //   event: done
  //   data: {"status":"completed","durationMs":12340}
  //
  //   event: error
  //   data: {"message":"...","code":"ERR_...","stage":"..."}
  //
  //   event: cancelled
  //   data: {"durationMs":3210}
  //
  // Exit order: progress(100) → done|error|cancelled → close
  // -------------------------------------------------------------------------
  app.get('/:id/events', (c) => {
    const id = c.req.param('id');
    const task = taskQueue.getTask(id);
    if (!task) {
      return c.json(
        { error: { code: 'ERR_NOT_FOUND', message: `Task ${id} not found` } },
        404,
      );
    }

    let closed = false;

    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const emit = (event: string, data: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
          } catch {
            closed = true;
          }
        };

        // ── If task is already in a terminal state, send final event and close ──
        if (task.status === 'completed') {
          emit(
            'done',
            JSON.stringify({ status: 'completed', durationMs: task.durationMs }),
          );
          controller.close();
          return;
        }
        if (task.status === 'failed') {
          emit(
            'error',
            JSON.stringify({
              message: task.errorMessage,
              code: task.errorCode,
              stage: task.stage,
            }),
          );
          controller.close();
          return;
        }
        if (task.status === 'cancelled') {
          emit(
            'cancelled',
            JSON.stringify({ durationMs: task.durationMs }),
          );
          controller.close();
          return;
        }

        // ── Subscribe to task events ──

        const onProgress = (t: TaskRecord, event: ProgressEvent) => {
          if (t.id !== id) return;
          emit('progress', JSON.stringify(event));
        };

        const onComplete = (t: TaskRecord) => {
          if (t.id !== id) return;
          emit(
            'done',
            JSON.stringify({ status: 'completed', durationMs: t.durationMs }),
          );
          unsubscribe();
          controller.close();
        };

        const onFail = (t: TaskRecord) => {
          if (t.id !== id) return;
          emit(
            'error',
            JSON.stringify({
              message: t.errorMessage,
              code: t.errorCode,
              stage: t.stage,
            }),
          );
          unsubscribe();
          controller.close();
        };

        const onCancel = (t: TaskRecord) => {
          if (t.id !== id) return;
          if (t.status === 'cancelling') {
            // Still waiting for the runFn to settle; emit a progress event
            // instead of closing the stream (A.4.2).
            emit(
              'progress',
              JSON.stringify({
                percent: 100,
                step: '正在强制停止...',
                stage: t.stage,
              }),
            );
          } else {
            // status === 'cancelled' — terminal
            emit(
              'cancelled',
              JSON.stringify({ durationMs: t.durationMs }),
            );
            unsubscribe();
            controller.close();
          }
        };

        const unsubscribe = () => {
          taskQueue.off('task:progress', onProgress);
          taskQueue.off('task:complete', onComplete);
          taskQueue.off('task:fail', onFail);
          taskQueue.off('task:cancel', onCancel);
        };

        taskQueue.on('task:progress', onProgress);
        taskQueue.on('task:complete', onComplete);
        taskQueue.on('task:fail', onFail);
        taskQueue.on('task:cancel', onCancel);

        // Handle client disconnect — clean up listeners
        c.req.raw.signal.addEventListener(
          'abort',
          () => {
            unsubscribe();
            closed = true;
          },
          { once: true },
        );
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/tasks/:id/log — full log text
  // -------------------------------------------------------------------------
  app.get('/:id/log', (c) => {
    const id = c.req.param('id');
    const task = taskQueue.getTask(id);
    if (!task) {
      return c.json(
        { error: { code: 'ERR_NOT_FOUND', message: `Task ${id} not found` } },
        404,
      );
    }
    const log = taskQueue.getLog(id);
    return c.text(log || '');
  });

  return app;
}
