/* Print Quality Auditor — extras that appear only when the page is served by auditor_server.py on this computer:
   a chooser for the files in the pipeline's output folder, and a live view of a running batch by URL (no file
   picker, works in every browser). When the probe below fails (claude.ai, file://), nothing is added. */
(async function () {
  "use strict";
  const $ = id => document.getElementById(id);
  let listing;
  try {
    const r = await fetch("/output/_list.json", { cache: "no-store" });
    if (!r.ok) return;
    listing = await r.json();
  } catch (e) { return; }
  if (!listing || !Array.isArray(listing.folders)) return;

  const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- audit mode: open a delivered file from the output folder ---------- */
  const sel = document.createElement("select");
  sel.id = "localFile"; sel.className = "btn"; sel.setAttribute("aria-label", "Open a delivered file from the output folder");
  sel.style.maxWidth = "min(52vw, 520px)";
  function fillFiles() {
    const groups = listing.folders.filter(f => f.files.length);
    sel.innerHTML = '<option value="">Open a delivered file…</option>' + groups.map(f =>
      `<optgroup label="${esc(f.name)} (${f.files.length})">` + f.files.map(x =>
        `<option value="${esc((f.path ? f.path + "/" : "") + x.name)}">${esc(x.name)} · ${mb(x.size)}</option>`).join("") + "</optgroup>").join("");
  }
  fillFiles();
  $("auditActions").insertBefore(sel, $("sampleBtn"));
  sel.addEventListener("change", async () => {
    const rel = sel.value; if (!rel) return;
    sel.disabled = true;
    try {
      const r = await fetch("/output/" + rel.split("/").map(encodeURIComponent).join("/"), { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const file = new File([blob], rel.split("/").pop(), { type: blob.type });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = $("file"); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {
      $("statusText").textContent = "Could not open the file: " + (e.message || e);
    } finally { sel.disabled = false; sel.value = ""; }
  });
  sel.addEventListener("focus", async () => {           // pick up files delivered since the page loaded
    try { const r = await fetch("/output/_list.json", { cache: "no-store" }); if (r.ok) { listing = await r.json(); fillFiles(); } } catch (e) { }
  });

  /* ---------- batch mode: follow a batch_status.json by URL ---------- */
  const bsel = document.createElement("select");
  bsel.id = "localBatch"; bsel.className = "btn"; bsel.setAttribute("aria-label", "Follow a batch from the output folder");
  const follow = document.createElement("button");
  follow.type = "button"; follow.className = "btn primary"; follow.id = "localFollowBtn"; follow.textContent = "Follow";
  const stopBtn = document.createElement("button");
  stopBtn.type = "button"; stopBtn.className = "btn"; stopBtn.id = "localStopBtn"; stopBtn.textContent = "Stop"; stopBtn.hidden = true;
  function fillBatches() {
    const withStatus = listing.folders.filter(f => f.status);
    bsel.innerHTML = withStatus.length
      ? withStatus.map(f => `<option value="${esc(f.path)}">${esc(f.name)}${f.status_updated ? " · " + esc(f.status_updated) : ""}</option>`).join("")
      : '<option value="">no batch_status.json in the output folder</option>';
  }
  fillBatches();
  const acts = $("batchActions");
  acts.insertBefore(bsel, acts.firstChild); acts.insertBefore(follow, bsel.nextSibling); acts.insertBefore(stopBtn, follow.nextSibling);
  let timer = null, lastText = null;
  async function pollUrl(path) {
    try {
      const r = await fetch("/output/" + (path ? path + "/" : "") + "batch_status.json", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (text === lastText) return;
      lastText = text;
      const d = JSON.parse(text);
      document.dispatchEvent(new CustomEvent("pqa:batch", { detail: d }));
      $("bmStatus").textContent += " · live from this computer";
      if (d.done >= d.total) stopFollow(true);
    } catch (e) { $("bmStatus").textContent = "Could not read batch_status.json: " + (e.message || e); }
  }
  function stopFollow(finished) {
    clearInterval(timer); timer = null; stopBtn.hidden = true; follow.textContent = "Follow";
    if (!finished && $("bmStatus")) $("bmStatus").textContent = $("bmStatus").textContent.replace(" · live from this computer", " · stopped");
  }
  follow.addEventListener("click", async () => {
    if (!listing.folders.some(f => f.status)) return;
    stopFollow(true); lastText = null;
    follow.textContent = "Following…"; stopBtn.hidden = false;
    await pollUrl(bsel.value);
    timer = setInterval(() => pollUrl(bsel.value), 3000);
  });
  stopBtn.addEventListener("click", () => stopFollow(false));
  bsel.addEventListener("focus", async () => {
    try { const r = await fetch("/output/_list.json", { cache: "no-store" }); if (r.ok) { listing = await r.json(); fillBatches(); } } catch (e) { }
  });
  $("bmHint").textContent = "Choose a batch folder and press Follow: the page reads its batch_status.json every 3 seconds until the batch finishes. The file picker still works too. Nothing leaves this computer.";
  $("expertStatus").textContent = "The expert review runs only when this page is opened inside Claude";

  /* ---------- pipeline workflow: the whole job from draft to finished PDFs, refreshed every 10 s ---------- */
  const gb = n => (n / 1e9).toFixed(1) + " GB";
  const flag = (tone, text) => `<span class="flag ${tone}">${esc(text)}</span>`;
  const TONE = { done: "pass", running: "info", waiting: "warn", attention: "fail", idle: "info" };
  const stage = (n, state, title, detail, extra = "") =>
    `<li class="${state}" style="--tone:var(--${TONE[state]})"><span class="dot">${state === "done" ? "✓" : n}</span><div><div class="wf-h"><b>${esc(title)}</b>${flag(TONE[state], state)}</div><div class="wf-d">${detail}</div>${extra}</div></li>`;

  function renderWorkflow(w) {
    if (w.error) { $("wfStatus").textContent = "Error"; $("wfNext").textContent = w.error; return; }
    const stages = [], next = [];
    const d = w.draft, i = w.input, dl = w.deliveries, disk = w.disk;
    /* 1 draft */
    if (d.files) {
      const ready = d.ready_free != null ? ` ${d.ready_free} ready at no cost${d.ready_paid ? `, ${d.ready_paid} paid` : ""}${d.preview_age_s > 900 ? " (check is older than 15 min)" : ""}.` : " Not checked yet.";
      stages.push(stage(1, "attention", "Draft", `${d.files} file(s) waiting in <code>draft\\</code>.${ready} Run <code>.\\prepare_job.ps1</code> then <code>.\\prepare_job.ps1 -Start</code> to move the ready ones into input.`));
      next.push("check the draft folder with prepare_job.ps1");
    } else stages.push(stage(1, "done", "Draft", "Nothing waiting in <code>draft\\</code>."));
    /* 2 input */
    if (!i.images) stages.push(stage(2, "idle", "Input", "No images in <code>input\\</code>. Put a job in draft and move it in with prepare_job.ps1."));
    else if (i.remaining) {
      stages.push(stage(2, w.running.length ? "running" : "waiting", "Input", `${i.images} image(s) in <code>input\\</code>: ${i.delivered} delivered, <b>${i.remaining} still to print</b>. Next: ${i.next.map(esc).join(", ")}${i.remaining > 5 ? " …" : ""}.`));
      if (!w.running.length) next.push(`print the remaining ${i.remaining} image(s) (README: Preparing and running a job)`);
    } else stages.push(stage(2, "done", "Input", `All ${i.images} image(s) in <code>input\\</code> are delivered.`));
    /* 3 batches */
    const rows = w.batches.filter(b => b.status || b.pdf || b.tif || b.reports).map(b => {
      const s = b.status;
      const state = b.running ? flag("info", "running") : b.stalled ? flag("fail", `stalled ${Math.round(b.age_s / 60)} min`) : s ? flag("pass", "finished") : b.reports ? flag("pass", "delivered") : flag("info", "no status file");
      const prog = s ? `${s.done}/${s.total}` : `${b.reports} report(s)`;
      const q = s ? `${s.critical || 0} critical · ${s.caveats || 0} caveats` : "";
      const bar = s ? `<div class="bm-bar"><i style="width:${Math.round(100 * (s.done || 0) / (s.total || 1))}%"></i></div>` : "";
      return `<tr><td><b>${esc(b.name)}</b>${bar}</td><td>${state}</td><td class="num">${prog}</td><td class="num">${b.pdf} PDF · ${b.tif} TIFF</td><td>${q}</td><td class="num">${s && s.est_cost_usd != null ? "$" + (+s.est_cost_usd).toFixed(3) : ""}</td></tr>`;
    }).join("");
    const anyStalled = w.batches.some(b => b.stalled);
    stages.push(stage(3, w.running.length ? "running" : anyStalled ? "attention" : "done", "Batches",
      w.running.length ? `Running now: ${w.running.map(esc).join(", ")}. Progress updates every 10 s; open "Follow a batch" for the per-image view.`
        : anyStalled ? `A batch has a status file that recently stopped updating before finishing: the job was interrupted. Re-run the same batch command; any images already delivered to other batches are skipped.` : "No batch is running.",
      `<div class="matrix-wrap"><table><thead><tr><th>Folder</th><th>State</th><th>Progress</th><th>Files</th><th>Print quality</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table></div>`));
    if (anyStalled) next.push("re-run the stalled batch");
    /* 4 PDF deliveries */
    if (dl.tif_without_pdf) {
      const where = w.batches.filter(b => b.tif_without_pdf).map(b => `<code>${esc(b.path || "output")}</code> (${b.tif_without_pdf})`).join(", ");
      stages.push(stage(4, "attention", "PDF deliveries", `${dl.pdf} PDF(s) delivered; <b>${dl.tif_without_pdf} TIFF(s) have no PDF yet</b> in ${where}. Run <code>.\\.venv\\Scripts\\python.exe tiff_to_pdf.py output\\&lt;folder&gt;</code> to convert them (a few seconds each, no API cost).`));
      next.push("convert the TIFFs without a PDF with tiff_to_pdf.py");
    } else stages.push(stage(4, dl.pdf ? "done" : "idle", "PDF deliveries", `${dl.pdf} PDF(s) delivered, ${gb(dl.bytes)} on disk.`));
    /* 5 audits */
    const audited = w.batches.filter(b => b.audit_report), unaudited = w.batches.filter(b => !b.audit_report && (b.pdf || b.tif));
    stages.push(stage(5, unaudited.length ? "waiting" : audited.length ? "done" : "idle", "Audit",
      (audited.length ? `Audit reports: ${audited.map(b => `<code>${esc(b.audit_report)}</code>`).join(", ")}. ` : "") +
      (unaudited.length ? `Not audited yet: ${unaudited.map(b => esc(b.name)).join(", ")}. Open a delivered file above to audit it, or ask for a batch audit report.` : "Every delivered batch has an audit report.")));
    /* 6 disk */
    const low = disk.free_bytes < disk.need_bytes || disk.free_bytes < 5e9;
    stages.push(stage(6, low ? "attention" : "done", "Disk space", `${gb(disk.free_bytes)} free on the output drive; the remaining work needs roughly ${gb(disk.need_bytes)}.${low ? " Move finished files off the drive or delete <code>work\\</code> folders of finished batches before continuing." : ""}`));
    if (low) next.push("free disk space");
    /* 7 complete */
    stages.push(stage(7, w.complete ? "done" : "waiting", "Job complete", w.complete ? "Every image in input is delivered as PDF, nothing is running and the draft is empty." : "Reached when input has nothing left to print, every TIFF has its PDF, no batch is running and the draft is empty."));
    $("wfStages").innerHTML = stages.join("");
    $("wfReadouts").innerHTML =
      tileWf("Images in input", `${i.images}`, `${i.delivered} delivered · ${i.remaining} to print`, i.remaining ? "warn" : "pass") +
      tileWf("Delivered", `${dl.sources_delivered}`, `${dl.pdf} PDF · ${dl.tif} TIFF · ${gb(dl.bytes)}`, "accent") +
      tileWf("Running", `${w.running.length}`, w.running.length ? w.running.map(esc).join(", ") : "no batch running", w.running.length ? "accent" : "pass") +
      tileWf("Disk free", gb(disk.free_bytes), `needs about ${gb(disk.need_bytes)} more`, low ? "fail" : "pass");
    $("wfStatus").textContent = `${w.complete ? "Complete" : w.running.length ? "Running" : "Waiting"} · checked ${w.checked}`;
    $("wfNext").innerHTML = w.complete ? "The job is complete." : next.length ? `<b>Next:</b> ${esc(next[0])}${next.length > 1 ? ` · then ${esc(next.slice(1).join(" · "))}` : ""}.` : "Nothing to do right now: a batch is running.";
  }
  const tileWf = (label, big, sub, tone) => `<div class="readout" style="--tone:var(--${tone})"><span class="label">${esc(label)}</span><span class="big">${big}</span><span class="sub">${sub}</span></div>`;
  async function pollWorkflow() {
    try {
      const r = await fetch("/workflow.json", { cache: "no-store" });
      renderWorkflow(r.ok ? await r.json() : { error: `HTTP ${r.status}` });
    } catch (e) { renderWorkflow({ error: "Could not read the workflow state: " + (e.message || e) }); }
  }
  pollWorkflow();
  setInterval(pollWorkflow, 10000);
})();
