# Cross-Platform Development

AlgoLab is macOS-first today, but the app should stay portable to Windows and Linux. This document tracks the current development requirements and smoke-test checklist for each platform.

## Current Support Status

- macOS: primary development target.
- Windows: planned portability target; runtime resolution supports `py -3` and `python` for Python problems.
- Linux: planned portability target; runtime resolution uses `python3` for Python problems.

The UI stack, SQLite storage, and Tauri shell are intended to be portable. Packaging and full runtime validation still need to be tested on actual Windows and Linux machines.

## Shared Requirements

- Node.js 20 or newer.
- npm.
- Rust and Cargo.
- Python 3 for Python problems.
- Node.js runtime for JavaScript problems.

## Runtime Resolution

AlgoLab checks local runtimes before running code:

- Python on macOS/Linux: `python3 --version`
- Python on Windows: `py -3 --version`, then `python --version`
- JavaScript on all platforms: `node --version`

If the required runtime is missing, the Run action is blocked and the UI shows install guidance.

## Windows Prerequisites

Install the normal Tauri v2 Windows development prerequisites:

- Microsoft C++ Build Tools or Visual Studio with C++ desktop build tools.
- Rust toolchain.
- Node.js 20 or newer.
- WebView2 Runtime. Most supported Windows installations already include it, but it may need to be installed on older systems.
- Python 3 if running Python problems.

Recommended verification:

```powershell
node --version
npm --version
rustc --version
cargo --version
py -3 --version
python --version
```

## Linux Prerequisites

Install the normal Tauri v2 Linux development prerequisites for your distribution. For Debian/Ubuntu-style systems this generally includes:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

Also install:

- Node.js 20 or newer.
- Rust toolchain.
- Python 3 if running Python problems.

Recommended verification:

```bash
node --version
npm --version
rustc --version
cargo --version
python3 --version
```

## Storage And Paths

- SQLite uses Tauri's `app_data_dir()` API, which resolves to the correct per-platform application data directory.
- Local problems currently load from the repository `examples/problems` directory. This is acceptable for local development, but packaged apps should eventually use a user-selectable or app-managed problems directory.
- Problem IDs are restricted to lowercase letters, numbers, and hyphens to keep directory names portable.

## Smoke Test Checklist

Run these checks on each target platform:

```bash
npm install
npm run typecheck
npm run build
cd apps/desktop/src-tauri
cargo check
```

Then run the desktop app:

```bash
npm --workspace apps/desktop run tauri:dev
```

Manual checks:

- The app opens without a blank screen.
- Problems load from `examples/problems`.
- Runtime status is visible in the editor header.
- Python problems run when Python 3 is installed.
- JavaScript problems run when Node.js is installed.
- Missing runtimes show a friendly message and block Run.
- SQLite drafts, notes, and submissions persist after relaunch.

## References

- Tauri v2 prerequisites: https://v2.tauri.app/start/prerequisites/
