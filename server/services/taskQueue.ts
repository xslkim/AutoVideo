import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseMetaFields, computeSlug } from './projectService.js';
import type { TaskRecord, TaskStatus, Stage, ProgressEvent } from '../types/api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  project: string;
  stage: Stage;
  blockIds?: string[];
  force?: boolean;
}

export type TaskRunFn = (
  task: TaskRecord,
  signal: AbortSignal,
  onProgress: (e: ProgressEvent) => void,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Events emitted by TaskQueue:
//   task:enqueue  (task)
//   task:start    (task)
//   task:progress (task, event)
//   task:complete (task)
//   task:fail     (task)
//   task:cancel   (task)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID();
}

function computeOutputSlug(projectsRoot: string, projectName: string): string {
  const metaPath = path.join(projectsRoot, projectName, 'meta.md');
  if (fs.existsSync(metaPath)) {
    const content = fs.readFileSync(metaPath, 'utf-8');
    const meta = parseMetaFields(content);
    return computeSlug(meta, projectName);
  }
  return projectName;
}

const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// TaskQueue
// ---------------------------------------------------------------------------

export class TaskQueue extends EventEmitter {
  private tasks: Map<string, TaskRecord> = new Map();
  private pendingQueue: string[] = [];  // FIFO queue of task IDs
  private runningId: string | null = null;
  private abortControllers: Map<string, AbortController> = new Map();
  private cancelTimeouts: Map<string, NodeJS.Timeout> = new Map();
  /** Task IDs that the user explicitly requested to cancel. Used to distinguish
   *  user-triggered abort from other abort errors in handleTaskSettled. */
  private cancelledIds: Set<string> = new Set();
  /** When true, reject new task submissions and don't start pending tasks.
   *  Set during SIGINT/SIGTERM graceful shutdown. */
  private shuttingDown = false;

  private projectsRoot: string;
  private tasksFile: string;
  private logsDir: string;
  private taskRunFn: TaskRunFn | null = null;

  constructor(projectsRoot: string, repoRoot: string) {
    super();
    this.projectsRoot = projectsRoot;
    const dataDir = path.join(repoRoot, '.autovideo-web');
    this.tasksFile = path.join(dataDir, 'tasks.jsonl');
    this.logsDir = path.join(dataDir, 'logs');

    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });

    this.loadHistory();
    this.cleanupOldLogs();
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /** Register the function that actually runs a task (taskRunner will provide this). */
  onRun(fn: TaskRunFn): void {
    this.taskRunFn = fn;
  }

  /** Whether the queue is in shutdown mode (rejecting new tasks). */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Graceful shutdown: stop accepting new tasks, abort the current running
   * task, wait for it to settle (with a timeout), clean up old logs, then
   * the caller is expected to exit the process.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    console.log('[taskQueue] Shutting down gracefully...');

    // Abort the current running task
    if (this.runningId) {
      const controller = this.abortControllers.get(this.runningId);
      if (controller) {
        controller.abort();
      }

      // Wait up to 10s for the current task to settle
      const taskId = this.runningId;
      const settleStart = Date.now();
      const maxWait = 10_000;
      while (this.runningId === taskId && Date.now() - settleStart < maxWait) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Clean up old logs
    this.cleanupOldLogs();

    console.log('[taskQueue] Shutdown complete.');
  }

  // -----------------------------------------------------------------------
  // Public API — enqueue / cancel / query
  // -----------------------------------------------------------------------

  /**
   * Create a new task and add it to the FIFO queue.
   * outputSlug is computed from live meta.md at enqueue time.
   */
  enqueue(input: CreateTaskInput): TaskRecord {
    if (this.shuttingDown) {
      throw Object.assign(
        new Error('Server is shutting down, not accepting new tasks'),
        { code: 'ERR_SHUTTING_DOWN' },
      );
    }

    const id = generateId();
    const outputSlug = computeOutputSlug(this.projectsRoot, input.project);

    const task: TaskRecord = {
      id,
      project: input.project,
      stage: input.stage,
      blockIds: input.blockIds,
      force: input.force ?? false,
      outputSlug,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.tasks.set(id, task);
    this.pendingQueue.push(id);
    this.persist(task);
    this.evictOldTasks();

    this.emit('task:enqueue', task);

    // Try to start processing
    this.processNext();

    return { ...task };
  }

  /**
   * Cancel a task.
   * - pending: directly remove from queue, mark cancelled
   * - running: call AbortController.abort(); after 5s timeout → cancelling
   * - completed/failed/cancelled/cancelling: no-op (return current state)
   */
  cancel(taskId: string): TaskRecord | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return { ...task };
    }

    if (task.status === 'cancelling') {
      return { ...task };
    }

    if (task.status === 'pending') {
      // Directly remove from queue
      this.removePending(taskId);
      task.status = 'cancelled';
      task.finishedAt = Date.now();
      task.durationMs = task.finishedAt - task.createdAt;
      this.persist(task);
      this.emit('task:cancel', task);
      return { ...task };
    }

    // status === 'running'
    this.cancelledIds.add(taskId);

    task.status = 'cancelling';
    this.persist(task);

    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
    }

    // Set 5s timeout: if the runFn promise hasn't settled by then, persist cancelling
    const timeout = setTimeout(() => {
      const t = this.tasks.get(taskId);
      if (t && t.status === 'cancelling') {
        this.persist(t);
        this.emit('task:cancel', t);
      }
    }, 5000);

    this.cancelTimeouts.set(taskId, timeout);

    this.emit('task:cancel', task);
    return { ...task };
  }

  getTask(taskId: string): TaskRecord | undefined {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  listTasks(projectFilter?: string, limit: number = MAX_HISTORY): TaskRecord[] {
    let tasks = Array.from(this.tasks.values());
    if (projectFilter) {
      tasks = tasks.filter(t => t.project === projectFilter);
    }
    tasks.sort((a, b) => b.createdAt - a.createdAt);
    return tasks.slice(0, limit).map(t => ({ ...t }));
  }

  getRunningTask(): TaskRecord | null {
    if (!this.runningId) return null;
    const task = this.tasks.get(this.runningId);
    return task ? { ...task } : null;
  }

  getPendingTasks(): TaskRecord[] {
    return this.pendingQueue
      .map(id => this.tasks.get(id))
      .filter((t): t is TaskRecord => t != null)
      .map(t => ({ ...t }));
  }

  // -----------------------------------------------------------------------
  // Public API — task lifecycle (called by taskRunner)
  // -----------------------------------------------------------------------

  /**
   * Update task progress. Called by the runFn's onProgress callback.
   */
  updateProgress(taskId: string, event: ProgressEvent): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.lastProgress = event;
    this.emit('task:progress', { ...task }, event);
  }

  // -----------------------------------------------------------------------
  // Logging
  // -----------------------------------------------------------------------

  appendLog(taskId: string, line: string): void {
    const logPath = path.join(this.logsDir, `${taskId}.log`);
    fs.appendFileSync(logPath, line + '\n', 'utf-8');
  }

  getLog(taskId: string): string {
    const logPath = path.join(this.logsDir, `${taskId}.log`);
    if (!fs.existsSync(logPath)) return '';
    return fs.readFileSync(logPath, 'utf-8');
  }

  // -----------------------------------------------------------------------
  // Internal — queue processing
  // -----------------------------------------------------------------------

  /**
   * Try to start the next pending task.
   * Only starts if nothing is currently running.
   */
  private processNext(): void {
    if (this.shuttingDown) return; // Don't start new tasks during shutdown
    if (this.runningId) return; // Already running

    const nextId = this.pendingQueue.shift();
    if (!nextId) return; // Queue empty

    const task = this.tasks.get(nextId);
    if (!task) {
      this.processNext();
      return;
    }

    this.runningId = nextId;

    if (!this.taskRunFn) {
      // No run function registered — leave the task in pending
      // (WP3.3 will register the run function and resume)
      this.pendingQueue.unshift(nextId);
      this.runningId = null;
      return;
    }

    // Start running
    task.status = 'running';
    task.startedAt = Date.now();
    this.persist(task);

    this.emit('task:start', { ...task });

    const controller = new AbortController();
    this.abortControllers.set(nextId, controller);

    const onProgress = (e: ProgressEvent) => {
      this.updateProgress(nextId, e);
    };

    this.taskRunFn(task, controller.signal, onProgress)
      .then(() => {
        this.handleTaskSettled(nextId, null);
      })
      .catch((err: unknown) => {
        this.handleTaskSettled(nextId, err);
      });
  }

  /**
   * Handle task promise settlement (success or error).
   */
  private handleTaskSettled(taskId: string, err: unknown): void {
    // Clear the cancel timeout if any
    const timeout = this.cancelTimeouts.get(taskId);
    if (timeout) {
      clearTimeout(timeout);
      this.cancelTimeouts.delete(taskId);
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      this.runningId = null;
      this.processNext();
      return;
    }

    const isAbortError =
      err instanceof Error && (err.name === 'AbortError' || err.name === 'CanceledError');
    const wasCancelled = this.cancelledIds.has(taskId);

    if (err && !isAbortError && !wasCancelled && task.status !== 'cancelling') {
      // Actual failure (not caused by user cancel or abort signal)
      task.status = 'failed';
      task.finishedAt = Date.now();
      task.durationMs = task.finishedAt - (task.startedAt ?? task.createdAt);
      task.errorMessage = err instanceof Error ? err.message : String(err);
      task.errorCode = (err as any)?.code;
      task.errorStack = err instanceof Error ? err.stack : undefined;
      this.persist(task);
      this.emit('task:fail', { ...task });
    } else {
      // Completed, cancelled, or cancelling → settled
      if (task.status === 'cancelling') {
        task.status = 'cancelled';
      } else if (wasCancelled || task.status === 'cancelled') {
        task.status = 'cancelled';
      } else {
        task.status = 'completed';
      }
      task.finishedAt = Date.now();
      task.durationMs = task.finishedAt - (task.startedAt ?? task.createdAt);
      this.persist(task);
      this.emit(task.status === 'cancelled' ? 'task:cancel' : 'task:complete', { ...task });
    }

    // Release worker and continue
    this.cancelledIds.delete(taskId);
    this.runningId = null;
    this.abortControllers.delete(taskId);

    // Clean up old logs (beyond 50 most recent, older than 7 days)
    this.cleanupOldLogs();

    this.processNext();
  }

  private removePending(taskId: string): void {
    this.pendingQueue = this.pendingQueue.filter(id => id !== taskId);
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  private persist(task: TaskRecord): void {
    const line = JSON.stringify(task) + '\n';
    fs.appendFileSync(this.tasksFile, line, 'utf-8');
  }

  private loadHistory(): void {
    if (!fs.existsSync(this.tasksFile)) return;

    try {
      const content = fs.readFileSync(this.tasksFile, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.trim().length > 0);

      // Collect unique tasks — last line for each ID wins
      const uniqueTasks = new Map<string, TaskRecord>();
      for (const line of lines) {
        try {
          const task: TaskRecord = JSON.parse(line);
          uniqueTasks.set(task.id, task);
        } catch {
          // skip malformed lines
        }
      }

      // Sort by createdAt descending, keep only the most recent MAX_HISTORY
      const sorted = Array.from(uniqueTasks.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_HISTORY);

      for (const task of sorted) {
        // Tasks that were running/cancelling when the process died → mark as failed
        if (task.status === 'running' || task.status === 'cancelling') {
          task.status = 'failed';
          task.errorMessage = 'Server restarted while task was in progress';
          task.errorCode = 'ERR_SERVER_RESTART';
          task.finishedAt = Date.now();
          task.durationMs = task.finishedAt - (task.startedAt ?? task.createdAt);
          // Persist the updated state
          this.persist(task);
        }

        this.tasks.set(task.id, task);

        // Restore pending tasks to the queue
        if (task.status === 'pending') {
          this.pendingQueue.push(task.id);
        }
      }
    } catch (err) {
      console.error('[taskQueue] Failed to load task history:', err);
    }
  }

  /**
   * Clean up log files beyond 50 most recent tasks, retaining those up to 7 days old.
   * After cleanup, the tasks.jsonl file keeps all history but old log files are pruned.
   */
  private cleanupOldLogs(): void {
    if (!fs.existsSync(this.logsDir)) return;

    try {
      // Gather all task IDs from tasks.jsonl (sorted by createdAt descending)
      const taskEntries: { id: string; createdAt: number }[] = [];
      if (fs.existsSync(this.tasksFile)) {
        const content = fs.readFileSync(this.tasksFile, 'utf-8');
        for (const line of content.trim().split('\n')) {
          if (!line.trim()) continue;
          try {
            const t = JSON.parse(line) as TaskRecord;
            // Keep the latest entry for each ID
            const idx = taskEntries.findIndex((e) => e.id === t.id);
            if (idx >= 0) {
              taskEntries[idx] = { id: t.id, createdAt: t.createdAt };
            } else {
              taskEntries.push({ id: t.id, createdAt: t.createdAt });
            }
          } catch { /* skip malformed lines */ }
        }
      }

      taskEntries.sort((a, b) => b.createdAt - a.createdAt);

      // Build the set of IDs for the 50 most recent tasks
      const recentIds = new Set(taskEntries.slice(0, MAX_HISTORY).map((e) => e.id));

      const now = Date.now();
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

      for (const entry of fs.readdirSync(this.logsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.log')) continue;

        const taskId = entry.name.slice(0, -4); // remove ".log" suffix
        if (recentIds.has(taskId)) continue; // Keep logs for recent 50 tasks

        const logPath = path.join(this.logsDir, entry.name);
        try {
          const stat = fs.statSync(logPath);
          if (now - stat.mtimeMs > SEVEN_DAYS_MS) {
            fs.unlinkSync(logPath);
          }
        } catch { /* ignore stat/unlink errors */ }
      }
    } catch { /* ignore cleanup errors */ }
  }

  /**
   * Remove tasks beyond MAX_HISTORY from memory.
   * The tasks.jsonl file keeps all history; in-memory only holds recent tasks.
   */
  private evictOldTasks(): void {
    if (this.tasks.size <= MAX_HISTORY) return;

    const sorted = Array.from(this.tasks.values())
      .sort((a, b) => b.createdAt - a.createdAt);

    const keepIds = new Set(sorted.slice(0, MAX_HISTORY).map(t => t.id));

    for (const id of this.tasks.keys()) {
      if (!keepIds.has(id)) {
        this.tasks.delete(id);
      }
    }
  }

  /**
   * For testing: simulate task execution without a real runner.
   * Each task completes after a short delay.
   */
  enableAutoRun(delayMs: number = 100): void {
    this.onRun(async (task, signal, onProgress) => {
      onProgress({ percent: 0, step: `开始 ${task.stage}`, stage: task.stage });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      onProgress({ percent: 100, step: `${task.stage} 完成`, stage: task.stage });
    });
  }
}
