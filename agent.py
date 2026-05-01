#!/usr/bin/env python3
"""
AutoVideo Autonomous Development Agent
=======================================

Uses Claude API (tool use) to autonomously implement all tasks defined in
TASKS.md following specifications in PRD.md.

Setup:
    pip install anthropic

    API config is auto-read from ~/.claude/settings.json (ANTHROPIC_AUTH_TOKEN,
    ANTHROPIC_BASE_URL, ANTHROPIC_MODEL). No manual env vars needed if Claude
    Code is already configured.

    To override, set environment variables:
        export ANTHROPIC_API_KEY=your-key
        export ANTHROPIC_BASE_URL=https://...

Usage:
    python agent.py [options]

Options:
    --start-task TASK   Start from a specific task (default: auto from PROGRESS.md)
    --stop-task TASK    Stop after completing this task
    --max-tasks N       Max tasks to complete in this run (default: unlimited)
    --max-iters N       Max agent iterations per task (default: 50)
    --max-retries N     Max retries per task on failure (default: 2)
    --model MODEL       Override model (default: auto from Claude Code settings)
    --dry-run           Show plan without executing
    -v, --verbose       Verbose output
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from anthropic import Anthropic
except ImportError:
    print("ERROR: pip install anthropic")
    sys.exit(1)


def load_claude_config() -> dict:
    """Read API key / base URL / model from ~/.claude/settings.json or env."""
    cfg: dict = {}
    # 1. Try Claude Code settings
    settings_path = Path.home() / ".claude" / "settings.json"
    if settings_path.exists():
        try:
            s = json.loads(settings_path.read_text())
            env = s.get("env", {})
            if "ANTHROPIC_AUTH_TOKEN" in env:
                cfg["api_key"] = env["ANTHROPIC_AUTH_TOKEN"]
            if "ANTHROPIC_BASE_URL" in env:
                cfg["base_url"] = env["ANTHROPIC_BASE_URL"]
            if "ANTHROPIC_MODEL" in env:
                cfg["model"] = env["ANTHROPIC_MODEL"]
        except Exception:
            pass
    # 2. Env overrides
    if os.environ.get("ANTHROPIC_API_KEY"):
        cfg["api_key"] = os.environ["ANTHROPIC_API_KEY"]
    if os.environ.get("ANTHROPIC_BASE_URL"):
        cfg["base_url"] = os.environ["ANTHROPIC_BASE_URL"]
    return cfg

# ── Paths ────────────────────────────────────────────────────────────────────

REPO = Path(__file__).resolve().parent
PRD_PATH = REPO / "PRD.md"
TASKS_PATH = REPO / "TASKS.md"
PROGRESS_PATH = REPO / "PROGRESS.md"

TASK_ORDER = [
    "T0.1", "T0.2", "T0.3",
    "T1.1", "T1.2", "T1.3", "T1.4", "T1.5",
    "T2.1", "T2.2",
    "T3.1", "T3.2", "T3.3", "T3.4", "T3.5",
    "T4.1", "T4.2", "T4.3", "T4.4", "T4.5",
    "T5.1", "T5.2", "T5.3", "T5.4",
    "T6.1", "T6.2", "T6.3", "T6.4", "T6.5", "T6.6", "T6.7",
    "T7.1", "T7.2",
    "T8.1", "T8.2", "T8.3",
    "T9.1", "T9.2", "T9.3", "T9.4",
]

# ── Tool definitions ─────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "create_file",
        "description": "Create (or overwrite) a file. Path is relative to repo root.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "relative to repo root"},
                "content": {"type": "string", "description": "full file content"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "edit_file",
        "description": "Replace exact old_string with new_string in a file. old_string must be unique.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_string": {"type": "string"},
                "new_string": {"type": "string"},
            },
            "required": ["path", "old_string", "new_string"],
        },
    },
    {
        "name": "read_file",
        "description": "Read file contents. Returns full text.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "run_command",
        "description": "Run a shell command in the repo root. Returns stdout/stderr/exit_code.",
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "timeout": {"type": "integer", "default": 120},
            },
            "required": ["command"],
        },
    },
    {
        "name": "list_dir",
        "description": "List directory entries.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "default": "."},
            },
        },
    },
    {
        "name": "grep",
        "description": "Search for a regex pattern in files.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string"},
                "path": {"type": "string", "default": "."},
                "glob": {"type": "string", "default": ""},
            },
            "required": ["pattern"],
        },
    },
]


# ── Tool execution ───────────────────────────────────────────────────────────

TRUNCATE = 15_000  # max chars returned per tool result


def _trunc(s: str) -> str:
    if len(s) > TRUNCATE:
        return s[:TRUNCATE] + f"\n... (truncated, {len(s)} chars total)"
    return s


def exec_tool(name: str, inp: dict) -> dict[str, Any]:
    """Execute a tool call with error handling."""
    try:
        return _exec_tool_impl(name, inp)
    except Exception as e:
        return {"ok": False, "error": f"Tool error ({name}): {type(e).__name__}: {e}"}


def _exec_tool_impl(name: str, inp: dict) -> dict[str, Any]:
    if name == "create_file":
        p = REPO / inp["path"]
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(inp["content"], encoding="utf-8")
        return {"ok": True, "msg": f"Created {inp['path']} ({len(inp['content'])} chars)"}

    if name == "edit_file":
        p = REPO / inp["path"]
        if not p.exists():
            return {"ok": False, "error": f"Not found: {inp['path']}"}
        txt = p.read_text(encoding="utf-8")
        old = inp["old_string"]
        if old not in txt:
            # Try to show nearby content for debugging
            return {"ok": False, "error": f"old_string not found in {inp['path']}"}
        if txt.count(old) > 1:
            return {"ok": False, "error": f"old_string appears {txt.count(old)}x, must be unique"}
        p.write_text(txt.replace(old, inp["new_string"], 1), encoding="utf-8")
        return {"ok": True, "msg": f"Edited {inp['path']}"}

    if name == "read_file":
        p = REPO / inp["path"]
        if not p.exists():
            return {"ok": False, "error": f"Not found: {inp['path']}"}
        return {"ok": True, "content": _trunc(p.read_text(encoding="utf-8"))}

    if name == "run_command":
        try:
            r = subprocess.run(
                inp["command"],
                shell=True,
                cwd=str(REPO),
                capture_output=True,
                text=True,
                timeout=inp.get("timeout", 120),
            )
            return {
                "ok": r.returncode == 0,
                "exit_code": r.returncode,
                "stdout": _trunc(r.stdout),
                "stderr": _trunc(r.stderr),
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": f"Timeout ({inp.get('timeout',120)}s)"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if name == "list_dir":
        p = REPO / inp.get("path", ".")
        if not p.exists():
            return {"ok": False, "error": f"Not found: {p}"}
        entries = sorted(
            f"{'[d]' if e.is_dir() else '   '} {e.name}"
            for e in p.iterdir()
            if e.name not in {".git", "node_modules", "dist", "build", "__pycache__", ".cache"}
        )
        return {"ok": True, "entries": entries}

    if name == "grep":
        cmd = ["grep", "-rn", "--color=never", inp["pattern"]]
        if inp.get("glob"):
            cmd += ["--include", inp["glob"]]
        cmd.append(str(REPO / inp.get("path", ".")))
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            return {"ok": True, "output": _trunc(r.stdout), "lines": r.stdout.count("\n")}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return {"ok": False, "error": f"Unknown tool: {name}"}


# ── Parsing ──────────────────────────────────────────────────────────────────

def parse_tasks_md(text: str) -> dict[str, dict]:
    """Extract {task_id: {title, body}} from TASKS.md."""
    tasks: dict[str, dict] = {}
    parts = re.split(r"^### (T\d+\.\d+)\s+", text, flags=re.MULTILINE)
    for i in range(1, len(parts), 2):
        tid = parts[i]
        body = parts[i + 1] if i + 1 < len(parts) else ""
        lines = body.strip().split("\n")
        title = lines[0].strip()
        tasks[tid] = {"id": tid, "title": title, "body": "\n".join(lines).strip()}
    return tasks


def parse_progress_statuses(text: str) -> dict[str, str]:
    """Return {task_id: status} from PROGRESS.md table."""
    out: dict[str, str] = {}
    for m in re.finditer(r"^\|\s*(T\d+\.\d+)\s*\|.*?\|\s*(\w+)\s*\|", text, re.MULTILINE):
        out[m.group(1)] = m.group(2)
    return out


def next_pending(statuses: dict[str, str], start: str | None = None) -> str | None:
    if start:
        return start
    for t in TASK_ORDER:
        if statuses.get(t, "pending") in ("pending", "in_progress"):
            return t
    return None


def file_tree() -> str:
    """Summarize existing project files (skip noise dirs)."""
    skip = {"node_modules", "dist", "build", ".git", "__pycache__", ".cache", ".venv"}
    lines: list[str] = []
    for root, dirs, files in os.walk(REPO):
        dirs[:] = sorted(d for d in dirs if d not in skip)
        rel = Path(root).relative_to(REPO)
        for f in sorted(files):
            p = rel / f
            if str(p) in ("agent.py",):
                continue
            lines.append(str(p))
    return "\n".join(lines[:150]) or "(empty)"


# ── PROGRESS.md manipulation ─────────────────────────────────────────────────

def _read_progress() -> str:
    return PROGRESS_PATH.read_text(encoding="utf-8")


def _write_progress(text: str):
    PROGRESS_PATH.write_text(text, encoding="utf-8")


def _short_hash() -> str:
    r = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True, cwd=str(REPO),
    )
    return r.stdout.strip()


def progress_set_status(task_id: str, status: str, note: str = "—"):
    """Update one row in the PROGRESS.md task table."""
    text = _read_progress()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def _repl(m: re.Match) -> str:
        title = m.group(1)
        if status == "in_progress":
            return f"| {task_id} | {title} | in_progress | {now} | — | — | — |"
        if status == "done":
            h = _short_hash()
            return f"| {task_id} | {title} | done | — | {now} | {h} | — |"
        if status == "blocked":
            return f"| {task_id} | {title} | blocked | {now} | — | — | {note} |"
        return m.group(0)

    pat = rf"^\|\s*{re.escape(task_id)}\s*\|\s*([^|]+?)\s*\|.*$"
    text = re.sub(pat, _repl, text, flags=re.MULTILINE)

    # header fields
    text = re.sub(r"(- \*\*active_task\*\*:).*", rf"\1 `{task_id}`", text)
    text = re.sub(r"(- \*\*last_updated\*\*:).*", rf"\1 `{now}`", text)

    if status == "done":
        # append acceptance record
        h = _short_hash()
        block = (
            f"\n### {task_id} — {task_id} @ {h}\n"
            f"- acceptance: passed by agent\n"
            f"- artifacts: see git diff\n\n"
        )
        text = text.replace("（开发中由 agent 追加）", block + "（开发中由 agent 追加）", 1)

        # count completed
        done_count = len(re.findall(r"\|\s*done\s*\|", text.split("## 验收记录")[0]))
        text = re.sub(
            r"(- \*\*completed\*\*:).*",
            rf"\1 `{done_count} / {len(TASK_ORDER)}`",
            text,
        )
        # next action
        sts = parse_progress_statuses(text)
        nxt = next_pending(sts)
        text = re.sub(
            r"(- \*\*next_action\*\*:).*",
            rf"\1 `{'implement ' + nxt if nxt else 'ALL DONE'}`",
            text,
        )

    _write_progress(text)


# ── Git helpers ───────────────────────────────────────────────────────────────

def git_commit(msg: str):
    subprocess.run(["git", "add", "-A"], cwd=str(REPO), capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", msg],
        cwd=str(REPO), capture_output=True,
    )


def git_is_clean() -> bool:
    r = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(REPO), capture_output=True, text=True,
    )
    return r.stdout.strip() == ""


# ── Agent ────────────────────────────────────────────────────────────────────

class Agent:
    def __init__(self, model: str, verbose: bool, api_key: str | None, base_url: str | None):
        kwargs: dict = {}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        self.cli = Anthropic(**kwargs)
        self.model = model
        self.verbose = verbose
        self.in_tok = 0
        self.out_tok = 0
        print(f"  API base_url={base_url or 'https://api.anthropic.com'}")
        print(f"  API key={'*' * 8 + api_key[-4:] if api_key else '(none)'}")
        print(f"  Model={model}")

    def run(
        self,
        task_id: str,
        task: dict,
        prd: str,
        tree: str,
        max_iters: int = 50,
    ) -> dict:
        """Run one task. Returns {ok, msg}."""

        system = f"""\
You are an autonomous coding agent implementing the AutoVideo project.

## Current task: {task_id} — {task['title']}

{task['body']}

## PRD (authoritative specification):
{prd}

## Current file tree:
{tree}

## Rules
- All paths are relative to repo root ({REPO}).
- Follow the PRD exactly — do not invent features or skip requirements.
- Create directories before files (create_file does this automatically).
- After modifying package.json, always run `npm install`.
- After writing TypeScript, verify with `npx tsc --noEmit` where applicable.
- Run acceptance tests yourself using run_command.
- When ALL acceptance criteria pass, respond with: TASK COMPLETE
- If stuck, respond with: TASK FAILED: <reason>
"""

        messages: list[dict] = [
            {"role": "user", "content": f"Begin implementing task {task_id} — {task['title']}. Start by reading existing files to understand the codebase state, then implement the requirements and run acceptance tests."}
        ]

        for i in range(max_iters):
            resp = self.cli.messages.create(
                model=self.model,
                max_tokens=4096,
                system=system,
                tools=TOOLS,
                messages=messages,
            )

            self.in_tok += resp.usage.input_tokens
            self.out_tok += resp.usage.output_tokens

            if self.verbose:
                stop = resp.stop_reason
                print(f"    iter {i+1:>3}  {stop}  "
                      f"in={resp.usage.input_tokens} out={resp.usage.output_tokens}")

            assistant_blocks = resp.content
            messages.append({"role": "assistant", "content": assistant_blocks})

            # check for completion signals in text blocks
            for b in assistant_blocks:
                if b.type == "text":
                    if "TASK COMPLETE" in b.text:
                        return {"ok": True, "msg": "Agent marked complete"}
                    if "TASK FAILED" in b.text:
                        return {"ok": False, "msg": b.text}

            # execute tool calls
            tool_results: list[dict] = []
            for b in assistant_blocks:
                if b.type == "tool_use":
                    if self.verbose:
                        inp_short = json.dumps(b.input, ensure_ascii=False)[:200]
                        print(f"    -> {b.name}({inp_short})")

                    res = exec_tool(b.name, b.input)

                    if not res.get("ok"):
                        print(f"    !! {b.name} error: {res.get('error', 'unknown')[:200]}")
                    elif self.verbose:
                        print(f"    -> {b.name} OK")

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": b.id,
                        "content": json.dumps(res, ensure_ascii=False),
                    })

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

        return {"ok": False, "msg": f"Max iterations ({max_iters}) reached"}


# ── Runner ───────────────────────────────────────────────────────────────────

def run(args: argparse.Namespace):
    print(f"AutoVideo Agent  |  repo={REPO}")

    # Load API config from Claude Code settings or env
    claude_cfg = load_claude_config()
    api_key = claude_cfg.get("api_key")
    base_url = claude_cfg.get("base_url")
    model = args.model or claude_cfg.get("model", "claude-sonnet-4-6")

    if not api_key:
        print("ERROR: No API key found. Set ANTHROPIC_API_KEY or configure ~/.claude/settings.json")
        sys.exit(1)

    print(f"  model={model}")
    print(f"  base_url={base_url or 'https://api.anthropic.com'}")

    if not git_is_clean():
        print("WARNING: working tree is dirty. Commit or stash before running.")
        if not args.dry_run:
            sys.exit(1)

    prd = PRD_PATH.read_text(encoding="utf-8")
    tasks = parse_tasks_md(TASKS_PATH.read_text(encoding="utf-8"))
    statuses = parse_progress_statuses(_read_progress())

    cur = next_pending(statuses, args.start_task)
    stop_after = args.stop_task
    max_tasks = args.max_tasks
    completed = 0
    consec_fail = 0

    agent = Agent(model=model, verbose=args.verbose, api_key=api_key, base_url=base_url)

    while cur:
        task = tasks.get(cur)
        if not task:
            print(f"ERROR: {cur} not found in TASKS.md")
            break

        print(f"\n{'='*60}")
        print(f"  {cur}  —  {task['title']}")
        print(f"{'='*60}")

        if args.dry_run:
            print("  [dry-run] skip")
            idx = TASK_ORDER.index(cur)
            cur = TASK_ORDER[idx + 1] if idx + 1 < len(TASK_ORDER) else None
            continue

        # ── start ──
        progress_set_status(cur, "in_progress")
        git_commit(f"chore({cur}): start")

        tree = file_tree()
        ok = False
        msg = ""

        for attempt in range(args.max_retries + 1):
            if attempt:
                print(f"  retry {attempt}/{args.max_retries} …")

            r = agent.run(
                task_id=cur,
                task=task,
                prd=prd,
                tree=tree,
                max_iters=args.max_iters,
            )
            ok, msg = r["ok"], r["msg"]
            if ok:
                break
            print(f"  failed: {msg[:120]}")

        # ── finish ──
        if ok:
            print(f"  ✓ {cur} done")
            progress_set_status(cur, "done")
            git_commit(f"feat({cur}): {task['title']}")
            git_commit(f"chore({cur}): done")
            completed += 1
            consec_fail = 0
        else:
            print(f"  ✗ {cur} FAILED: {msg[:120]}")
            progress_set_status(cur, "blocked", note=msg[:60])
            consec_fail += 1
            if consec_fail >= 3:
                print("\nStopping: 3 consecutive failures.")
                break

        if stop_after and cur == stop_after:
            print(f"\nReached --stop-task {stop_after}")
            break
        if max_tasks and completed >= max_tasks:
            print(f"\nReached --max-tasks {max_tasks}")
            break

        # advance
        statuses = parse_progress_statuses(_read_progress())
        cur = next_pending(statuses)

    # ── summary ──
    # Cost estimate (Sonnet pricing, adjust if using proxy)
    cost = agent.in_tok / 1e6 * 3 + agent.out_tok / 1e6 * 15
    print(f"\n{'='*60}")
    print(f"  Done: {completed} tasks")
    print(f"  Tokens: in={agent.in_tok:,}  out={agent.out_tok:,}")
    print(f"  Est. cost: ${cost:.2f}")
    print(f"{'='*60}")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="AutoVideo Autonomous Development Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python agent.py                       # run from where PROGRESS.md left off
  python agent.py --start-task T0.1     # start from a specific task
  python agent.py --max-tasks 3 -v      # run 3 tasks with verbose logging
  python agent.py --dry-run             # show plan without executing
  python agent.py --stop-task T1.5      # stop after T1.5

The script auto-reads API config from ~/.claude/settings.json.
No need to set ANTHROPIC_API_KEY manually if Claude Code is configured.
""",
    )
    ap.add_argument("--start-task", help="Start from specific task (e.g. T0.1)")
    ap.add_argument("--stop-task", help="Stop after completing this task")
    ap.add_argument("--max-tasks", type=int, help="Max tasks to complete this run")
    ap.add_argument("--max-iters", type=int, default=50, help="Max agent iterations per task (default: 50)")
    ap.add_argument("--max-retries", type=int, default=2, help="Max retries per task (default: 2)")
    ap.add_argument("--model", default=None, help="Override model (default: auto from Claude Code settings)")
    ap.add_argument("--dry-run", action="store_true", help="Show plan without executing")
    ap.add_argument("-v", "--verbose", action="store_true", help="Verbose logging")
    run(ap.parse_args())


if __name__ == "__main__":
    main()
