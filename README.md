# dsh-gpu-pulse

A floating GPU monitor inside the DSH Web UI. Live per-GPU **utilization, VRAM, temperature, power and fan** — plus top VRAM-consuming processes when the driver reports them — rendered as a compact card in the corner of the DeepSeek Harness page.

Works on any machine with an NVIDIA driver (Windows or Linux): the data comes from `nvidia-smi`, so multi-GPU rigs show one instrument block per GPU. No extra service to run, no agent tools to call — the card polls the DSH host's own route.

**Note:** the plugin is NVIDIA-only (nvidia-smi backend). On machines without an NVIDIA driver it degrades to a small `GPU — n/a` pill and re-probes every 5 minutes, so it lights up on its own once a driver is installed.

## Install

```sh
# from npm
dsh plugin --profile web add dsh-gpu-pulse

# or from GitHub
dsh plugin --profile web add github:zhubaohi/dsh-gpu-pulse

# or from a local clone
dsh plugin --profile web add /path/to/dsh-gpu-pulse
```

Then restart `dsh web`. The card appears at the bottom-right corner of the GUI; the `–` button collapses it to a one-line pill (`GPU 42% · 67°C`), and the collapsed state persists.

## What you see

- **GPU** — utilization bar + history sparkline (color-graded: green < 60%, amber 60–85%, red ≥ 85%)
- **VRAM** — used/total GiB bar (green < 75%, amber 75–90%, red ≥ 90%)
- **TEMP** — temperature + history sparkline (green < 65 °C, amber 65–80 °C, red ≥ 80 °C)
- **PWR** — power draw + fan speed bar
- **TOP PROCESSES** — the biggest VRAM consumers, when the driver attributes memory per process (most recent Windows drivers report `[N/A]` for graphics contexts, in which case this section is omitted)
- footer: driver (KMD) version + timestamp of the last sample

One block per GPU; the header dot turns amber/red when any GPU crosses its thresholds.

## Configuration

Everything is optional — defaults work out of the box. Override in the profile's `cordis.patch.yml` (an id-targeted patch replaces the whole config, so restate every field you want to keep):

```yaml
- id: dsh-gpu-pulse
  config:
    pollMs: 3000            # client poll interval hint, default 2000, floor 500
    showProcesses: true     # also collect per-process VRAM consumers
    nvidiaSmiPath: 'C:\Windows\System32\nvidia-smi.exe'  # default: "nvidia-smi" via PATH
```

`pollMs` is a *hint* served to the client in every status response, so it applies to all open tabs without a browser-side setting.

## How it works

- **Host** (`index.js`): registers `GET /dsh-gpu-pulse/status` on the DSH host web server. Each request runs up to four `nvidia-smi` queries (`--query-gpu` metrics, `--query-gpu=index,name`, `--version`, and optionally `--query-compute-apps`) with a 4 s timeout, parses the CSV, and returns JSON. Results are cached for ~1.2 s so several open tabs share one process per poll cycle.
- **Client** (`client/client.js`): a hand-written `__ModuleLoader__` bundle (no build step, the only require is the platform `react` seed) that mounts the widget into the `shell.overlay` slot. It polls the status route, keeps a short history for the sparklines, and styles itself with the active theme's `--dsw-*` token variables (static fallbacks keep older hosts readable).

## Requirements

- Node ≥ 18, `dsh web` 0.1.0-rc.6+ (the `shell.overlay` slot)
- An NVIDIA driver with `nvidia-smi` on `PATH` (Windows or Linux)
- No runtime dependencies beyond Node builtins

## License

MIT — see [LICENSE](LICENSE). `nvidia-smi` is a NVIDIA Corporation tool, invoked read-only.