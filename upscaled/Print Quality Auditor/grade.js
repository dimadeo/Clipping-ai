/* Print Quality Auditor — turns pixel measurements into physical units, tier scores, findings and the rectification checklist. */
(function () {
  "use strict";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r1 = v => Math.round(v * 10) / 10;
  const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";

  const SUBSTRATES = {
    coated: { name: "Coated paper", limit: 300, rmin: 0.013, white: 0.88, spread: 0.02, reg: 0.08, profile: "PSO Coated v3 (FOGRA51) or ISO Coated v2 (FOGRA39)" },
    uncoated: { name: "Uncoated paper", limit: 260, rmin: 0.032, white: 0.82, spread: 0.045, reg: 0.1, profile: "PSO Uncoated v3 (FOGRA52) or PSO Uncoated ISO12647 (FOGRA47)" },
    canvas: { name: "Canvas / fine-art inkjet", limit: 280, rmin: 0.025, white: 0.84, spread: 0.05, reg: 0, profile: "the shop's canvas + ink ICC profile (ask for it by name)" },
    vinyl: { name: "Banner vinyl", limit: 300, rmin: 0.02, white: 0.86, spread: 0.04, reg: 0, profile: "the shop's solvent/latex vinyl ICC profile" },
    textile: { name: "Textile", limit: 250, rmin: 0.05, white: 0.8, spread: 0.08, reg: 0, profile: "the shop's fabric + ink ICC profile" }
  };
  const LIGHTS = [
    { id: "gallery", name: "Gallery, diffuse", note: "500 lux, no specular glare", veil: 0.004 },
    { id: "retail", name: "Retail / office", note: "Overhead LEDs, light sheen", veil: 0.025 },
    { id: "window", name: "Window glare", note: "Daylight reflecting off the surface", veil: 0.07 }
  ];

  function scoreRatio(r) {
    if (r >= 2) return 10;
    if (r >= 1) return 9 + (r - 1);
    if (r >= 0.75) return 7 + (r - 0.75) / 0.25 * 1.9;
    return clamp(1 + (r - 0.25) / 0.5 * 5.9, 1, 6.9);
  }
  function scorePPI(ppi, target, ideal) {
    if (ppi >= ideal) return 10;
    if (ppi >= target) return 9 + (ppi - target) / (ideal - target);
    const r = ppi / target;
    if (r >= 0.8) return 7 + (r - 0.8) / 0.2 * 1.9;
    return clamp(1 + (r - 0.3) / 0.5 * 5.9, 1, 6.9);
  }
  const tone = s => s >= 9 ? "pass" : s >= 7 ? "warn" : "fail";
  const verdict = s => s >= 9 ? "Production ready" : s >= 7 ? "Acceptable with caveats" : "Critical failure";
  const MASTER_FINE_ART_AUDITOR_DIRECTIVE = [
    "MASTER FINE ART PRINT AUDITOR", 
    "Role: independent fine art / giclee quality-control and printer handoff system.",
    "Function: inspect, measure, verify, calculate, test, classify, report.",
    "Never create, enhance, upscale, retouch, beautify or modify artwork.",
    "",
    "INDEPENDENCE PRINCIPLE",
    "Do not trust file names, metadata tags, prior claims, prior approvals, or previous AI reports.",
    "Approve only when checks pass on measured evidence.",
    "",
    "ABSOLUTE TRUTH RULE",
    "Never fabricate technical facts. Do not claim 300 DPI, 16-bit, Adobe RGB, or print ready unless verified.",
    "Preferred labels: Fine Art / Giclee Print Ready or Professional Fine Art Master when justified.",
    "",
    "FINAL STATUS (exactly one)",
    "APPROVED",
    "APPROVED WITH NOTES",
    "CONDITIONAL APPROVAL",
    "HOLD - CORRECTION REQUIRED",
    "REJECTED",
    "",
    "SUPPORTED PRODUCTION RANGE",
    "2A0, A0, A1, A2, A3, A4, and 1:1 custom square in portrait or landscape.",
    "Use 300-DPI matrix checks and independent effective-DPI calculation.",
    "",
    "MANDATORY AUDITS",
    "1) File identity: filename, extension, bytes, width, height, total pixels, megapixels, ratio, orientation, bit depth, channels, alpha, ICC/profile, color space, DPI tag, compression, audit date, SHA-256 where possible.",
    "2) File integrity: decode/read validity, channel integrity, metadata sanity, profile consistency, transparency sanity.",
    "3) True DPI: compute effective DPI from pixels and physical inches for each axis; compare to requested DPI.",
    "4) Print-size validation: requested size, max recommended 300-DPI size, and max recommended 240-DPI size when relevant.",
    "5) Aspect-ratio audit: detect preserve, crop, extend, full bleed, bordered presentation; stretching is automatic failure.",
    "6) Clarity inspection: fit view + 100% + 200% + 400% equivalent; separate artistic softness from technical defects.",
    "7) Pixelation + upscaling artefacts + sharpening + noise/grain + banding/gradient checks.",
    "8) Color/ICC audit: embedded ICC yes/no + profile name; no guessing; printer confirmation required when ICC missing.",
    "9) RGB/CMYK rule: report actual color space; do not force arbitrary CMYK conversion.",
    "10) Bit-depth + tonal-range + shadow-risk warning with practical print implications.",
    "",
    "OUTPUT REQUIREMENT",
    "Return factual, printer-ready guidance based on measured data and visible evidence.",
  ].join("\n");

  function histQuantile(hist, q, from = 1) {
    let tot = 0; for (let i = from; i < hist.length; i++) tot += hist[i];
    if (!tot) return 0;
    let acc = 0; for (let i = from; i < hist.length; i++) { acc += hist[i]; if (acc >= tot * q) return i; }
    return hist.length - 1;
  }

  function grade(img, M, set) {
    const sub = SUBSTRATES[set.substrate] || SUBSTRATES.canvas;
    const landscape = img.w >= img.h;
    const orient = (a, b) => (landscape ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)]);
    const defs = [
      { id: "A", name: "Small format", sub: "High density", ex: "Business card 85 × 55 mm", mm: [85, 55], target: 300, ideal: 600, targetLabel: "300–600", minPt: 0.25, distCm: 30, reg: sub.reg || 0.08, wBlack: [7.2, 8.4] },
      { id: "B", name: "Standard format", sub: "Medium density", ex: "A4 flyer 210 × 297 mm", mm: [210, 297], target: 300, ideal: 400, targetLabel: "300", minPt: 0.5, distCm: 45, reg: sub.reg || 0.08, wBlack: [7.8, 8.8] },
      { id: "C", name: "Large format", sub: "Low density", ex: `${set.wCm} × ${set.hCm} cm`, mm: [set.wCm * 10, set.hCm * 10], target: 100, ideal: 150, targetLabel: "100–150", minPt: 1, distCm: set.distC, reg: sub.reg || 0.2, wBlack: [8.8, 9.4], isJob: true }
    ];

    /* tier-independent measures */
    const lines = M.lines;
    const widthAll = new Float64Array(16);
    for (let i = 0; i < 16; i++) widthAll[i] = lines.widthDark[i] + lines.widthRev[i];
    const lineTotal = widthAll.reduce((a, b) => a + b, 0) * lines.step;
    const finestPx = lineTotal >= 300 ? histQuantile(widthAll, 0.02) : null;
    const tacOver = (() => { let n = 0; for (let t = sub.limit + 1; t <= 400; t++) n += M.tacHist[t]; return n / M.N; })();
    const lh = M.lumHist, pileLo = lh[0] + lh[1] + lh[2] + lh[3], nearLo = (lh[4] + lh[5] + lh[6] + lh[7] + lh[8] + lh[9] + lh[10]) / 7 * 4;
    const crushed = M.clipLo > 0.02 && pileLo > 8 * (nearLo + 1);

    /* contrast of strong strokes (likely type and linework) under lighting */
    const P = M.pairs, lights = LIGHTS.map(L => ({ ...L, n: 0, pass: 0, crs: [] }));
    for (let i = 0; i < P.length; i += 4) {
      const Yf = P[i], Yb = P[i + 1];
      const gap = Math.abs(Math.pow(Yf, 1 / 2.2) - Math.pow(Yb, 1 / 2.2)) * 255;
      if (gap < 60) continue;
      const Rf = sub.rmin + (sub.white - sub.rmin) * Yf, Rb = sub.rmin + (sub.white - sub.rmin) * Yb;
      for (const L of lights) {
        const cr = (Math.max(Rf, Rb) + L.veil) / (Math.min(Rf, Rb) + L.veil);
        L.n++; if (cr >= 4.5) L.pass++; if (L.crs.length < 6000) L.crs.push(cr);
      }
    }
    lights.forEach(L => { L.crs.sort((a, b) => a - b); L.median = L.crs.length ? L.crs[L.crs.length >> 1] : 0; L.p10 = L.crs.length ? L.crs[(L.crs.length * 0.1) | 0] : 0; L.passRate = L.n ? L.pass / L.n : 1; delete L.crs; });
    const strongStrokes = lights[0].n;

    const alphaScore = (() => {
      const a = M.alpha;
      if (a && a.semi > 0.001 && a.semiWhite > 0.3) return { s: 6.4, key: "white-matte" };
      if (a && a.semi > 0.001 && a.semiDark > 0.3) return { s: 7.9, key: "alpha-shadow" };
      if (a && a.semi > 0.001) return { s: 8.6, key: "alpha" };
      if (M.border.kind === "white") return { s: 8.2, key: "white-box" };
      return { s: 10, key: "none" };
    })();

    const tacScore = (() => {
      const f = tacOver;
      if (f < 0.001) return M.tacP999 <= sub.limit ? 10 : 9.4;
      if (f < 0.01) return 9 - (f - 0.001) / 0.009 * 0.5;
      if (f < 0.05) return 8.5 - (f - 0.01) / 0.04 * 1.6;
      return clamp(6.9 - (f - 0.05) * 20, 2, 6.9);
    })();
    const clipScore = crushed ? (M.clipLo > 0.12 ? 6.2 : M.clipLo > 0.05 ? 7.4 : 8.4) : M.clipLo > 0.005 ? 9.3 : 10;
    const contrastScore = strongStrokes < 200 ? 10 : (() => {
      const pr = lights[1].passRate;
      if (pr >= 0.95) return 9.2 + (pr - 0.95) * 16;
      if (pr >= 0.8) return 7 + (pr - 0.8) / 0.15 * 2;
      return clamp(1 + pr / 0.8 * 5.9, 1, 6.9);
    })();

    const tiers = defs.map(d => {
      const [wmm, hmm] = orient(d.mm[0], d.mm[1]);
      const wIn = wmm / 25.4, hIn = hmm / 25.4;
      /* full bleed must cover both axes, so the tighter axis sets PPI; fit-inside is set by the axis that touches the trim */
      const ppi = set.fit === "contain" ? Math.max(img.w / wIn, img.h / hIn) : Math.min(img.w / wIn, img.h / hIn);
      const eff = ppi * M.detail.factor;
      const distIn = d.distCm / 2.54, acuity = 3438 / distIn;
      const comps = [];
      const add = (key, label, s, weight, value, note, critical = true) => comps.push({ key, label, s: r1(clamp(s, 1, 10)), weight, value, note, critical });

      add("res", "Effective resolution", scorePPI(eff, d.target, d.ideal), 1.2, `${Math.round(eff)} PPI`, `Target ${d.targetLabel} PPI${M.detail.factor < 1 ? ` · ${Math.round(ppi)} nominal × ${M.detail.factor} real detail` : ""}`);
      const vr = eff / acuity;
      add("view", "Pixels at viewing distance", vr >= 1 ? 9 + Math.min(1, (vr - 1) / 0.5) : vr >= 0.6 ? 7 + (vr - 0.6) / 0.4 * 1.9 : clamp(1 + (vr - 0.2) / 0.4 * 5.9, 1, 6.9), 0.8, `${Math.round(acuity)} PPI needed`, `1 arc-minute at ${d.distCm} cm`);

      let lineS = 10, finestPt = null, fracBelow = 0;
      if (finestPx) {
        finestPt = finestPx / ppi * 72;
        const minPx = d.minPt / 72 * ppi; let below = 0, tot = 0;
        for (let i = 1; i < 16; i++) { tot += widthAll[i]; if (i < minPx) below += widthAll[i]; }
        fracBelow = tot ? below / tot : 0;
        lineS = scoreRatio(finestPt / d.minPt);
        if (fracBelow < 0.005) lineS = Math.max(lineS, 9); else if (fracBelow < 0.03) lineS = Math.max(lineS, 7.5);
      }
      add("line", "Line-weight compliance", lineS, 1, finestPt ? `${finestPt.toFixed(2)} pt` : "No hairlines", finestPt ? `Min ${d.minPt} pt · ${pct(fracBelow)} of linework below` : "No fine strokes detected");

      const bandMm = M.band.p90 / M.s / ppi * 25.4, arcmin = bandMm / (d.distCm * 10) * 3438;
      let bandS = 10;
      if (M.band.steppedFrac >= 0.002) {
        const v = arcmin / 3;
        bandS = v <= 0.5 ? 9.6 : v <= 1 ? 9.6 - (v - 0.5) * 1.4 : v <= 2 ? 8.9 - (v - 1) * 1.9 : Math.max(3, 7 - (v - 2) * 1.5);
        if (M.band.steppedFrac < 0.02) bandS = Math.max(bandS, 8);
        if (M.band.posterFrac > 0.2) bandS -= 0.5;
      }
      add("band", "Shadow gradient banding", bandS, 0.8, M.band.steppedFrac >= 0.002 ? `${bandMm.toFixed(1)} mm steps` : "Smooth", M.band.steppedFrac >= 0.002 ? `${arcmin.toFixed(1)} arc-min wide · ${pct(M.band.steppedFrac)} of area` : "No stepped gradients found");

      add("tac", "Ink coverage (TAC)", tacScore, 0.8, `${M.tacP999}% peak`, `Limit ${sub.limit}% · ${pct(tacOver, 2)} of area over`);
      add("clip", "Shadow clipping", clipScore, 0.5, pct(M.clipLo), crushed ? "Shadows pile up at black" : "Shadow detail holds", false);

      let chokeS = 10, chokeFrac = 0;
      const revTot = lines.revOnDarkTotal * lines.step;
      if (revTot >= 200) {
        let choked = 0;
        for (let i = 1; i < 16; i++) if (i / ppi * 25.4 < 4 * sub.spread) choked += lines.revOnDark[i];
        chokeFrac = choked / lines.revOnDarkTotal;
        chokeS = chokeFrac < 0.02 ? 9.5 : chokeFrac < 0.1 ? 9 - (chokeFrac - 0.02) / 0.08 * 2 : chokeFrac < 0.3 ? 7 - (chokeFrac - 0.1) / 0.2 * 2 : 3.5;
        if (lines.revOnDarkTac > sub.limit - 20) chokeS -= 0.5;
      }
      add("choke", "Reversed detail on shadows", chokeS, 0.7, revTot >= 200 ? `${pct(chokeFrac, 0)} chokes` : "None", revTot >= 200 ? `Ink spread ${sub.spread} mm per edge on ${sub.name.toLowerCase()}` : "No light strokes on dark areas", true);

      add("contrast", "Stroke contrast in glare", contrastScore, d.id === "C" ? 0.4 : 0.6, strongStrokes >= 200 ? `${pct(lights[1].passRate, 0)} ≥ 4.5:1` : "n/a", "Retail lighting, strong strokes only", false);
      add("alpha", "Transparency & halos", alphaScore.s, 0.6, { "white-matte": "White matte", "alpha-shadow": "Live alpha shadow", alpha: "Live alpha", "white-box": "Baked white box", none: "Clean" }[alphaScore.key], M.alpha ? `${pct(M.alpha.semi, 2)} semi-transparent px` : "Flattened file", false);

      const bl = lines.blackLineFrac;
      const blackS = bl > 0.05 ? d.wBlack[0] : bl > 0.01 ? d.wBlack[1] : 10;
      add("black", "Black build & registration", blackS, 0.5, pct(M.neutralBlack), bl > 0.01 ? `${pct(bl, 0)} of fine strokes are RGB black → 4-plate` : "Little fine RGB-black detail", false);

      const crit = comps.filter(c => c.critical), wsum = comps.reduce((a, c) => a + c.weight, 0);
      const wmean = comps.reduce((a, c) => a + c.s * c.weight, 0) / wsum;
      const minCrit = Math.min(...crit.map(c => c.s)), minAll = Math.min(...comps.map(c => c.s));
      const score = r1(clamp(Math.min(0.5 * minCrit + 0.5 * wmean, minAll + 2.5), 1, 10));
      const worst = comps.slice().sort((a, b) => a.s - b.s)[0];
      return {
        ...d, wmm, hmm, wIn, hIn, ppi, eff, acuity, finestPt, fracBelow, bandMm, arcmin, chokeFrac, comps, score,
        bottleneck: worst.s >= 9.95 ? null : worst,
        printIn: [img.w / ppi, img.h / ppi]
      };
    });

    const R = { sub, tiers, lights, tacOver, crushed, strongStrokes, finestPx, lineTotal, alphaKey: alphaScore.key, job: tiers[2] };
    R.checklist = checklist(img, M, R, set);
    return R;
  }

  /* ---------- rectification checklist ---------- */
  function checklist(img, M, R, set) {
    const C = R.job, A = R.tiers[0], B = R.tiers[1], sub = R.sub, groups = [];
    const g = (title) => { const o = { title, items: [] }; groups.push(o); return o.items; };
    const item = (arr, sev, title, detail) => arr.push({ sev, title, detail, id: (title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()).slice(0, 48) });

    const res = g("Resolution & resampling");
    const needW = Math.ceil(C.wIn * 150), needH = Math.ceil(C.hIn * 150);
    if (C.eff < 100) item(res, "fail", `Rebuild the raster for ${set.wCm} × ${set.hCm} cm`, `At full bleed the file delivers <b>${Math.round(C.eff)} effective PPI</b>. Go back to the original master (not this file) and produce at least <code>${needW} × ${needH} px</code> (150 PPI), or reduce the print to ≤ <code>${(img.w / 100 * 2.54 * M.detail.factor).toFixed(0)} × ${(img.h / 100 * 2.54 * M.detail.factor).toFixed(0)} cm</code> to hold 100 PPI.`);
    else if (C.eff < 150) item(res, "warn", "Resolution sits in the lower half of the large-format window", `${Math.round(C.eff)} effective PPI is acceptable at ${set.distC} cm. For close inspection, target <code>${needW} × ${needH} px</code>.`);
    else item(res, "pass", "Large-format resolution meets target", `${Math.round(C.eff)} effective PPI against a 100–150 PPI window.`);
    if (M.detail.factor < 1) item(res, M.detail.factor <= 0.5 ? "fail" : "warn", "The file is softer than its pixel count", `A crop survives downsampling to <b>${Math.round(M.detail.factor * 100)}%</b> and back with ≥ 36 dB PSNR, so most of its pixels were interpolated. Upscale once from the source with a detail-preserving model; don't stack resamples, and don't sharpen at export beyond a 0.3–0.5 px unsharp mask at final size.`);
    if (A.eff < 300 || B.eff < 300) item(res, "warn", "Don't reuse this file for cards or flyers at full bleed", `Tier A delivers ${Math.round(A.eff)} and Tier B ${Math.round(B.eff)} effective PPI, against 300. Vector-native type and logos should be placed live in the layout, not baked into the raster.`);
    const ppiTag = Math.round(C.ppi);
    if (!img.dpi || Math.abs(img.dpi - ppiTag) > 1) item(res, "warn", `Set the resolution tag to ${ppiTag} PPI without resampling`, `The file says ${img.dpi ? img.dpi + " PPI" : "no resolution"}; at ${set.wCm} × ${set.hCm} cm it is really ${ppiTag} PPI. Photoshop: <code>Image ▸ Image Size</code>, untick <b>Resample</b>, type the width in cm.`);

    const sh = g("Shadows, transparency & black");
    if (C.comps.find(c => c.key === "band").s < 9) item(sh, C.comps.find(c => c.key === "band").s < 7 ? "fail" : "warn", "Break up the stepped shadow gradients", `${(M.band.steppedFrac * 100).toFixed(1)}% of the image is a smooth dark gradient stepping in ${C.bandMm.toFixed(1)} mm bands at print size. Rebuild those gradients in <b>16-bit</b>, add 0.6–1.2% <b>monochromatic Gaussian noise</b> (<code>Filter ▸ Noise ▸ Add Noise</code>) on a masked layer over the shadow, then convert to 8-bit with dither enabled.`);
    else item(sh, "pass", "Shadow gradients render as continuous tone", "No wide 8-bit plateaus in dark gradients.");
    if (R.alphaKey === "white-matte") item(sh, "fail", "Remove the white matte from semi-transparent edges", "Soft edges carry white RGB under partial alpha, which prints as a pale halo over any dark background. Use <code>Layer ▸ Matting ▸ Remove White Matte</code>, or place the element over its real background and flatten before export.");
    if (R.alphaKey === "alpha-shadow" || R.alphaKey === "alpha") item(sh, "warn", "Flatten the live transparency against the real background", "The shadow is black pixels with partial alpha. Put it on its own layer set to <b>Multiply</b> over the final background, then <code>Layer ▸ Flatten Image</code>. In a PDF workflow, keep live transparency only for PDF/X-4 on an APPE RIP; otherwise flatten with the <b>High Resolution</b> preset.");
    if (R.alphaKey === "white-box") item(sh, "warn", "The artwork has a baked-in white background", "The border is flat white. On coloured stock, or placed on a tinted layout, it prints as a white box. Mask the subject out, or confirm the print will be on white stock.");
    if (M.neutralBlack > 0.005) item(sh, "warn", "Rebuild neutral RGB black before separation", `${(M.neutralBlack * 100).toFixed(1)}% of the area is RGB 0,0,0, which a default conversion turns into roughly <code>C74 M70 Y68 K92</code> (~304%). Large solids: set a controlled rich black <code>C60 M40 Y40 K100</code> (240%). Type and rules under 12 pt: <code>K100</code> only, set to overprint, so misregistration cannot fringe the edges.`);
    if (R.crushed) item(sh, "warn", "Reopen crushed shadow detail", `${(M.clipLo * 100).toFixed(1)}% of pixels sit at the black floor. Use a Curves toe lift and set Levels output black to 8–12 (3–5%). Soft-proof with <b>Simulate Black Ink</b> on the shop profile.`);

    const ink = g("Ink & colour management");
    if (R.tacOver > 0.001) item(ink, R.tacOver > 0.05 ? "fail" : "warn", `Bring total ink under ${sub.limit}%`, `${(R.tacOver * 100).toFixed(2)}% of the area is over the limit (peak ${M.tacP999}%). Convert with <code>Edit ▸ Convert to Profile</code> → ${sub.profile}, Perceptual intent, Black Point Compensation on. For a custom separation use GCR Heavy with a ${sub.limit}% total ink limit, then check the darkest patches in the Info panel.`);
    else item(ink, "pass", `Ink coverage stays within ${sub.limit}%`, `Peak simulated TAC is ${M.tacP999}%.`);
    if (!img.icc) item(ink, "fail", "Embed an ICC profile", "The file has no colour profile, so the RIP will guess. Photoshop: <code>Edit ▸ Assign Profile ▸ sRGB IEC61966-2.1</code> (if that is what you designed in), then save with <b>Embed Color Profile</b> ticked.");
    else item(ink, "pass", "Colour profile embedded", img.iccDesc || "ICC present");
    if (img.mode === "RGB") item(ink, "std", "Confirm who separates to CMYK", `Wide-format and textile shops usually want RGB with the profile embedded; litho shops usually want CMYK. Ask, then either keep RGB or convert once to ${sub.profile}.`);

    const lt = g("Linework & type");
    const lineC = C.comps.find(c => c.key === "line"), lineA = A.comps.find(c => c.key === "line");
    if (R.finestPx && lineC.s < 9) item(lt, lineC.s < 7 ? "fail" : "warn", "Thicken hairlines for large format", `The finest 2% of strokes are <b>${C.finestPt.toFixed(2)} pt</b> at ${set.wCm} × ${set.hCm} cm, below the 1 pt minimum. In vector, set strokes ≥ 1 pt. In raster, redraw them at ≥ <code>${Math.ceil(C.ppi / 72)} px</code> wide at final resolution.`);
    else if (R.finestPx) item(lt, "pass", "Linework clears the large-format minimum", `Finest strokes measure ${C.finestPt.toFixed(2)} pt at final size.`);
    if (R.finestPx && lineA.s < 7) item(lt, "warn", "Hairlines would break up at card size", `The same strokes shrink to ${A.finestPt.toFixed(2)} pt at 85 × 55 mm (minimum 0.25 pt).`);
    const chokeC = C.comps.find(c => c.key === "choke");
    if (chokeC.s < 9) item(lt, chokeC.s < 7 ? "fail" : "warn", "Protect light type reversed out of shadows", `${Math.round(C.chokeFrac * 100)}% of the light strokes on dark areas are narrower than 4× the ink spread (${sub.spread} mm per edge). Set reversed type at ≥ 8 pt sans or 10 pt serif, Regular weight or heavier. Add a 0.15–0.25 pt stroke in the type colour, and keep the background under ${sub.limit - 40}% TAC behind it.`);
    if (R.lights[1].passRate < 0.9 && R.strongStrokes >= 200) item(lt, "warn", "Raise stroke contrast for lit environments", `Only ${Math.round(R.lights[1].passRate * 100)}% of strong strokes keep 4.5:1 once ${sub.name.toLowerCase()} is under retail lighting. Widen the luminance gap between type and background, or specify a matte/satin laminate to cut the sheen.`);

    const ex = g("Export configuration");
    const bleed = set.substrate === "canvas" ? "gallery-wrap depth + 5 mm" : set.substrate === "vinyl" ? "10 mm (plus hem/eyelet allowance)" : "3 mm";
    item(ex, "std", "Export at final size with bleed", `Deliver ${set.wCm} × ${set.hCm} cm plus <b>${bleed}</b> bleed per side. Keep type and key detail ≥ ${set.substrate === "canvas" ? "20 mm plus wrap depth" : "5 mm"} inside the trim.`);
    item(ex, "std", "Choose a lossless, flattened container", "Use <b>PDF/X-4:2010</b> with image compression set to ZIP (never JPEG on shadows), or a single-layer <b>TIFF with LZW</b>. Include the output intent or embedded profile, and add crop marks offset 3 mm outside the bleed.");
    item(ex, "std", "Run a final preflight on the exported file", "Acrobat: <code>Print Production ▸ Preflight ▸ PDF/X-4 compliance</code>, then Output Preview with <b>Total Area Coverage</b> set to the ink limit. Load that export back into this page to confirm the scores.");
    return groups;
  }

  /* ---------- prompt for the expert review ---------- */
  function buildPrompt(img, M, R, set) {
    const t = R.tiers.map(x => ({ tier: x.id, format: x.ex, score: x.score, effective_ppi: Math.round(x.eff), nominal_ppi: Math.round(x.ppi), finest_line_pt: x.finestPt ? +x.finestPt.toFixed(2) : null, bottleneck: x.bottleneck ? x.bottleneck.label : null, components: x.comps.map(c => ({ k: c.key, s: c.s, v: c.value })) }));
    const facts = {
      file: { name: img.name, px: `${img.w}x${img.h}`, format: img.format, mode: img.mode, bits: img.bits, icc: img.iccDesc || (img.icc ? "yes" : "none"), dpi_tag: img.dpi, alpha: !!img.hasAlpha },
      job: { large_format_cm: `${set.wCm}x${set.hCm}`, placement: set.fit, viewing_distance_cm: set.distC, substrate: R.sub.name, ink_limit: R.sub.limit },
      measured: {
        detail_factor: M.detail.factor, tac_p99: M.tacP99, tac_peak: M.tacP999, tac_area_over_limit: +(R.tacOver * 100).toFixed(2),
        clip_black_pct: +(M.clipLo * 100).toFixed(2), crushed_shadows: R.crushed, neutral_rgb_black_pct: +(M.neutralBlack * 100).toFixed(2),
        stepped_gradient_area_pct: +(M.band.steppedFrac * 100).toFixed(2), band_step_mm_large: +R.job.bandMm.toFixed(2),
        reversed_strokes_on_dark_choke_pct_large: Math.round(R.job.chokeFrac * 100), strong_stroke_pass_rate_by_light: R.lights.map(l => [l.name, Math.round(l.passRate * 100)]),
        alpha: M.alpha, border_box: M.border.kind
      },
      tiers: t
    };
    return `${MASTER_FINE_ART_AUDITOR_DIRECTIVE}

Context:
- You are auditing a production master for professional fine-art printing.
- Use measured preflight data as authoritative for calculations and use the provided image previews for visual defects and intent-sensitive interpretation.
- Tier C is the requested print job; Tier A/B checks are secondary compatibility checks.

MEASURED DATA
${JSON.stringify(facts)}

Reply with ONLY a JSON object and no wrapper prose. Use this schema:
{
  "final_status": "APPROVED|APPROVED WITH NOTES|CONDITIONAL APPROVAL|HOLD - CORRECTION REQUIRED|REJECTED",
  "verdict": "one concise overall prepress call",
  "identity_audit": {
    "icc_embedded": "YES|NO",
    "icc_profile_name": "verified profile name or 'none'",
    "color_space": "reported actual working space",
    "bit_depth": "reported actual bit depth",
    "alpha": "YES|NO",
    "dpi_tag": "tag value or 'none'"
  },
  "print_size_validation": {
    "requested": "requested physical size",
    "effective_dpi": "width dpi x height dpi",
    "max_recommended_300dpi": "physical size at 300 dpi",
    "max_recommended_240dpi": "physical size at 240 dpi"
  },
  "adjustments": [{"tier": "A|B|C", "score": 1.0, "reason": "why visual evidence modifies or confirms measured score"}],
  "shadows": "2-4 sentences on shadows, blend behavior, clipping, and print risks",
  "legibility": "2-4 sentences on linework/text clarity, contrast, and choke risk",
  "observations": ["up to 5 visual findings that metrics alone cannot prove"],
  "actions": [{"area": "short area name", "step": "exact corrective or verification step"}],
  "printer_handoff_notes": ["up to 6 production notes for the print studio"]
}

Constraints:
- Give exactly three adjustments, one for each tier A, B, C.
- Keep actions to at most 6 and make them specific.
- Never claim facts that are not verified by measured data or visible evidence.
- If evidence is missing for a claim, state uncertainty and downgrade status accordingly.`;
  }

  window.PQA = Object.assign(window.PQA || {}, { grade, buildPrompt, SUBSTRATES, LIGHTS, tone, verdict });
})();
