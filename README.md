# LC Lab

LC Lab is a local-only LeetCode-style coding practice desktop app.

The first version targets macOS with Tauri v2, React, Vite, TypeScript, Monaco Editor, SQLite, and a Python runner. The code is structured so the app can be ported to Windows and Linux later.

## Scope

Included in the MVP:

- Load local problems from `examples/problems`.
- Display a problem list and problem statement.
- Edit Python solutions in Monaco Editor.
- Save drafts locally.
- Run Python solutions against `tests.json`.
- Show passed and failed test results.
- Store submissions in SQLite.
- Enforce a process-level execution timeout.

Not included:

- LeetCode scraping.
- Unofficial LeetCode APIs.
- Login.
- Online submission.
- Cloud sync.

## Project Structure

```text
apps/desktop                 Tauri v2 desktop app
packages/core                Shared problem schema, judge types, and storage abstraction
examples/problems/two-sum    Sample local problem
```

Each problem directory contains:

```text
problem.md
meta.json
starter.py
tests.json
```

## Development

Prerequisites:

- Node.js 20 or newer
- Rust toolchain with Cargo
- Python 3

Install dependencies:

```bash
npm install
```

Run the web frontend only:

```bash
npm run dev
```

Run the Tauri desktop app:

```bash
npm --workspace apps/desktop run tauri:dev
```

Build:

```bash
npm run build
```
