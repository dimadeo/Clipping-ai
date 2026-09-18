/* Print Quality Auditor — batch monitor. Follows upscale_pipeline's batch_status.json, which the pipeline
   rewrites after every image, so a running batch can be watched from this page. Nothing is uploaded. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const state = { handle: null, timer: null, lastMod: 0, data: null };
  const canWatch = typeof window.showOpenFilePicker === "function";
  const POLL_MS = 3000;

  /* ---------- mode switch ---------- */
  function setMode(mode) {
    $("auditMode").hidden = mode !== "audit";
    $("batchMode").hidden = mode !== "batch";
    $("auditActions").hidden = mode !== "audit";
    $("batchActions").hidden = mode !== "batch";
    [...$("modeSeg").children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    try { localStorage.setItem("pqa:mode", mode); } catch (e) { }
  }
  $("modeSeg").addEventListener("click", e => { const b = e.target.closest("button[data-mode]"); if (b) setMode(b.dataset.mode); });

  /* ---------- rendering ---------- */
  const gradeTone = g => g === "critical" ? "fail" : g === "caveats" ? "warn" : g === "ok" ? "pass" : "info";
  const statusTone = s => s === "ok" ? "pass" : s === "skipped" ? "info" : "fail";
  const tile = (label, big, sub, tone) => `<div class="readout" style="--tone:var(--${tone})"><span class="label">${label}</span><span class="big">${big}</span><span class="sub">${sub}</span></div>`;
  const when = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString(); };

  function render(d) {
    if (!d || !Array.isArray(d.images) || typeof d.total !== "number") throw new Error("not a batch_status.json");
    state.data = d;
    const running = d.done < d.total, pct = d.total ? d.done / d.total : 0;
    const fixOn = !!d.print_fix;
    $("bmStatus").textContent = `${running ? "Running" : "Finished"} · ${d.done}/${d.total} · updated ${when(d.updated_utc)}${state.handle ? " · live" : ""}`;
    $("bmSummary").innerHTML = `<div class="bm-bar" role="progressbar" aria-valuenow="${d.done}" aria-valuemax="${d.total}"><i style="width:${Math.round(pct * 100)}%"></i></div><div class="readouts">` +
      tile("Progress", `${d.done}<small>/ ${d.total}</small>`, running ? "images finished so far" : "batch complete", "accent") +
      tile("Delivered", `${d.ok}`, `${d.skipped} already delivered · ${d.failed} failed`, d.failed ? "fail" : "pass") +
      tile("Print quality", `${d.critical}<small>critical</small>`, `${d.caveats} with caveats · fix ${fixOn ? "on, " + esc(d.print_fix) : "off"}`, d.critical ? "fail" : d.caveats ? "warn" : "pass") +
      tile("API cost", `$${(+d.est_cost_usd || 0).toFixed(3)}`, `${esc(d.preset || "")} · ${esc(d.print_size || "no sheet")} @ ${d.print_ppi || "—"} PPI`, "accent") +
      `</div>`;
    const rows = d.images.map((im, i) => {
      const pq = im.print_quality, g = pq ? pq.grade : null;
      const pqCell = pq
        ? `<span class="flag ${gradeTone(g)}">${esc(g)}</span>${pq.flags && pq.flags.length ? `<ul class="bm-flags">${pq.flags.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : `<span class="bm-sub">ink ${esc(pq.tac_p999)}% · banding ${esc(pq.band_stepped_pct)}%</span>`}`
        : im.status === "skipped" ? '<span class="bm-sub">not re-checked (kept earlier delivery)</span>' : '<span class="bm-sub">—</span>';
      const print = im.print_size_cm ? `${esc(im.print_size_cm)} cm<br><span class="bm-sub">${esc(im.ppi)} PPI · ${esc(im.grade || "")}</span>` : '<span class="bm-sub">—</span>';
      return `<tr><td class="num">${i + 1}</td><td><b>${esc(im.name)}</b>${im.final ? `<br><span class="bm-sub">${esc(im.final)}</span>` : ""}${im.error ? `<br><span class="bm-sub" style="color:var(--fail)">${esc(im.error)}</span>` : ""}</td>` +
        `<td><span class="flag ${statusTone(im.status)}">${esc(im.status)}</span></td><td>${print}</td><td>${pqCell}</td>` +
        `<td class="num">${im.api_passes ? `${im.api_passes} API · ` : ""}$${(+im.est_cost_usd || 0).toFixed(3)}</td><td class="num">${esc(im.seconds)} s</td></tr>`;
    });
    $("bmRows").innerHTML = rows.reverse().join("") || `<tr><td colspan="7" style="color:var(--ink-2)">Waiting for the first image…</td></tr>`;
  }

  /* ---------- watching ---------- */
  function stop() {
    clearInterval(state.timer); state.timer = null; state.handle = null;
    $("stopWatchBtn").hidden = true; $("watchBtn").textContent = "Watch batch_status.json";
    if (state.data) $("bmStatus").textContent = $("bmStatus").textContent.replace(" · live", " · stopped");
  }
  async function poll() {
    if (!state.handle) return;
    try {
      const f = await state.handle.getFile();
      if (f.lastModified === state.lastMod) return;
      state.lastMod = f.lastModified;
      render(JSON.parse(await f.text()));
      if (state.data && state.data.done >= state.data.total) { clearInterval(state.timer); state.timer = null; }
    } catch (e) {
      $("bmStatus").textContent = "Could not read the file: " + (e.message || e);
    }
  }
  async function pickHandle() {
    let handle;
    try {
      // no `id`: an id makes Chrome reopen the same remembered folder forever, which breaks with
      // "Location is not available" the moment this project's folder moves (as it already has once)
      [handle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: "batch_status.json", accept: { "application/json": [".json"] } }] });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      $("batchFile").click();                 // the viewer does not allow live file access here: one-shot load
      return;
    }
    stop();
    state.handle = handle; state.lastMod = 0;
    $("stopWatchBtn").hidden = false; $("watchBtn").textContent = "Watching…";
    await poll();
    state.timer = setInterval(poll, POLL_MS);
  }
  $("watchBtn").addEventListener("click", () => canWatch ? pickHandle() : $("batchFile").click());
  $("stopWatchBtn").addEventListener("click", stop);
  $("batchFile").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      render(JSON.parse(await f.text()));
      $("bmStatus").textContent += " · pick the file again to refresh";
    } catch (err) { $("bmStatus").textContent = "That is not a batch_status.json from upscale_pipeline 1.4"; }
  });
  /* capture phase: claims a dropped .json in batch mode before ui.js's drop handler (which would try to decode it
     as artwork); everything else falls through to ui.js. preventDefault keeps the browser from opening the file. */
  window.addEventListener("drop", e => {
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f || !/\.json$/i.test(f.name) || $("batchMode").hidden) return;
    e.preventDefault(); e.stopImmediatePropagation();
    document.body.classList.remove("dragging");
    f.text().then(t => { try { render(JSON.parse(t)); $("bmStatus").textContent += " · drop the file again to refresh"; } catch (err) { $("bmStatus").textContent = "That is not a batch_status.json from upscale_pipeline 1.4"; } });
  }, true);

  /* a status object can also be handed to the page directly: document.dispatchEvent(new CustomEvent("pqa:batch", {detail})) */
  document.addEventListener("pqa:batch", e => { try { render(e.detail); setMode("batch"); } catch (err) { $("bmStatus").textContent = err.message; } });

  /* ---------- boot ---------- */
  $("bmHint").textContent = canWatch
    ? "Pick the batch_status.json in the batch's output folder. The page re-reads it every 3 seconds until the batch finishes. Nothing is uploaded."
    : "Pick the batch_status.json in the batch's output folder. This browser cannot watch a file for changes, so pick it again to refresh.";
  let mode = "audit";
  try { mode = localStorage.getItem("pqa:mode") || "audit"; } catch (e) { }
  setMode(mode === "batch" ? "batch" : "audit");
})();
