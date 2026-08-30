/**
 * dsh-gpu-pulse — client half (hand-written bundle, no build step).
 *
 * Shape: the same CJS factory contract every plugin client bundle uses —
 * `window.__ModuleLoader__.load({ id, factory })`. Executing this file only
 * REGISTERS the factory; it materializes on first import by the client
 * runner. The bundle `require`s exactly one module — the platform seed
 * `react` — so there are no externals to keep in sync with the host build.
 *
 * UI: a floating card in the `shell.overlay` slot (bottom-right of the DSH
 * Web UI) polling GET /dsh-gpu-pulse/status (host half). Renders per-GPU
 * utilization / VRAM / temperature / power + fan rows with sparklines, a
 * top-process list when the host collected compute apps, and a collapsed
 * pill mode persisted in localStorage. Colors follow the active theme via
 * --dsw-* token variables (static fallbacks keep older hosts readable).
 */
window.__ModuleLoader__.load({
  id: "dsh-gpu-pulse",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");
    const h = react.createElement;
    const { useState, useEffect, useRef } = react;

    const NS = "dsh-gpu-pulse";
    const STATUS_PATH = "/dsh-gpu-pulse/status";
    const COLLAPSE_KEY = "dsh-gpu-pulse:collapsed";
    const HISTORY_LEN = 45;
    const MIN_POLL_MS = 1000;

    // ---- tone + formatting helpers -------------------------------------

    const tempTone = (t) => (t == null ? "na" : t < 65 ? "ok" : t < 80 ? "warm" : "hot");
    const memTone = (p) => (p == null ? "na" : p < 75 ? "ok" : p < 90 ? "warm" : "hot");
    const utilTone = (u) => (u == null ? "na" : u < 60 ? "ok" : u < 85 ? "warm" : "hot");

    const fmtGb = (mib) => {
      if (mib == null) return "—";
      const gb = mib / 1024;
      return (gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)) + " GB";
    };
    const fmtW = (w) => (w == null ? "—" : (w >= 100 ? w.toFixed(0) : w.toFixed(1)) + " W");
    const fmtPct = (p) => (p == null ? "—" : Math.round(p) + "%");

    const toneVar = (tone) =>
      tone === "hot" ? "var(--dsw-alias-state-error-primary,#ef4444)"
        : tone === "warm" ? "var(--dsw-static-amber-500,#f59e0b)"
          : "var(--dsw-static-green-500,#22c55e)";

    // ---- stylesheet (injected once; the data-plugin tag lets the HMR
    //      layer claim it for this package's invalidation) ----------------

    const CSS = [
      "." + NS + "{position:fixed;right:16px;bottom:16px;z-index:30;font:12px/1.45 var(--dsw-font-family,-apple-system,'Segoe UI',sans-serif);color:var(--dsw-alias-label-primary,#1f2328);user-select:none;-webkit-user-select:none}",
      "." + NS + "-card{width:316px;background:var(--dsw-alias-bg-overlay,#ffffff);border:1px solid var(--dsw-alias-border-l2,#dcdcdc);border-radius:12px;box-shadow:var(--dsw-shadow-lv2,0 8px 24px rgba(15,15,15,.14));overflow:hidden}",
      "." + NS + "-head{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,130,135,.18))}",
      "." + NS + "-title{flex:1;font-size:12px;font-weight:600;letter-spacing:.02em}",
      "." + NS + "-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-static-green-400,#4ed17e)}",
      "." + NS + "-dot-warn{background:var(--dsw-static-amber-400,#f7ad31)}",
      "." + NS + "-dot-bad{background:var(--dsw-alias-state-error-primary,#ef4444)}",
      "." + NS + "-dot-off{background:var(--dsw-static-neutral-400,#a2a4a6)}",
      "." + NS + "-btn{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#545557);font:inherit;cursor:pointer;padding:2px 7px;border-radius:6px}",
      "." + NS + "-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,130,135,.12))}",
      "." + NS + "-body{padding:4px 10px 8px;max-height:60vh;overflow-y:auto}",
      "." + NS + "-gpu{padding:6px 0;border-bottom:1px dashed var(--dsw-alias-border-l1,rgba(127,130,135,.18))}",
      "." + NS + "-gpu:last-child{border-bottom:0}",
      "." + NS + "-gpuname{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;font-weight:600}",
      "." + NS + "-gpuidx{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary,#545557)}",
      "." + NS + "-row{display:flex;align-items:center;gap:8px;margin:3px 0}",
      "." + NS + "-label{flex:none;width:38px;font-size:11px;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#545557)}",
      "." + NS + "-val{flex:none;width:94px;text-align:right;font-size:11px;font-family:var(--ds-font-family-code,ui-monospace,monospace)}",
      "." + NS + "-val-warm{color:var(--dsw-static-amber-500,#f59e0b)}",
      "." + NS + "-val-hot{color:var(--dsw-alias-state-error-primary,#ef4444)}",
      "." + NS + "-bar{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-module-hover,rgba(127,130,135,.16));overflow:hidden}",
      "." + NS + "-barfill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary,#4176e6);transition:width .5s ease}",
      "." + NS + "-barfill-ok{background:var(--dsw-static-green-400,#4ed17e)}",
      "." + NS + "-barfill-warm{background:var(--dsw-static-amber-400,#f7ad31)}",
      "." + NS + "-barfill-hot{background:var(--dsw-alias-state-error-primary,#ef4444)}",
      "." + NS + "-spark{flex:none}",
      "." + NS + "-procs{margin-top:6px}",
      "." + NS + "-procstitle{margin-bottom:2px;font-size:11px;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#545557)}",
      "." + NS + "-proc{display:flex;justify-content:space-between;gap:8px;font-size:11px;font-family:var(--ds-font-family-code,ui-monospace,monospace)}",
      "." + NS + "-procname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "." + NS + "-foot{display:flex;justify-content:space-between;gap:8px;padding:6px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,130,135,.18));font-size:11px;color:var(--dsw-alias-label-secondary,#545557)}",
      "." + NS + "-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:var(--dsw-alias-bg-overlay,#ffffff);border:1px solid var(--dsw-alias-border-l2,#dcdcdc);box-shadow:var(--dsw-shadow-lv2,0 8px 24px rgba(15,15,15,.14));font-size:12px;cursor:pointer}",
      "." + NS + "-pill:hover{border-color:var(--dsw-alias-brand-primary,#4176e6)}",
      "." + NS + "-pillsub{font-size:11px;color:var(--dsw-alias-label-secondary,#545557);max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
    ].join("\n");

    // ---- small components -----------------------------------------------

    /** Tiny polyline history chart; values are clamped to [min, max]. */
    function Sparkline(props) {
      const ref = useRef(null);
      useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
        const W = props.width;
        const H = props.height;
        canvas.width = Math.max(1, Math.round(W * dpr));
        canvas.height = Math.max(1, Math.round(H * dpr));
        const g = canvas.getContext("2d");
        if (!g) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        const vals = (props.data || []).slice(-HISTORY_LEN);
        const span = Math.max(1, props.max - props.min);
        const pts = [];
        vals.forEach((v, i) => {
          if (v == null) return;
          const x = (i / Math.max(1, vals.length - 1)) * (W - 2) + 1;
          const y = H - 2 - ((Math.max(props.min, Math.min(props.max, v)) - props.min) / span) * (H - 4);
          pts.push([x, y]);
        });
        if (pts.length < 2) return;
        g.strokeStyle = props.color;
        g.lineWidth = 1.4;
        g.lineJoin = "round";
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.stroke();
      });
      return h("canvas", { ref, className: NS + "-spark", style: { width: props.width + "px", height: props.height + "px" } });
    }

    /** Meter bar; tone colors the fill, `null` pct renders an empty track. */
    function Bar(props) {
      const w = props.pct == null ? 0 : Math.max(0, Math.min(100, props.pct));
      const tone = props.tone === "na" ? "" : " " + NS + "-barfill-" + props.tone;
      return h("div", { className: NS + "-bar" }, h("div", { className: NS + "-barfill" + tone, style: { width: w + "%" } }));
    }

    /** One GPU: name + four instrument rows (util / VRAM / TEMP / PWR). */
    function GpuBlock(props) {
      const g = props.gpu;
      const rec = props.history[g.index];
      const memPct = g.memTotalMiB ? (g.memUsedMiB / g.memTotalMiB) * 100 : null;
      return h("div", { className: NS + "-gpu" },
        h("div", { className: NS + "-gpuname" },
          h("span", null, g.name),
          g.index != null ? h("span", { className: NS + "-gpuidx" }, "GPU" + g.index) : null
        ),
        h("div", { className: NS + "-row", title: "GPU utilization" },
          h("span", { className: NS + "-label" }, "GPU"),
          h(Bar, { pct: g.util, tone: utilTone(g.util) }),
          h(Sparkline, { width: 70, height: 16, min: 0, max: 100, data: rec ? rec.util : [], color: toneVar(utilTone(g.util)) }),
          h("span", { className: NS + "-val" + (utilTone(g.util) === "hot" ? " " + NS + "-val-hot" : utilTone(g.util) === "warm" ? " " + NS + "-val-warm" : "") }, fmtPct(g.util))
        ),
        h("div", { className: NS + "-row", title: "VRAM used / total" },
          h("span", { className: NS + "-label" }, "VRAM"),
          h(Bar, { pct: memPct, tone: memTone(memPct) }),
          h("span", { className: NS + "-val" + (memTone(memPct) === "hot" ? " " + NS + "-val-hot" : memTone(memPct) === "warm" ? " " + NS + "-val-warm" : "") }, fmtGb(g.memUsedMiB) + " / " + fmtGb(g.memTotalMiB))
        ),
        h("div", { className: NS + "-row", title: "GPU temperature" },
          h("span", { className: NS + "-label" }, "TEMP"),
          h(Sparkline, { width: 70, height: 16, min: 30, max: 95, data: rec ? rec.temp : [], color: toneVar(tempTone(g.temp)) }),
          h("span", { className: NS + "-val " + NS + "-val-" + tempTone(g.temp) }, g.temp == null ? "—" : Math.round(g.temp) + "°C")
        ),
        h("div", { className: NS + "-row", title: "Power draw · fan speed" },
          h("span", { className: NS + "-label" }, "PWR"),
          h(Bar, { pct: g.fanPct, tone: g.fanPct != null && g.fanPct > 75 ? "warm" : "ok" }),
          h("span", { className: NS + "-val" }, fmtW(g.powerW) + " · " + fmtPct(g.fanPct))
        )
      );
    }

    // ---- top-level widget ------------------------------------------------

    function GpuWidget() {
      const [data, setData] = useState(null);
      const [collapsed, setCollapsed] = useState(() => {
        try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch (e) { return false; }
      });
      const historyRef = useRef({});
      const pollMsRef = useRef(2000);
      const inFlight = useRef(false);

      useEffect(() => {
        try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (e) { /* private mode */ }
      }, [collapsed]);

      useEffect(() => {
        let stopped = false;
        let timer = 0;
        const poll = () => {
          if (inFlight.current) return;
          inFlight.current = true;
          fetch(STATUS_PATH, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
            .then((p) => {
              if (p && p.config && Number.isFinite(p.config.pollMs)) pollMsRef.current = Math.max(MIN_POLL_MS, p.config.pollMs);
              if (p && p.ok && Array.isArray(p.gpus)) {
                const hist = historyRef.current;
                for (const g of p.gpus) {
                  const rec = hist[g.index] || (hist[g.index] = { util: [], temp: [] });
                  rec.util.push(g.util);
                  rec.temp.push(g.temp);
                  if (rec.util.length > HISTORY_LEN) rec.util.shift();
                  if (rec.temp.length > HISTORY_LEN) rec.temp.shift();
                }
              }
              setData(p || null);
            })
            .catch(() => { /* transport hiccup: keep the last snapshot on screen */ })
            .then(() => { inFlight.current = false; });
        };
        const tick = () => {
          if (stopped) return;
          poll();
          timer = setTimeout(tick, pollMsRef.current);
        };
        poll();
        timer = setTimeout(tick, pollMsRef.current);
        return () => { stopped = true; clearTimeout(timer); };
      }, []);

      // Loading / driver-missing: a quiet pill, not a card.
      if (data == null) {
        return h("div", { className: NS },
          h("div", { className: NS + "-pill", title: "GPU Pulse — waiting for the first sample" },
            h("span", { className: NS + "-dot " + NS + "-dot-off" }),
            h("span", null, "GPU"),
            h("span", { className: NS + "-pillsub" }, "…")));
      }
      if (!data.ok) {
        return h("div", { className: NS },
          h("div", { className: NS + "-pill", title: data.reason || "GPU telemetry unavailable" },
            h("span", { className: NS + "-dot " + NS + "-dot-off" }),
            h("span", null, "GPU"),
            h("span", { className: NS + "-pillsub" }, (data.reason || "n/a").slice(0, 90))));
      }

      const gpus = data.gpus || [];
      const worst =
        Math.max(0, ...gpus.map((g) => g.temp ?? 0)) >= 80 || Math.max(0, ...gpus.map((g) => g.util ?? 0)) >= 95 ? "bad"
          : Math.max(0, ...gpus.map((g) => g.temp ?? 0)) >= 65 || Math.max(0, ...gpus.map((g) => g.util ?? 0)) >= 85 ? "warn"
            : "ok";

      if (collapsed) {
        const maxUtil = gpus.reduce((m, g) => Math.max(m, g.util ?? 0), 0);
        const maxTemp = gpus.reduce((m, g) => Math.max(m, g.temp ?? 0), 0);
        return h("div", { className: NS },
          h("div", { className: NS + "-pill", title: "GPU Pulse — click to expand", onClick: () => setCollapsed(false) },
            h("span", { className: NS + "-dot " + NS + "-dot-" + worst }),
            h("span", null, "GPU"),
            h("span", { className: NS + "-pillsub" },
              gpus.length === 0 ? "no GPUs" :
                Math.round(maxUtil) + "% · " + (maxTemp === 0 ? "—" : Math.round(maxTemp) + "°C"))));
      }

      const gpusEl = gpus.length === 0
        ? h("div", { className: NS + "-pillsub" }, "nvidia-smi reported no GPUs")
        : gpus.map((g) => h(GpuBlock, { key: g.index != null ? g.index : g.name, gpu: g, history: historyRef.current }));

      let procsEl = null;
      if (data.processes && data.processes.length > 0) {
        const rows = data.processes.slice(0, 5).map((p) =>
          h("div", { key: p.pid, className: NS + "-proc" },
            h("span", { className: NS + "-procname", title: p.name }, p.name),
            h("span", null, fmtGb(p.usedMiB)))
        );
        procsEl = h("div", { className: NS + "-procs" },
          h("div", { className: NS + "-procstitle" }, "TOP PROCESSES (VRAM)"),
          rows
        );
      }

      return h("div", { className: NS },
        h("div", { className: NS + "-card" },
          h("div", { className: NS + "-head" },
            h("span", { className: NS + "-dot " + NS + "-dot-" + worst }),
            h("span", { className: NS + "-title" }, "GPU Pulse"),
            h("button", { className: NS + "-btn", title: "Collapse to a pill", onClick: () => setCollapsed(true) }, "–")
          ),
          h("div", { className: NS + "-body" }, gpusEl, procsEl),
          h("div", { className: NS + "-foot" },
            h("span", null, "driver " + (data.driverVersion || "—") + " · " + data.backend),
            h("span", { title: "last sample at" }, new Date(data.ts).toLocaleTimeString())
          )
        )
      );
    }

    // ---- plugin entry ----------------------------------------------------

    function apply(ctx) {
      const slots = ctx && ctx.slots;
      if (!slots) {
        console.warn("[dsh-gpu-pulse] slots service unavailable — widget disabled");
        return;
      }
      const style = document.createElement("style");
      style.setAttribute("data-plugin", NS);
      style.textContent = CSS;
      document.head.appendChild(style);
      ctx.effect(() => () => style.remove(), NS + ": stylesheet");
      slots.inject("shell.overlay", () =>
        slots.register(
          { name: "shell.overlay", id: NS, order: 50, label: () => "GPU Pulse" },
          () => h(GpuWidget, null)
        )
      );
    }

    exports.name = "dsh-gpu-pulse";
    exports.inject = ["slots"];
    exports.apply = apply;
    return module.exports;
  }
});