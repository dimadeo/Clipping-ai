/* Print Quality Auditor — rendering, interaction, expert review and report export. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const state = { img: null, M: null, R: null, busy: false, expert: null, map: "none", sample: null, downloads: null, limits: null, ctl: null, findings: {}, queue: [], queueIndex: -1 };
  const ACCEPT_RE = /\.(png|jpe?g|webp|tiff?|pdf)$/i;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };

  /* ---------- status ---------- */
  function setStatus(msg, p, isError) {
    $("statusText").textContent = msg;
    $("statusText").style.color = isError ? "var(--fail)" : "";
    if (p != null) $("meter").style.width = Math.round(clamp(p, 0, 1) * 100) + "%";
  }

  /* ---------- control strip ---------- */
  function renderStrip(M) {
    const base = ["#00A0DC", "#E0007A", "#F2D500", "#1A1A1A", "#7FCFEE", "#EF80BC", "#F8EA80", "#8D8D8D"];
    const grays = ["#E6E6E6", "#BFBFBF", "#8F8F8F", "#5E5E5E", "#303030"];
    const over = ["#3F2A6E", "#D0232A", "#1E9A48", "#262024"];
    const patches = M ? M.patches.map(p => `rgb(${p.rgb.join(",")})`) : ["#101010", "#2B2B2B", "#777", "#DDD", "#1A0F2E", "#000"];
    const cells = [...base, ...grays, ...patches, ...over, "#000000"];
    $("strip").innerHTML = cells.slice(0, 24).map(c => `<span style="background:${c}"></span>`).join("");
  }

  /* ---------- job ticket ---------- */
  function renderTicket(img, R) {
    const C = R && R.job;
    const cells = [
      ["File", esc(img.name) + (img.isSample ? ' <span class="flag info">Sample</span>' : ""), "file"],
      ["Pixels", `${img.w.toLocaleString()} × ${img.h.toLocaleString()}`],
      ["Container", esc(img.format) + (img.bytes ? ` · ${(img.bytes / 1048576).toFixed(1)} MB` : "")],
      ["Colour", `${esc(img.mode)} · ${img.bits}-bit${img.hasAlpha ? " + alpha" : ""}`],
      ["Profile", img.icc ? esc(img.iccDesc || "Embedded") : '<span class="flag fail">None embedded</span>'],
      ["Resolution tag", img.dpi ? `${img.dpi} PPI` : '<span class="flag warn">Not set</span>'],
      ["Tier C, as placed", C ? `${Math.round(C.ppi)} PPI · ${(img.w / C.ppi * 2.54).toFixed(0)}×${(img.h / C.ppi * 2.54).toFixed(0)} cm` : "Measuring…"],
      ["Real detail", state.M ? `${Math.round(state.M.detail.factor * 100)}% of pixels` : "Measuring…"]
    ];
    $("ticket").innerHTML = cells.map(c => `<div class="${c[2] || ""}"><span class="label">${c[0]}</span><span class="v">${c[1]}</span></div>`).join("");
    $("sampleNote").innerHTML = img.isSample
      ? '<span class="flag info">Example</span> A generated concert poster is loaded so you can see the audit working. Load your own artwork to replace it.'
      : '<span class="flag pass">Local</span> Measured in this browser. The file is not uploaded unless you run the expert review.';
  }

  /* ---------- settings ---------- */
  function readSettings() {
    return { wCm: +$("sizeW").value || 59.4, hCm: +$("sizeH").value || 84.1, distC: +$("distC").value || 150, fit: $("fit").value, substrate: $("substrate").value };
  }
  let regradeTimer = 0;
  const queueRegrade = () => { clearTimeout(regradeTimer); regradeTimer = setTimeout(regrade, 120); };
  $("preset").addEventListener("change", e => {
    if (e.target.value === "custom") { $("sizeW").focus(); return; }
    const [w, h] = e.target.value.split("x"); $("sizeW").value = w; $("sizeH").value = h;
    $("distC").value = Math.round(clamp(Math.max(+w, +h) * 1.6, 60, 400) / 10) * 10;
    queueRegrade();
  });
  ["sizeW", "sizeH"].forEach(id => $(id).addEventListener("input", () => {
    const key = `${$("sizeW").value}x${$("sizeH").value}`;
    $("preset").value = [...$("preset").options].some(o => o.value === key) ? key : "custom";
    queueRegrade();
  }));
  ["distC", "fit", "substrate"].forEach(id => $(id).addEventListener("input", queueRegrade));

  /* ---------- soft proof ---------- */
  function drawProof(src) {
    const cv = $("proofCanvas"), ov = $("overlay");
    const k = Math.min(1, 1400 / src.width, 1400 / src.height);
    cv.width = ov.width = Math.max(1, Math.round(src.width * k));
    cv.height = ov.height = Math.max(1, Math.round(src.height * k));
    cv.style.maxHeight = "68vh"; cv.style.width = "auto";
    const ctx = cv.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(src, 0, 0, cv.width, cv.height);
    ov.getContext("2d").clearRect(0, 0, ov.width, ov.height);
    const marks = $("marks");
    marks.style.cssText = "inset:0;width:100%;height:100%";
    const corner = (x, y, sx, sy) => `<svg x="${x}" y="${y}" overflow="visible"><line x1="0" y1="${sy * 6}" x2="0" y2="${sy * 20}"/><line x1="${sx * 6}" y1="0" x2="${sx * 20}" y2="0"/></svg>`;
    marks.innerHTML = `<g style="stroke:var(--ink-2);stroke-width:1;fill:none">
      ${corner("0%", "0%", -1, -1)}${corner("100%", "0%", 1, -1)}${corner("0%", "100%", -1, 1)}${corner("100%", "100%", 1, 1)}
      <svg x="50%" y="0%" overflow="visible"><circle cx="0" cy="-13" r="5"/><line x1="-9" y1="-13" x2="9" y2="-13"/><line x1="0" y1="-22" x2="0" y2="-4"/></svg>
      <svg x="50%" y="100%" overflow="visible"><circle cx="0" cy="13" r="5"/><line x1="-9" y1="13" x2="9" y2="13"/><line x1="0" y1="4" x2="0" y2="22"/></svg></g>`;
  }

  function drawOverlay() {
    const { img, M, R } = state; if (!M || !R) return;
    const ov = $("overlay"), ctx = ov.getContext("2d"), G = M.grid, C = R.job, set = readSettings();
    ctx.clearRect(0, 0, ov.width, ov.height);
    const cw = ov.width / G.cols, ch = ov.height / G.rows, scale = ov.width / img.w;
    const cell = (i, color) => { ctx.fillStyle = color; ctx.fillRect((i % G.cols) * cw + 0.5, ((i / G.cols) | 0) * ch + 0.5, cw - 1, ch - 1); };
    const lim = R.sub.limit, over = lim >= 300 ? G.tac300 : lim >= 280 ? G.tac280 : lim >= 260 ? G.tac260 : G.tac250;
    const legend = $("legend");
    for (let i = 0; i < G.cols * G.rows; i++) {
      if (state.map === "tac" && over[i] > 0.002) cell(i, `rgba(224,0,122,${clamp(0.18 + over[i] * 1.6, 0, 0.82)})`);
      if (state.map === "band" && G.band[i] > 0.01) cell(i, `rgba(0,160,220,${clamp(G.band[i] * 2.2, 0.15, 0.8)})`);
      if (state.map === "line" && G.lineCnt[i] >= 20) {
        const pt = G.lineMin[i] / C.ppi * 72;
        if (pt < C.minPt) cell(i, "rgba(224,0,122,0.6)"); else if (pt < C.minPt * 1.5) cell(i, "rgba(242,170,0,0.5)");
      }
      if (state.map === "clip") {
        if (G.clipLo[i] > 0.02) cell(i, `rgba(224,0,122,${clamp(G.clipLo[i], 0.15, 0.75)})`);
        else if (G.clipHi[i] > 0.02) cell(i, `rgba(0,160,220,${clamp(G.clipHi[i], 0.15, 0.75)})`);
      }
    }
    /* trim, bleed and crop for the large-format job */
    const pw = img.w / C.ppi, ph = img.h / C.ppi, fx = C.wIn / pw, fy = C.hIn / ph;
    let note = "";
    if (set.fit === "cover" && (fx < 0.999 || fy < 0.999)) {
      const tw = ov.width * Math.min(1, fx), th = ov.height * Math.min(1, fy), tx = (ov.width - tw) / 2, ty = (ov.height - th) / 2;
      ctx.fillStyle = "rgba(12,14,18,0.55)";
      ctx.fillRect(0, 0, ov.width, ty); ctx.fillRect(0, ty + th, ov.width, ov.height - ty - th); ctx.fillRect(0, ty, tx, th); ctx.fillRect(tx + tw, ty, ov.width - tx - tw, th);
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "#00A0DC"; ctx.strokeRect(tx, ty, tw, th); ctx.setLineDash([]);
      const b = 3 / 25.4 * C.ppi * scale;
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,160,220,0.6)"; ctx.strokeRect(tx - b, ty - b, tw + 2 * b, th + 2 * b);
      note = `Dimmed: cropped away at ${set.wCm} × ${set.hCm} cm (${((pw - C.wIn) * 2.54).toFixed(1)} × ${((ph - C.hIn) * 2.54).toFixed(1)} cm lost). Cyan dashed line: trim. Outer line: 3 mm bleed.`;
    } else if (set.fit === "contain") {
      note = `Fit inside leaves ${((C.wIn - pw) * 2.54 / 2).toFixed(1)} cm left/right and ${((C.hIn - ph) * 2.54 / 2).toFixed(1)} cm top/bottom of unprinted margin.`;
    } else note = "Aspect ratio matches the trim; nothing is cropped.";
    const sw = c => `<span class="ramp" style="background:${c}"></span>`;
    const legends = {
      none: note,
      tac: `${sw("linear-gradient(90deg,rgba(224,0,122,.18),rgba(224,0,122,.82))")} Share of each cell over the ${lim}% ink limit. ${note}`,
      band: `${sw("linear-gradient(90deg,rgba(0,160,220,.15),rgba(0,160,220,.8))")} Stepped dark gradients, darker = more of the cell bands. ${note}`,
      line: `${sw("linear-gradient(90deg,rgba(242,170,0,.5) 50%,rgba(224,0,122,.6) 50%)")} Amber: finest stroke under 1.5× the ${C.minPt} pt minimum. Magenta: under the minimum.`,
      clip: `${sw("linear-gradient(90deg,rgba(224,0,122,.6) 50%,rgba(0,160,220,.6) 50%)")} Magenta: shadows at the black floor. Cyan: highlights blown to paper white.`
    };
    legend.innerHTML = legends[state.map];
  }
  $("maps").addEventListener("click", e => {
    const b = e.target.closest("button[data-map]"); if (!b) return;
    state.map = b.dataset.map;
    [...$("maps").children].forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    drawOverlay();
  });

  /* ---------- gauges & component bars ---------- */
  function gauge(score, tone) {
    const cx = 100, cy = 100, ang = s => Math.PI * (1 - (s - 1) / 9);
    const pt = (s, r) => [cx + r * Math.cos(ang(s)), cy - r * Math.sin(ang(s))];
    const arc = (s0, s1, r) => { const [x0, y0] = pt(s0, r), [x1, y1] = pt(s1, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
    const tick = s => { const [x, y] = pt(s, 98); return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" style="fill:var(--ink-3);font:500 9px var(--mono)">${s}</text>`; };
    const [nx, ny] = pt(score, 72);
    return `<svg viewBox="-6 -4 212 118" role="img" aria-label="Score ${score.toFixed(1)} out of 10">
      <path d="${arc(1, 6.92, 86)}" style="fill:none;stroke:var(--fail);stroke-width:4;opacity:.55"/>
      <path d="${arc(7.06, 8.92, 86)}" style="fill:none;stroke:var(--warn);stroke-width:4;opacity:.55"/>
      <path d="${arc(9.06, 10, 86)}" style="fill:none;stroke:var(--pass);stroke-width:4;opacity:.55"/>
      <path d="${arc(1, 10, 72)}" style="fill:none;stroke:var(--sunk);stroke-width:12;stroke-linecap:round"/>
      <path d="${arc(1, Math.max(1.05, score), 72)}" style="fill:none;stroke:var(--${tone});stroke-width:12;stroke-linecap:round"/>
      <circle cx="${nx.toFixed(2)}" cy="${ny.toFixed(2)}" r="3" style="fill:var(--sheet)"/>
      ${tick(1)}${tick(7)}${tick(9)}${tick(10)}
      <text x="100" y="92" text-anchor="middle" style="fill:var(--ink);font:600 34px var(--mono);font-variant-numeric:tabular-nums">${score.toFixed(1)}</text>
      <text x="100" y="108" text-anchor="middle" style="fill:var(--ink-3);font:500 9px var(--mono);letter-spacing:.08em">OF 10.0</text>
    </svg>`;
  }

  function renderTiers() {
    const { R } = state;
    $("tiers").innerHTML = R.tiers.map(t => {
      const tone = PQA.tone(t.score);
      return `<article class="tier${t.isJob ? " target" : ""}" style="--tone:var(--${tone})">
        <div class="tier-head"><h3>Tier ${t.id}</h3>${t.isJob ? '<span class="flag info">Your job</span>' : `<span class="label">${t.sub}</span>`}</div>
        <p class="ex">${esc(t.name)} · ${esc(t.ex)}</p>
        ${gauge(t.score, tone)}
        <p class="verdict">${PQA.verdict(t.score)}</p>
        <dl><dt>Effective PPI</dt><dd>${Math.round(t.eff)}</dd><dt>Target</dt><dd>${t.targetLabel}</dd>
        <dt>Finest line</dt><dd>${t.finestPt ? t.finestPt.toFixed(2) + " pt" : "—"}</dd><dt>Line minimum</dt><dd>${t.minPt} pt</dd></dl>
      </article>`;
    }).join("");
    const keys = R.tiers[0].comps.map(c => c.key);
    $("comps").innerHTML = `<div class="comp head"><span>Check</span><span>Tier A</span><span>Tier B</span><span>Tier C</span></div>` +
      keys.map(k => {
        const cs = R.tiers.map(t => t.comps.find(c => c.key === k));
        return `<div class="comp"><span title="${esc(cs[2].note)}">${esc(cs[0].label)}</span>${cs.map((c, i) => {
          const tone = PQA.tone(c.s);
          return `<span style="display:grid;grid-template-columns:1fr 2.4em;gap:6px;align-items:center" title="Tier ${R.tiers[i].id}: ${esc(c.value)} · ${esc(c.note)}"><span class="bar"><i style="width:${(c.s - 1) / 9 * 100}%;--tone:var(--${tone})"></i></span><span class="mono" style="text-align:right">${c.s.toFixed(1)}</span></span>`;
        }).join("")}</div>`;
      }).join("");
  }

  /* ---------- charts ---------- */
  function lumChart(M) {
    const W = 520, H = 130, pad = { l: 8, r: 8, t: 10, b: 22 }, bins = 64, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const vals = Array.from({ length: bins }, (_, b) => { let s = 0; for (let l = b * 4; l < b * 4 + 4; l++) s += M.lumHist[l]; return s / M.N; });
    const max = Math.sqrt(Math.max(...vals)) || 1, bw = iw / bins;
    const bars = vals.map((v, b) => {
      const h = Math.sqrt(v) / max * ih, x = pad.l + b * bw;
      return `<rect x="${(x + 1).toFixed(1)}" y="${(pad.t + ih - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="1" style="fill:${b < 16 ? "var(--accent)" : "var(--ink-3)"};opacity:${b < 16 ? 1 : 0.55}"><title>Levels ${b * 4}–${b * 4 + 3}: ${pct(v, 2)} of pixels</title></rect>`;
    }).join("");
    const ticks = [0, 64, 128, 192, 255].map(v => `<text x="${(pad.l + v / 256 * iw).toFixed(1)}" y="${H - 6}" text-anchor="${v === 0 ? "start" : v === 255 ? "end" : "middle"}" style="fill:var(--ink-3);font:500 9px var(--mono)">${v}</text>`).join("");
    return `<svg class="hist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Luminance histogram with shadow levels highlighted">
      <rect x="${pad.l}" y="${pad.t}" width="${iw / 4}" height="${ih}" style="fill:var(--accent-soft)"/>
      <text x="${pad.l + 4}" y="${pad.t + 11}" style="fill:var(--accent);font:600 9px var(--mono);letter-spacing:.06em">SHADOWS 0–63</text>
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" style="stroke:var(--rule)"/>
      ${bars}${ticks}</svg>`;
  }
  function tacChart(M, R) {
    const W = 520, H = 130, pad = { l: 8, r: 8, t: 12, b: 22 }, bins = 40, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, lim = R.sub.limit;
    const vals = Array.from({ length: bins }, (_, b) => { let s = 0; for (let t = b * 10; t < Math.min(401, b * 10 + 10); t++) s += M.tacHist[t]; return s / M.N; });
    const max = Math.sqrt(Math.max(...vals)) || 1, bw = iw / bins, xOf = t => pad.l + t / 400 * iw;
    const bars = vals.map((v, b) => {
      const h = Math.sqrt(v) / max * ih, overLim = b * 10 >= lim;
      return `<rect x="${(xOf(b * 10) + 1).toFixed(1)}" y="${(pad.t + ih - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="1" style="fill:${overLim ? "var(--fail)" : "var(--ink-3)"};opacity:${overLim ? 1 : 0.55}"><title>${b * 10}–${b * 10 + 9}% TAC: ${pct(v, 2)} of area</title></rect>`;
    }).join("");
    const ticks = [0, 100, 200, 300, 400].map(v => `<text x="${xOf(v).toFixed(1)}" y="${H - 6}" text-anchor="${v === 0 ? "start" : v === 400 ? "end" : "middle"}" style="fill:var(--ink-3);font:500 9px var(--mono)">${v}%</text>`).join("");
    const lx = xOf(lim);
    return `<svg class="hist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Simulated total area coverage histogram against the ${lim} percent limit">
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" style="stroke:var(--rule)"/>
      ${bars}
      <line x1="${lx}" x2="${lx}" y1="${pad.t - 4}" y2="${pad.t + ih}" style="stroke:var(--fail);stroke-width:1.5;stroke-dasharray:4 3"/>
      <text x="${lx - 5}" y="${pad.t + 6}" text-anchor="end" style="fill:var(--ink-2);font:600 9px var(--mono)">LIMIT ${lim}%</text>
      ${ticks}</svg>`;
  }

  /* ---------- crops ---------- */
  function worst(arr, pick = "max", filter) {
    let best = pick === "max" ? 0 : Infinity, bi = -1;
    for (let i = 0; i < arr.length; i++) {
      if (filter && !filter(i)) continue;
      if (pick === "max" ? arr[i] > best : (arr[i] > 0 && arr[i] < best)) { best = arr[i]; bi = i; }
    }
    return bi;
  }
  function addCrops(container, list) {
    const { img, M } = state, G = M.grid;
    container.innerHTML = "";
    list.filter(c => c.cell >= 0).forEach(c => {
      const S = Math.min(320, img.w, img.h);
      const cx = ((c.cell % G.cols) + 0.5) * img.w / G.cols, cy = ((((c.cell / G.cols) | 0)) + 0.5) * img.h / G.rows;
      const sx = clamp(Math.round(cx - S / 2), 0, img.w - S), sy = clamp(Math.round(cy - S / 2), 0, img.h - S);
      const fig = document.createElement("figure"); fig.className = "crop"; fig.style.margin = "0";
      const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
      cv.getContext("2d").drawImage(img.full, sx, sy, S, S, 0, 0, S, S);
      cv.setAttribute("role", "img"); cv.setAttribute("aria-label", c.label);
      const cap = document.createElement("figcaption"); cap.innerHTML = `<b style="color:var(--ink)">${esc(c.label)}</b><br>${esc(c.note)}`;
      fig.append(cv, cap); container.append(fig);
    });
    if (!container.children.length) container.innerHTML = '<p style="color:var(--ink-2)">No problem areas to show.</p>';
  }

  /* ---------- sections 2 & 3 ---------- */
  const readout = (label, big, small, sub, tone) => `<div class="readout" style="--tone:var(--${tone})"><span class="label">${label}</span><span class="big">${big}${small ? `<small>${small}</small>` : ""}</span><span class="sub">${sub}</span></div>`;
  const finding = (tone, title, text) => `<li><span class="flag ${tone}">${{ pass: "Pass", warn: "Caveat", fail: "Critical", info: "Note" }[tone]}</span><div><strong>${title}</strong><p>${text}</p></div></li>`;

  function renderShadows() {
    const { M, R, img } = state, C = R.job, A = R.tiers[0], set = readSettings(), G = M.grid;
    const comp = (t, k) => t.comps.find(c => c.key === k);
    const bandTone = PQA.tone(comp(C, "band").s), alphaTone = PQA.tone(comp(C, "alpha").s), blackTone = PQA.tone(Math.min(comp(C, "black").s, comp(A, "black").s));
    const stepped = M.band.steppedFrac >= 0.002;
    const F = [];
    F.push(["Hard edges & banding", bandTone, stepped
      ? `Dark gradients cover ${pct(M.band.steppedFrac)} of the image and step every ${Math.round(M.band.p90 / M.s)} px (90th percentile). At ${set.wCm} × ${set.hCm} cm that is <b>${C.bandMm.toFixed(1)} mm per band</b>, ${C.arcmin.toFixed(1)} arc-minutes at ${set.distC} cm${C.arcmin > 3 ? ": wide enough to show as contour lines, and the RIP's own CMYK quantisation widens them further." : ". That is under the ~3 arc-minute point where steps become visible, but conversion to CMYK compresses shadow levels, so treat it as a risk."} At card size the same steps shrink to ${A.bandMm.toFixed(2)} mm.${M.band.posterFrac > 0.2 ? ` ${pct(M.band.posterFrac, 0)} of steps skip levels, a sign of earlier posterisation or heavy compression.` : ""}`
      : `Soft tones in the shadows carry enough distinct levels to print as continuous tone. No 8-bit plateaus wider than 3 px were found in dark gradients.`]);
    const a = M.alpha;
    const alphaText = {
      none: "The file is flattened with no alpha channel, so the RIP has nothing to composite. There is no risk of a white box or grey halo from transparency: any shadow is already baked into the background pixels. Overprint settings do not apply to raster pixels.",
      "white-box": `The file is flattened, but its outer edge is flat white (mean level ${M.border.mean.toFixed(0)}). Over a tinted layout or on coloured stock, the artwork prints as a visible white rectangle.`,
      "alpha-shadow": a ? `${pct(a.semi, 2)} of pixels are partly transparent and ${pct(a.semiDark, 0)} of those are near-black at about ${Math.round(a.semiDarkAlpha * 100)}% opacity: a live drop shadow or glow. Over light stock it multiplies cleanly. Flattened against the wrong background or at low resolution, it leaves a grey box edge; over dark stock it vanishes and can show a lighter ring where the alpha ramps out.` : "",
      "white-matte": a ? `${pct(a.semi, 2)} of pixels are partly transparent and ${pct(a.semiWhite, 0)} of those carry white colour under the alpha. Over a dark background they composite into a pale fringe around the object.` : "",
      alpha: a ? `${pct(a.semi, 2)} of pixels are partly transparent with mid-tone colour. They need flattening against the final background before separation so the RIP does not composite them against white.` : ""
    }[R.alphaKey];
    F.push(["Alpha channel & overprint", alphaTone, alphaText]);
    const bl = M.lines.blackLineFrac;
    F.push(["Black composition", blackTone, M.neutralBlack < 0.005
      ? `Very little of the image is neutral RGB black (${pct(M.neutralBlack, 2)}). The darks are coloured, so they separate into balanced CMY plus K rather than a flat, heavy rich black.`
      : `${pct(M.neutralBlack)} of the area is neutral RGB black. A default sRGB→CMYK conversion builds that as roughly <b>C74 M70 Y68 K92 (≈304%)</b>${bl > 0.01 ? `, and ${pct(bl, 0)} of the fine dark strokes use it. Four plates must then register within ${C.reg} mm or small type picks up coloured fringes. Those strokes need to be rebuilt as 100% K.` : ". Little fine detail uses it, so registration risk is low, but large solids still need a controlled rich black instead of an unlimited four-colour build."}`]);
    state.findings.shadows = F;

    $("shadowPanel").innerHTML = `<div class="readouts">
      ${readout("Gradient steps", stepped ? C.bandMm.toFixed(1) : "—", stepped ? "mm" : "", stepped ? `${C.arcmin.toFixed(1)} arc-min at ${set.distC} cm · ${pct(M.band.steppedFrac)} of area` : "No stepped dark gradients", bandTone)}
      ${readout("Shadow levels", M.shadowLevels, "of 64", `Darkest 1% sits at level ${M.lumP1} of 255`, M.shadowLevels < 24 && stepped ? "warn" : "pass")}
      ${readout("Transparency", a ? pct(a.semi, 2) : "Flat", a ? "partial alpha" : "", { none: "No alpha channel", "white-box": "Baked white background", "alpha-shadow": "Live shadow in alpha", "white-matte": "White matte on edges", alpha: "Soft alpha edges" }[R.alphaKey], alphaTone)}
      ${readout("Neutral RGB black", pct(M.neutralBlack), "", "Separates to ≈ C74 M70 Y68 K92", blackTone)}
      ${readout("Crushed shadows", pct(M.clipLo), "", R.crushed ? "Levels pile up at the black floor" : "Shadow detail holds", R.crushed ? "warn" : "pass")}
    </div>
    ${lumChart(M)}
    <ul class="findings">${F.map(f => finding(f[1], f[0], f[2])).join("")}</ul>
    <details class="crops"><summary>Worst areas at 1:1 pixels</summary><div class="crop-row" id="shCrops"></div></details>`;
    addCrops($("shCrops"), [
      { cell: stepped ? worst(G.band) : -1, label: "Most banding", note: `${pct(G.band[worst(G.band)] || 0, 0)} of cell in stepped plateaus` },
      { cell: M.clipLo > 0.005 ? worst(G.clipLo) : -1, label: "Most clipping", note: `${pct(G.clipLo[worst(G.clipLo)] || 0, 0)} at black floor` }
    ]);
  }

  function renderLegibility() {
    const { M, R } = state, C = R.job, A = R.tiers[0], sub = R.sub, set = readSettings(), G = M.grid;
    const comp = (t, k) => t.comps.find(c => c.key === k);
    const lightTone = p => p >= 0.95 ? "pass" : p >= 0.8 ? "warn" : "fail";
    const hasStrokes = R.strongStrokes >= 200;
    const tacTone = PQA.tone(comp(C, "tac").s), chokeTone = PQA.tone(Math.min(comp(C, "choke").s, comp(A, "choke").s));
    const L = R.lights, F = [];
    F.push(["Contrast under lighting", hasStrokes ? lightTone(L[1].passRate) : "info", hasStrokes
      ? `Strong strokes (a luminance gap of 60+ levels: the population that behaves like type and linework) were simulated on ${sub.name.toLowerCase()}, with paper white at ${Math.round(sub.white * 100)}% reflectance and the darkest ink at ${(sub.rmin * 100).toFixed(1)}%. In diffuse gallery light <b>${pct(L[0].passRate, 0)}</b> hold 4.5:1; under retail lighting ${pct(L[1].passRate, 0)}; with window glare ${pct(L[2].passRate, 0)}. Glare adds the same reflected light to ink and paper, so dark-on-dark detail fails first.`
      : "Too few high-contrast strokes were found to simulate type legibility. The artwork reads as continuous-tone imagery; run the expert review to check any type visually."]);
    F.push(["Ink saturation (TAC)", tacTone, `Simulated coverage peaks at <b>${M.tacP999}%</b> (99.9th percentile) against a ${sub.limit}% limit${R.tacOver > 0.0005 ? `, with ${pct(R.tacOver, 2)} of the area over it. The heaviest patch is RGB ${M.patches[4].rgb.join(", ")}. ${set.substrate === "coated" || set.substrate === "uncoated" ? "Over-limit areas risk set-off onto the next sheet, slow drying and lost shadow separation." : "Over-limit areas risk ink pooling, bleeding at edges, bronzing and filled-in shadow detail."}` : ". Shadows stay inside the limit, so no muddy build-up is expected."}`]);
    const revN = M.lines.revOnDarkTotal * M.lines.step;
    F.push(["Small text on shadows", revN >= 200 ? chokeTone : "pass", revN >= 200
      ? `About ${revN.toLocaleString()} px of light strokes sit on dark backgrounds (background ≈ ${Math.round(M.lines.revOnDarkTac)}% TAC). With ${sub.spread} mm of ink spread per edge, any stroke narrower than ${(4 * sub.spread).toFixed(2)} mm loses over half its width: <b>${pct(C.chokeFrac, 0)}</b> of them at large format and ${pct(A.chokeFrac, 0)} at card size. Fine serifs and tight tracking fill in first.`
      : "No meaningful amount of light, fine detail sits on dark or shadowed areas, so ink spread cannot choke reversed characters."]);
    state.findings.legibility = F;

    $("legPanel").innerHTML = `<span class="label">Strong-stroke contrast ≥ 4.5:1 on ${esc(sub.name.toLowerCase())}</span>
      <div class="light-grid">${L.map(l => `<div class="light" style="border-left:3px solid var(--${hasStrokes ? lightTone(l.passRate) : "rule"})"><span class="label">${l.name}</span><span class="big mono">${hasStrokes ? pct(l.passRate, 0) : "—"}</span><span class="sub" style="font-size:.8rem;color:var(--ink-2)">${hasStrokes ? `Median ${l.median.toFixed(1)}:1 · ` : ""}${l.note}</span></div>`).join("")}</div>
      <div class="readouts" style="margin-top:12px">
        ${readout("Peak TAC", M.tacP999, "%", `Limit ${sub.limit}% · ${pct(R.tacOver, 2)} of area over`, tacTone)}
        ${readout("Reversed strokes that choke", revN >= 200 ? pct(C.chokeFrac, 0) : "—", "", revN >= 200 ? `Tier C · ${pct(A.chokeFrac, 0)} at card size` : "None on dark areas", revN >= 200 ? chokeTone : "pass")}
        ${readout("Finest stroke", R.finestPx ? C.finestPt.toFixed(2) : "—", R.finestPx ? "pt" : "", R.finestPx ? `${Math.round(R.finestPx)} px · ${A.finestPt.toFixed(2)} pt at card size` : "No hairlines detected", PQA.tone(comp(C, "line").s))}
      </div>
      ${tacChart(M, R)}
      <ul class="findings">${F.map(f => finding(f[1], f[0], f[2])).join("")}</ul>
      <details class="crops"><summary>Worst areas at 1:1 pixels</summary><div class="crop-row" id="lgCrops"></div></details>`;
    const over = sub.limit >= 300 ? G.tac300 : sub.limit >= 280 ? G.tac280 : sub.limit >= 260 ? G.tac260 : G.tac250;
    addCrops($("lgCrops"), [
      { cell: R.tacOver > 0.0005 ? worst(over) : -1, label: "Heaviest ink", note: `Cell peak ${Math.round(G.tacMax[worst(over)] || 0)}% TAC` },
      { cell: revN >= 200 ? worst(G.choke) : -1, label: "Reversed detail on dark", note: "Light strokes most at risk of choking" },
      { cell: R.finestPx ? worst(G.lineMin, "min", i => G.lineCnt[i] >= 20) : -1, label: "Finest linework", note: `${(G.lineMin[worst(G.lineMin, "min", i => G.lineCnt[i] >= 20)] || 0)} px wide → ${((G.lineMin[worst(G.lineMin, "min", i => G.lineCnt[i] >= 20)] || 0) / C.ppi * 72).toFixed(2)} pt at Tier C` }
    ]);
  }

  /* ---------- matrix & checklist ---------- */
  function renderMatrix() {
    const { R } = state;
    $("matrix").innerHTML = R.tiers.map(t => {
      const tone = PQA.tone(t.score);
      return `<tr><td><b>Tier ${t.id}</b><br><span style="color:var(--ink-2)">${t.name}</span></td><td>${esc(t.ex)}</td>
        <td class="num">${Math.round(t.eff)}<br><span style="color:var(--ink-3)">target ${t.targetLabel}</span></td>
        <td class="num">${t.finestPt ? t.finestPt.toFixed(2) + " pt" : "—"}<br><span style="color:var(--ink-3)">min ${t.minPt} pt</span></td>
        <td><span class="score-chip" style="--tone:var(--${tone});--tone-soft:var(--${tone}-soft)">${t.score.toFixed(1)}</span></td>
        <td>${t.bottleneck ? `<b>${esc(t.bottleneck.label)}</b> (${t.bottleneck.s.toFixed(1)})<br><span style="color:var(--ink-2)">${esc(t.bottleneck.value)} · ${esc(t.bottleneck.note)}</span>` : "None. Every check is at 10."}</td></tr>`;
    }).join("");
  }

  function renderChecklist() {
    const { R, img, expert } = state;
    const groups = R.checklist.slice();
    if (expert && Array.isArray(expert.actions) && expert.actions.length)
      groups.push({ title: "From the expert review", items: expert.actions.map((a, i) => ({ sev: "std", title: String(a.area || "Action"), detail: esc(a.step || ""), id: "expert-" + i })) });
    const key = "pqa:checks:" + img.name, done = new Set(store.get(key) || []);
    let fails = 0, warns = 0;
    const sevFlag = { fail: '<span class="flag fail">Critical</span>', warn: '<span class="flag warn">Caveat</span>', pass: '<span class="flag pass">Pass</span>', std: '<span class="flag info">Standard</span>' };
    $("checklist").innerHTML = groups.map((g, gi) => {
      const f = g.items.filter(i => i.sev === "fail").length, w = g.items.filter(i => i.sev === "warn").length;
      fails += f; warns += w;
      const head = f ? '<span class="flag fail">' + f + " critical</span>" : w ? '<span class="flag warn">' + w + " caveat" + (w > 1 ? "s" : "") + "</span>" : '<span class="flag pass">Clear</span>';
      return `<div class="check-group"><h3>${esc(g.title)} ${head}</h3>${g.items.map(it => {
        const id = `chk-${gi}-${it.id}`;
        return `<div class="check"><input type="checkbox" id="${id}" data-key="${esc(it.id)}"${done.has(it.id) ? " checked" : ""}><label for="${id}"><b>${sevFlag[it.sev]} ${esc(it.title)}</b><span>${it.detail}</span></label></div>`;
      }).join("")}</div>`;
    }).join("");
    $("bpCount").textContent = `${fails} critical · ${warns} caveats`;
  }
  $("checklist").addEventListener("change", e => {
    if (!e.target.matches("input[type=checkbox]") || !state.img) return;
    const key = "pqa:checks:" + state.img.name, done = new Set(store.get(key) || []);
    e.target.checked ? done.add(e.target.dataset.key) : done.delete(e.target.dataset.key);
    store.set(key, [...done]);
  });

  /* ---------- upload queue ---------- */
  const queueTiers = R => R.tiers.map(t => ({ id: t.id, score: t.score }));
  function renderQueue() {
    const panel = $("queuePanel");
    if (state.queue.length < 2) { panel.hidden = true; return; }
    panel.hidden = false;
    const done = state.queue.filter(q => q.status === "done" || q.status === "error").length;
    $("queueStatus").textContent = `${done}/${state.queue.length} measured`;
    $("queueList").innerHTML = state.queue.map((q, i) => {
      const chips = q.status === "done"
        ? q.tiers.map(t => `<span class="score-chip sm" style="--tone:var(--${PQA.tone(t.score)});--tone-soft:var(--${PQA.tone(t.score)}-soft)" title="Tier ${t.id}">${t.id} ${t.score.toFixed(1)}</span>`).join("")
        : q.status === "error" ? '<span class="flag fail">Failed</span>' : q.status === "measuring" ? '<span class="flag info">Measuring…</span>' : '<span class="flag info">Queued</span>';
      return `<div class="qitem"><button type="button" class="qrow${i === state.queueIndex ? " active" : ""}" data-i="${i}" aria-current="${i === state.queueIndex}" title="${q.status === "error" ? esc(q.error) : ""}">
        <span class="qname">${esc(q.name)}</span><span class="qdims">${q.dims || ""}</span><span class="qchips">${chips}</span></button>
        <button type="button" class="qremove" data-remove="${i}" aria-label="Remove ${esc(q.name)}">&times;</button></div>`;
    }).join("");
  }
  $("queueList").addEventListener("click", e => {
    const rm = e.target.closest("[data-remove]");
    if (rm) {
      const i = +rm.dataset.remove;
      state.queue.splice(i, 1);
      if (state.queueIndex === i) state.queueIndex = -1; else if (state.queueIndex > i) state.queueIndex--;
      renderQueue();
      return;
    }
    const row = e.target.closest(".qrow[data-i]");
    if (row) selectQueue(+row.dataset.i);
  });
  $("clearQueueBtn").addEventListener("click", () => { state.queue = []; state.queueIndex = -1; renderQueue(); });

  let queueRunning = false;
  async function processQueue() {
    if (queueRunning) return; queueRunning = true;
    try {
      for (let i = 0; i < state.queue.length; i++) {
        const q = state.queue[i];
        if (q.status !== "queued") continue;
        q.status = "measuring"; renderQueue();
        try {
          const img = await PQA.decode(q.file);
          const M = await PQA.measure(img, () => { });
          const R = PQA.grade(img, M, readSettings());
          q.status = "done"; q.dims = `${img.w.toLocaleString()}×${img.h.toLocaleString()}`; q.tiers = queueTiers(R);
        } catch (e) { q.status = "error"; q.error = e.message || String(e); }
        renderQueue();
      }
    } finally { queueRunning = false; }
  }
  function selectQueue(i) {
    const q = state.queue[i]; if (!q) return;
    state.queueIndex = i; renderQueue();
    loadFile(q.file);
  }
  async function loadFiles(fileList) {
    const all = [...fileList], files = all.filter(f => ACCEPT_RE.test(f.name));
    if (!files.length) { setStatus("No supported files in that selection. Supported: PNG, JPEG, WebP, TIFF, PDF.", null, true); return; }
    const firstNew = state.queue.length;
    files.forEach(f => state.queue.push({ file: f, name: f.name, status: "queued", tiers: null, dims: null, error: null }));
    renderQueue();
    if (files.length < all.length) setStatus(`Added ${files.length} of ${all.length} file(s); ${all.length - files.length} unsupported skipped.`, null);
    if (state.queueIndex < 0) selectQueue(firstNew);   // nothing open (or the sample is showing): show the first new file now
    processQueue();                                    // fills in the rest in the background
  }

  /* ---------- orchestration ---------- */
  function regrade() {
    if (!state.M) return;
    state.R = PQA.grade(state.img, state.M, readSettings());
    renderTicket(state.img, state.R); renderStrip(state.M); renderTiers(); drawOverlay();
    renderShadows(); renderLegibility(); renderMatrix(); renderChecklist();
    if (state.expert) renderExpert(state.expert);
  }

  async function run(img) {
    if (state.busy) return;
    const qi = state.queueIndex;
    state.busy = true; state.img = img; state.M = null; state.R = null; state.expert = null;
    if (state.ctl) state.ctl.abort();
    $("expertOut").innerHTML = "<p>No review yet for this file.</p>";
    renderTicket(img, null); drawProof(img.full); $("legend").textContent = "";
    updateAsk();
    const t0 = performance.now();
    try {
      state.M = await PQA.measure(img, (p, msg) => setStatus(msg + "…", p));
      drawProof(state.M.acan);
      regrade();
      setStatus(`Measured ${img.w.toLocaleString()} × ${img.h.toLocaleString()} px in ${((performance.now() - t0) / 1000).toFixed(1)} s`, 1);
      if (qi >= 0 && state.queue[qi]) {
        const q = state.queue[qi];
        q.status = "done"; q.dims = `${img.w.toLocaleString()}×${img.h.toLocaleString()}`; q.tiers = queueTiers(state.R); q.error = null;
        renderQueue();
      }
    } catch (e) {
      console.error(e);
      setStatus(e.message || "Measurement failed. Try a PNG or TIFF export of the artwork.", 0, true);
      if (qi >= 0 && state.queue[qi]) { state.queue[qi].status = "error"; state.queue[qi].error = e.message || String(e); renderQueue(); }
    } finally { state.busy = false; updateAsk(); }
  }

  async function loadFile(file) {
    if (!file) return;
    if (state.busy) { setStatus("Still measuring the current file. Load the next one when it finishes.", null, true); return; }
    setStatus(`Decoding ${file.name}…`, 0.02);
    try { run(await PQA.decode(file)); }
    catch (e) { console.error(e); setStatus(e.message || "This file could not be read.", 0, true); }
  }
  $("file").addEventListener("change", e => { loadFiles(e.target.files); e.target.value = ""; });
  $("fileBtn").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
  $("sampleBtn").addEventListener("click", () => { state.queueIndex = -1; renderQueue(); run(PQA.makeSample()); });
  let dragDepth = 0;
  window.addEventListener("dragenter", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { dragDepth++; document.body.classList.add("dragging"); } });
  window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
  window.addEventListener("dragover", e => e.preventDefault());
  window.addEventListener("drop", e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging"); loadFiles(e.dataTransfer.files); });

  /* ---------- expert review ---------- */
  function updateAsk() {
    $("askBtn").disabled = !state.sample || !state.M || state.busy;
  }
  const toBlob = (canvas, type = "image/jpeg", q = 0.9) => new Promise(res => canvas.toBlob(res, type, q));
  async function previewBlob(src, max) {
    const k = Math.min(1, max / Math.max(src.width, src.height)), c = document.createElement("canvas");
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, c.width, c.height);
    return toBlob(c);
  }
  async function runExpert() {
    const { img, M, R } = state; if (!img || !M || !state.sample) return;
    const ctl = new AbortController(); state.ctl = ctl;
    $("askBtn").disabled = true; $("stopBtn").hidden = false;
    $("expertOut").innerHTML = '<p class="thinking"><i></i><span id="thinkText">Reviewing the artwork and measurements…</span></p>';
    $("expertStatus").textContent = "Usually 30–90 seconds";
    try {
      const images = [];
      if (state.limits && state.limits.images) {
        images.push(await previewBlob(M.acan, 1600));
        if (state.limits.images.maxCount >= 2) {
          const cr = M.detail.crop, c = document.createElement("canvas"); c.width = c.height = cr.size;
          c.getContext("2d").drawImage(img.full, cr.x, cr.y, cr.size, cr.size, 0, 0, cr.size, cr.size);
          images.push(await toBlob(c, "image/png"));
        }
      }
      let prompt = PQA.buildPrompt(img, M, R, readSettings());
      if (images.length === 2) prompt += "\n\nImage 1 is the whole artwork, downsized. Image 2 is a 1:1 pixel crop from the full-resolution file where fine detail is densest; use it to judge real sharpness, upscaling artefacts and hairlines.";
      if (!images.length) prompt = "No image could be attached in this view, so judge from the measured data alone and say so in the verdict.\n\n" + prompt;
      const out = await state.sample.json(prompt, {
        images: images.length ? images : undefined, signal: ctl.signal,
        onText: ({ text }) => { const t = $("thinkText"); if (t) t.textContent = `Writing the review… ${text.length.toLocaleString()} characters`; }
      });
      if (state.img !== img) return;
      state.expert = out;
      renderExpert(out); renderChecklist();
      $("expertStatus").textContent = "Review complete. Expert actions were added to the checklist.";
    } catch (e) {
      const msg = {
        cancelled: "Review stopped.",
        not_granted: "The review was declined in the permission prompt. Reload the page to be asked again.",
        rate_limited: "Too many reviews in a short time. Wait a minute, then run it again.",
        invalid_json: "The review came back in an unreadable format. Run it again.",
        image_rejected: "The preview image was rejected. Run it again; if it keeps failing, load a smaller export.",
        prompt_too_large: "The measurement data was too large to send."
      }[e && e.code] || (e && e.message) || "The review failed. Run it again.";
      $("expertOut").innerHTML = `<p>${esc(msg)}</p>`;
      $("expertStatus").textContent = e && e.code === "not_granted" ? "Not allowed in this view" : "Ready";
    } finally {
      $("stopBtn").hidden = true; state.ctl = null; updateAsk();
    }
  }
  function renderExpert(x) {
    const R = state.R, adj = Array.isArray(x.adjustments) ? x.adjustments : [];
    const rows = R.tiers.map(t => {
      const a = adj.find(v => String(v.tier).toUpperCase() === t.id) || {};
      const s = typeof a.score === "number" ? clamp(a.score, 1, 10) : null, tone = s != null ? PQA.tone(s) : "rule";
      return `<tr><td><b>Tier ${t.id}</b></td><td class="num">${t.score.toFixed(1)}</td><td>${s != null ? `<span class="score-chip" style="--tone:var(--${tone});--tone-soft:var(--${tone}-soft)">${s.toFixed(1)}</span>` : "—"}</td><td>${esc(a.reason || "")}</td></tr>`;
    }).join("");
    const list = arr => Array.isArray(arr) && arr.length ? `<ul>${arr.map(o => `<li>${esc(o)}</li>`).join("")}</ul>` : "<p>None noted.</p>";
    $("expertOut").innerHTML = `<p style="color:var(--ink);font-size:1.02rem"><b>${esc(x.verdict || "")}</b></p>
      <div class="matrix-wrap" style="margin:0"><table><thead><tr><th>Tier</th><th>Measured</th><th>Reviewed</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3>Shadows, blending &amp; transparency</h3><p>${esc(x.shadows || "")}</p>
      <h3>Legibility &amp; ink</h3><p>${esc(x.legibility || "")}</p>
      <h3>What the measurements could not see</h3>${list(x.observations)}`;
  }
  $("askBtn").addEventListener("click", runExpert);
  $("stopBtn").addEventListener("click", () => state.ctl && state.ctl.abort());

  /* ---------- report export ---------- */
  function reportMarkdown() {
    const { img, M, R, expert, findings } = state, set = readSettings();
    const strip = s => String(s).replace(/<[^>]+>/g, "");
    let md = `# Print quality audit: ${img.name}\n\n`;
    md += `- Pixels: ${img.w} × ${img.h} · ${img.format} · ${img.mode} ${img.bits}-bit · profile: ${img.iccDesc || (img.icc ? "embedded" : "none")} · tag: ${img.dpi || "none"} PPI\n`;
    md += `- Job: ${set.wCm} × ${set.hCm} cm, ${set.fit === "cover" ? "full bleed" : "fit inside"}, viewed at ${set.distC} cm, ${R.sub.name} (${R.sub.limit}% ink limit)\n`;
    md += `- Real detail: ${Math.round(M.detail.factor * 100)}% of pixel count\n\n## Master audit matrix\n\n| Tier | Format | Effective PPI | Finest line | Score | Primary bottleneck |\n|---|---|---|---|---|---|\n`;
    R.tiers.forEach(t => { md += `| ${t.id} · ${t.name} | ${t.ex} | ${Math.round(t.eff)} (target ${t.targetLabel}) | ${t.finestPt ? t.finestPt.toFixed(2) + " pt" : "—"} (min ${t.minPt} pt) | **${t.score.toFixed(1)}** ${PQA.verdict(t.score)} | ${t.bottleneck ? `${t.bottleneck.label}: ${t.bottleneck.value}` : "None"} |\n`; });
    md += `\n## Checks by tier\n\n| Check | A | B | C |\n|---|---|---|---|\n`;
    R.tiers[0].comps.forEach((c, i) => { md += `| ${c.label} | ${R.tiers.map(t => `${t.comps[i].s.toFixed(1)} (${t.comps[i].value})`).join(" | ")} |\n`; });
    [["Shadows, blending & transparency", findings.shadows], ["Legibility & ink saturation", findings.legibility]].forEach(([h, F]) => {
      md += `\n## ${h}\n\n`; (F || []).forEach(f => { md += `**${f[0]}** (${f[1]}). ${strip(f[2])}\n\n`; });
    });
    md += `## Rectification checklist\n`;
    R.checklist.forEach(g => { md += `\n### ${g.title}\n\n`; g.items.forEach(it => { md += `- [ ] **${it.title}** (${it.sev}). ${strip(it.detail)}\n`; }); });
    if (expert) {
      md += `\n## Expert review\n\n${expert.verdict || ""}\n\n`;
      (expert.adjustments || []).forEach(a => { md += `- Tier ${a.tier}: ${a.score} (${a.reason})\n`; });
      md += `\n${expert.shadows || ""}\n\n${expert.legibility || ""}\n\n`;
      (expert.observations || []).forEach(o => { md += `- ${o}\n`; });
      (expert.actions || []).forEach(a => { md += `- [ ] **${a.area}**: ${a.step}\n`; });
    }
    return md;
  }
  $("exportBtn").addEventListener("click", async () => {
    if (!state.downloads || !state.R) return;
    try {
      await state.downloads.save({ filename: `print-audit-${state.img.name.replace(/\.[^.]+$/, "")}.md`, data: reportMarkdown() });
      setStatus("Report saved", 1);
    } catch (e) { if (e && e.code !== "cancelled" && e.code !== "declined") setStatus("The report could not be saved: " + (e.message || e.code), null, true); }
  });

  /* ---------- boot ---------- */
  renderStrip(null);
  run(PQA.makeSample());
  (async () => {
    if (!window.claude || typeof window.claude.use !== "function") { $("expertStatus").textContent = "Open this page in Claude to run the review"; return; }
    const [sample, downloads] = await Promise.all([window.claude.use("sample"), window.claude.use("downloads")]);
    state.sample = sample; state.downloads = downloads;
    $("exportBtn").hidden = !downloads;
    if (sample) {
      state.limits = await sample.limits().catch(() => null);
      $("expertStatus").textContent = state.limits && state.limits.images ? "Sends a preview and a 1:1 crop with the measurements" : "Sends the measurements (images are not available in this view)";
    } else $("expertStatus").textContent = "The expert review is not available in this view";
    updateAsk();
  })();
})();
