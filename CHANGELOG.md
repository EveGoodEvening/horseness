# Changelog

This project follows semantic versioning. Release notes describe the public package train.

## 1.0.0 — 2026-08-16

- Published the complete fifteen-package Horseness train under the MIT License with public npm access.
- Froze all package versions at `1.0.0` and all internal package dependencies at exact `1.0.0` packed-manifest pins.
- Added fail-closed release coherence, reproducible-build, provenance, live-gate, immutable-upload, and receipt tooling.
- Kept the CLI and daemon executables runnable in isolated installs by publishing their TypeScript loader as a production dependency.
- Moved domain vector verification to the repository-only root command; `horseness-vectors-verify` is no longer a public package binary.

## Unreleased

- No changes yet.
