# AlgoLab

AlgoLab is a local-only coding practice desktop app for LeetCode-style and interview-style exams.

The app is built with Tauri v2, React, Vite, TypeScript, Monaco Editor, SQLite, and local code runners. The first implementation is macOS-first, but the architecture is kept portable for Windows and Linux.

## Scope

Included in the MVP:

- Load local problems from `examples/problems`.
- Display a problem list and problem statement.
- Edit Python and JavaScript solutions in Monaco Editor.
- Save drafts locally.
- Run local solutions against `tests.json`.
- Show passed and failed test results.
- Store submissions in SQLite.
- Enforce a process-level execution timeout.
- Show local runtime/toolchain availability before running code.

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
starter.js
tests.json
```

Only one starter file is required per problem. Python problems use `starter.py`; JavaScript problems use `starter.js`.

## Development

Prerequisites:

- Node.js 20 or newer
- Rust toolchain with Cargo
- Python 3 for Python problems
- Node.js runtime for JavaScript problems
- Platform-specific Tauri dependencies; see [Cross-Platform Development](docs/cross-platform.md)

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

Backend smoke check:

```bash
cd apps/desktop/src-tauri
cargo check
```
