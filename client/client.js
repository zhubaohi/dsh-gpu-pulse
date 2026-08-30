/**
 * dsh-gpu-pulse — client half (early stage: module skeleton, status polling,
 * minimal pill rendering, no styling yet).
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
    const MIN_POLL_MS = 1000;

    function GpuWidget() {
      const [data, setData] = useState(null);
      const pollMsRef = useRef(2000);
      const inFlight = useRef(false);

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
            .catch(() => { /* keep the last snapshot on screen */ })
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

      if (data == null) {
        return h("div", { className: NS }, h("span", null, "GPU …"));
      }
      if (!data.ok) {
        return h("div", { className: NS }, h("span", null, "GPU — " + (data.reason || "n/a")));
      }
      const gpus = data.gpus || [];
      return h("div", { className: NS }, h("span", null, "GPU " + gpus.length + " online"));
    }

    function apply(ctx) {
      const slots = ctx && ctx.slots;
      if (!slots) {
        console.warn("[dsh-gpu-pulse] slots service unavailable — widget disabled");
        return;
      }
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