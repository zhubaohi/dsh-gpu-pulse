# Changelog

All notable changes to `dsh-gpu-pulse` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project aims to follow [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-08-31

### Added
- Draggable strip: press and drag the widget to any spot on the page; the position persists in `localStorage` (survives new sessions and reboots on the same browser profile). Double-click resets it to the default corner. The strip is clamped to the viewport when the window shrinks.

### Removed
- The expand/collapse toggle: the widget now always renders a single format (the compact strip). The `dsh-gpu-pulse:collapsed` storage key is no longer read.

## [1.1.0] - 2026-08-31

### Changed
- Compact redesign: the card is now a slim strip with one row per GPU (status dot, exact GPU name, utilization, VRAM, temperature, power draw), roughly 85 px tall for two GPUs instead of about 300 px.
- Removed the "GPU Pulse" name tag from the card header and the collapsed state; the collapse button (top-right) stays.
- Removed the per-row meter bars and history sparklines to save space; fan speed is available in the row tooltip.
- The collapsed state is now the same per-GPU rows without header and footer.
- Whole-watt formatting uses no space (`97W`) to keep rows narrow; values >= 1 kW show as `1.20kW`.

## [1.0.1] - 2026-08-31

### Fixed
- The widget no longer disappears when a side panel or side card is opened (for example the `dsh-better-sidebar` Files panel): the client promotes the `shell.overlay` layer to the top of the app's z-stack at runtime, so side cards can never cover it.
- The collapsed state is now a compact chip with one row per GPU, showing the exact GPU name, utilization, temperature and power draw. Previously it was a single line with the maximum values and no power, so expanding was required to see the rest.
- Power draw is now visible without expanding the card.
- Watts below 1 kW are formatted as whole numbers (`86 W` instead of `86.0 W`).

### Changed
- Documented that the display covers every discrete GPU: `nvidia-smi` only reports discrete NVIDIA adapters, so integrated GPUs are never part of the display.

## [1.0.0] - 2026-08-30

### Added
- Floating GPU monitor card in the DSH Web UI (`shell.overlay` slot), bottom-right.
- Live per-GPU utilization, VRAM (used/total), temperature, power draw and fan speed from `nvidia-smi`.
- Multi-GPU support: one instrument block per GPU, header dot warns (amber) / alarms (red) past thresholds.
- History sparklines for utilization and temperature (~45 samples).
- Collapsible card → one-line pill (`GPU 42% · 67°C`), persisted in `localStorage`.
- Optional `TOP PROCESSES` section listing the biggest VRAM consumers (omitted automatically when the driver reports `[N/A]` per-process memory, e.g. most Windows 616.x drivers).
- Graceful degradation to a `GPU n/a` pill on machines without an NVIDIA driver, with a 5-minute re-probe.
- Host route `GET /dsh-gpu-pulse/status` with a ~1.2 s result cache so several open tabs share one `nvidia-smi` process per poll cycle.
- Optional entry config: `pollMs`, `showProcesses`, `nvidiaSmiPath`.
- Bilingual README (English / Chinese).