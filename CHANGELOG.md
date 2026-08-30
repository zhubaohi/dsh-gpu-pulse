# Changelog

All notable changes to `dsh-gpu-pulse` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project aims to follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-08-30

### Added
- Floating GPU monitor card in the DSH Web UI (`shell.overlay` slot), bottom-right.
- Live per-GPU utilization, VRAM (used/total), temperature, power draw and fan speed from `nvidia-smi`.
- Multi-GPU support: one instrument block per GPU, header dot warns (amber) / alarms (red) past thresholds.
- History sparklines for utilization and temperature (~45 samples).
- Collapsible card → one-line pill (`GPU 42% · 67°C`), persisted in `localStorage`.
- Optional `TOP PROCESSES` section listing the biggest VRAM consumers (omitted automatically when the driver reports `[N/A]` per-process memory, e.g. most Windows 616.x drivers).
- Graceful degradation to a `GPU — n/a` pill on machines without an NVIDIA driver, with a 5-minute re-probe.
- Host route `GET /dsh-gpu-pulse/status` with a ~1.2 s result cache so several open tabs share one `nvidia-smi` process per poll cycle.
- Optional entry config: `pollMs`, `showProcesses`, `nvidiaSmiPath`.
- Bilingual README (English / Chinese).