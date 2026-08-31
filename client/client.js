/**
 * dsh-gpu-pulse — client half (hand-written bundle, no build step).
 *
 * Shape: the same CJS factory contract every plugin client bundle uses —
 * `window.__ModuleLoader__.load({ id, factory })`. Executing this file only
 * REGISTERS the factory; it materializes on first import by the client
 * runner. The bundle `require`s exactly one module — the platform seed
 * `react` — so there are no externals to keep in sync with the host build.
 *
 * UI: a compact floating strip in the `shell.overlay` slot (the DSH Web UI)
 * polling GET /dsh-gpu-pulse/status (host half). It always renders the same
 * format: one row per discrete GPU (integrated GPUs are not exposed by
 * nvidia-smi) with status dot, exact GPU name, utilization, VRAM,
 * temperature and power draw, plus a top-process list when the host
 * collected compute apps, and a slim footer. The strip is draggable: the
 * pointer position persists in localStorage (survives new sessions and
 * reboots on the same browser profile); double-clicking resets it to the
 * default corner. At runtime the widget promotes the overlay layer's
 * z-index so side-card plugins (dsh-better-sidebar) cannot cover it. Colors
 * follow the active theme via --dsw-* token variables (static fallbacks
 * keep older hosts readable).
 */
window.__ModuleLoader__.load({
  id: "dsh-gpu-pulse",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");
    const h = react.createElement;
    const { useState, useEffect, useRef, useCallback } = react;

    const NS = "dsh-gpu-pulse";
    const STATUS_PATH = "/dsh-gpu-pulse/status";
    const POS_KEY = "dsh-gpu-pulse:pos";
    const MIN_POLL_MS = 1000;

    // ---- position persistence -------------------------------------------

    function loadPos() {
      try {
        const raw = localStorage.getItem(POS_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
      } catch (e) { /* bad storage: fall back to the default corner */ }
      return null;
    }
    function savePos(p) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) { /* private mode */ }
    }
    function clearPos() {
      try { localStorage.removeItem(POS_KEY); } catch (e) { /* private mode */ }
    }

    // ---- tone + formatting helpers -------------------------------------

    const tempTone = (t) => (t == null ? "na" : t < 65 ? "ok" : t < 80 ? "warm" : "hot");
    const memTone = (p) => (p == null ? "na" : p < 75 ? "ok" : p < 90 ? "warm" : "hot");
    const utilTone = (u) => (u == null ? "na" : u < 60 ? "ok" : u < 85 ? "warm" : "hot");
    const TONE_RANK = { na: 0, ok: 1, warm: 2, hot: 3 };
    const worstTone = (...tones) =>
      tones.reduce((w, t) => (TONE_RANK[t] > TONE_RANK[w] ? t : w), "ok");
    const toneCls = (tone) => (tone === "hot" ? " " + NS + "-v-hot" : tone === "warm" ? " " + NS + "-v-warm" : "");
    const dotCls = (tone) => (tone === "hot" ? " " + NS + "-dot-bad" : tone === "warm" ? " " + NS + "-dot-warn" : "");

    const fmtGb = (mib) => {
      if (mib == null) return "—";
      return Math.round(mib / 1024) + "G";
    };
    const fmtVram = (usedMiB, totalMiB) => (usedMiB == null || totalMiB == null ? "—" : fmtGb(usedMiB) + "/" + fmtGb(totalMiB));
    const fmtW = (w) => (w == null ? "—" : w >= 1000 ? (w / 1000).toFixed(2) + "kW" : Math.round(w) + "W");
    const fmtPct = (p) => (p == null ? "—" : Math.round(p) + "%");

    // ---- stylesheet (injected once; the data-plugin tag lets the HMR
    //      layer claim it for this package's invalidation) ----------------

    const CSS = [
      "." + NS + "{position:fixed;right:16px;bottom:16px;z-index:30;font:11px/1.35 var(--dsw-font-family,-apple-system,'Segoe UI',sans-serif);color:var(--dsw-alias-label-primary,#1f2328);user-select:none;-webkit-user-select:none}",
      "." + NS + "-card{width:340px;background:var(--dsw-alias-bg-overlay,#ffffff);border:1px solid var(--dsw-alias-border-l2,#dcdcdc);border-radius:10px;box-shadow:var(--dsw-shadow-lv2,0 8px 24px rgba(15,15,15,.14));overflow:hidden;cursor:grab;touch-action:none}",
      "." + NS + "-card-dragging{cursor:grabbing;box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(15,15,15,.22))}",
      "." + NS + "-body{padding:4px 10px 0}",
      "." + NS + "-row{display:flex;align-items:center;gap:8px;padding:3px 0}",
      "." + NS + "-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-static-green-400,#4ed17e)}",
      "." + NS + "-dot-warn{background:var(--dsw-static-amber-400,#f7ad31)}",
      "." + NS + "-dot-bad{background:var(--dsw-alias-state-error-primary,#ef4444)}",
      "." + NS + "-dot-off{background:var(--dsw-static-neutral-400,#a2a4a6)}",
      "." + NS + "-name{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "." + NS + "-v{flex:none;text-align:right;font-family:var(--ds-font-family-code,ui-monospace,monospace)}",
      "." + NS + "-v-util{width:30px}",
      "." + NS + "-v-vram{width:46px}",
      "." + NS + "-v-temp{width:28px}",
      "." + NS + "-v-pwr{width:40px}",
      "." + NS + "-v-warm{color:var(--dsw-static-amber-500,#f59e0b)}",
      "." + NS + "-v-hot{color:var(--dsw-alias-state-error-primary,#ef4444)}",
      "." + NS + "-procs{margin-top:4px;padding-top:4px;border-top:1px dashed var(--dsw-alias-border-l1,rgba(127,130,135,.18))}",
      "." + NS + "-procstitle{margin-bottom:2px;font-size:10px;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#545557)}",
      "." + NS + "-proc{display:flex;justify-content:space-between;gap:8px;font-size:10px;font-family:var(--ds-font-family-code,ui-monospace,monospace);padding:1px 0}",
      "." + NS + "-procname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "." + NS + "-foot{display:flex;justify-content:space-between;gap:8px;padding:3px 10px;margin-top:3px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,130,135,.18));font-size:10px;color:var(--dsw-alias-label-secondary,#545557)}",
      "." + NS + "-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:var(--dsw-alias-bg-overlay,#ffffff);border:1px solid var(--dsw-alias-border-l2,#dcdcdc);box-shadow:var(--dsw-shadow-lv2,0 8px 24px rgba(15,15,15,.14));font-size:11px;cursor:pointer}",
      "." + NS + "-pill:hover{border-color:var(--dsw-alias-brand-primary,#4176e6)}",
      "." + NS + "-pillsub{font-size:10px;color:var(--dsw-alias-label-secondary,#545557);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
    ].join("\n");

    // ---- components ------------------------------------------------------

    /** One GPU as a single compact row: dot, name, util, VRAM, temp, power. */
    function GpuRow(props) {
      const g = props.gpu;
      const memPct = g.memTotalMiB ? (g.memUsedMiB / g.memTotalMiB) * 100 : null;
      const tone = worstTone(utilTone(g.util), memTone(memPct), tempTone(g.temp));
      const title = g.name + (g.index != null ? " (GPU" + g.index + ")" : "") +
        (g.fanPct != null ? " · fan " + Math.round(g.fanPct) + "%" : "");
      return h("div", { className: NS + "-row", title },
        h("span", { className: NS + "-dot" + dotCls(tone) }),
        h("span", { className: NS + "-name" }, g.name),
        h("span", { className: NS + "-v -v-util" + toneCls(utilTone(g.util)) }, fmtPct(g.util)),
        h("span", { className: NS + "-v -v-vram" + toneCls(memTone(memPct)) }, fmtVram(g.memUsedMiB, g.memTotalMiB)),
        h("span", { className: NS + "-v -v-temp" + toneCls(tempTone(g.temp)) }, g.temp == null ? "—" : Math.round(g.temp) + "°C"),
        h("span", { className: NS + "-v -v-pwr" }, fmtW(g.powerW))
      );
    }

    /** GPU rows for the given snapshot. */
    function GpuRows(props) {
      const gpus = props.gpus;
      if (gpus.length === 0) return h("div", { className: NS + "-pillsub" }, "nvidia-smi reported no GPUs");
      return h("div", null, gpus.map((g) => h(GpuRow, { key: g.index != null ? g.index : g.name, gpu: g })));
    }

    // ---- top-level widget ------------------------------------------------

    function GpuWidget() {
      const [data, setData] = useState(null);
      const [pos, setPos] = useState(loadPos);
      const [dragging, setDragging] = useState(false);
      const [, forceTick] = useState(0); // re-render hook for resize clamping
      const pollMsRef = useRef(2000);
      const inFlight = useRef(false);
      const rootRef = useRef(null);
      const dragRef = useRef(null);

      // Stacking fix: the host app stacks the shell.overlay layer at z-index 20,
      // while side-panel plugins (dsh-better-sidebar: panel host z 25, panel
      // z 40, floating window z 42) paint above it, so an opened side card
      // covers the widget. Walk up from the widget root to the overlay layer
      // (the nearest absolute, pointer-events:none ancestor) and promote it to
      // the app's top-of-stack value so the widget stays visible over side
      // cards. The layer keeps pointer-events:none, so nothing else is blocked.
      useEffect(() => {
        const el0 = rootRef.current;
        if (!el0 || typeof document === "undefined") return;
        let el = el0;
        while (el && el !== document.body) {
          const s = getComputedStyle(el);
          if (s.position === "absolute" && s.pointerEvents === "none") {
            if (parseInt(s.zIndex, 10) < 2147483000) el.style.zIndex = "2147483000";
            return;
          }
          el = el.parentElement;
        }
      });

      // Keep a saved position on screen if the window shrinks after it.
      useEffect(() => {
        const onResize = () => forceTick((n) => n + 1);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, []);

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

      // ---- dragging (position persists across sessions via localStorage)

      const clampPos = useCallback((x, y) => {
        const el = rootRef.current;
        const w = el ? el.offsetWidth : 340;
        const hh = el ? el.offsetHeight : 100;
        return {
          x: Math.max(0, Math.min(window.innerWidth - w, x)),
          y: Math.max(0, Math.min(window.innerHeight - hh, y))
        };
      }, []);

      const onMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        d.moved = true;
        setPos(clampPos(e.clientX - d.dx, e.clientY - d.dy));
      };

      // Plain functions (recreated per render): the instance added to the
      // window in onDragStart and the instance removing it in onUp are always
      // from the same render, so add/remove pair up correctly.
      const onUp = (e) => {
        const d = dragRef.current;
        dragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setDragging(false);
        if (d && d.moved) {
          const p = clampPos(e.clientX - d.dx, e.clientY - d.dy);
          setPos(p);
          savePos(p);
        }
      };

      const onDragStart = (e) => {
        if (e.button !== 0) return;
        const el = rootRef.current;
        if (!el) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
        setDragging(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      };

      // Double-click (no drag involved) resets to the default corner.
      const onDblClick = () => {
        clearPos();
        setPos(null);
      };

      // Clamped position for the current viewport (recomputed on resize).
      const shownPos = pos ? clampPos(pos.x, pos.y) : null;
      const rootStyle = shownPos
        ? { left: shownPos.x + "px", top: shownPos.y + "px", right: "auto", bottom: "auto" }
        : undefined;

      // Loading / driver-missing: a quiet pill, not a strip.
      if (data == null) {
        return h("div", { className: NS, ref: rootRef, style: rootStyle },
          h("div", { className: NS + "-pill", title: "Waiting for the first sample" },
            h("span", { className: NS + "-dot " + NS + "-dot-off" }),
            h("span", null, "GPU"),
            h("span", { className: NS + "-pillsub" }, "…")));
      }
      if (!data.ok) {
        return h("div", { className: NS, ref: rootRef, style: rootStyle },
          h("div", { className: NS + "-pill", title: data.reason || "GPU telemetry unavailable" },
            h("span", { className: NS + "-dot " + NS + "-dot-off" }),
            h("span", null, "GPU"),
            h("span", { className: NS + "-pillsub" }, (data.reason || "n/a").slice(0, 90))));
      }

      const gpus = data.gpus || [];

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

      return h("div", { className: NS, ref: rootRef, style: rootStyle },
        h("div", {
          className: NS + "-card" + (dragging ? " " + NS + "-card-dragging" : ""),
          title: "Drag to move, double-click to reset position",
          onPointerDown: onDragStart,
          onDoubleClick: onDblClick
        },
          h("div", { className: NS + "-body" }, h(GpuRows, { gpus }), procsEl),
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
