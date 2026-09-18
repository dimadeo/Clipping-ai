/* Print Quality Auditor — decoding and pixel measurement.
   Everything here works in pixels; ui.js turns pixels into PPI, points, mm and scores per tier. */
(function () {
  "use strict";
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------- sRGB helpers ---------- */
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

  /* Heavy-GCR separation approximating an sRGB -> FOGRA39-style conversion.
     Neutral RGB 0,0,0 lands near C74 M70 Y68 K92 (~304% TAC). Returns 0..1 per plate. */
  function toCMYK(r, g, b) {
    const c0 = 1 - r / 255, m0 = 1 - g / 255, y0 = 1 - b / 255;
    const k0 = Math.min(c0, m0, y0);
    const K = k0 <= 0.3 ? 0 : 0.92 * Math.pow((k0 - 0.3) / 0.7, 1.25);
    const cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
    return [cl(c0 - 0.28 * K), cl(m0 - 0.33 * K), cl(y0 - 0.35 * K), K];
  }

  /* ---------- metadata parsers ---------- */
  function iccDescription(bytes) {
    try {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const n = dv.getUint32(128);
      for (let t = 0; t < n; t++) {
        const o = 132 + t * 12;
        if (String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]) !== "desc") continue;
        const off = dv.getUint32(o + 4), type = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
        if (type === "desc") { const len = dv.getUint32(off + 8); return String.fromCharCode(...bytes.subarray(off + 12, off + 12 + len - 1)).trim(); }
        if (type === "mluc") {
          /* first record: language(2) country(2) length(4) offset(4) — length comes first */
          const sl = dv.getUint32(off + 20), so = dv.getUint32(off + 24); let s = "";
          for (let i = 0; i < sl; i += 2) s += String.fromCharCode(dv.getUint16(off + so + i));
          return s.trim();
        }
      }
    } catch (e) { /* unreadable profile */ }
    return "Embedded profile";
  }

  function parsePNG(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const meta = { format: "PNG", dpi: null, icc: false, iccDesc: null, mode: "RGB", bits: 8, hasAlpha: false };
    let p = 8;
    while (p + 8 <= u8.length) {
      const len = dv.getUint32(p), type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]), d = p + 8;
      if (type === "IHDR") {
        meta.bits = u8[d + 8]; const ct = u8[d + 9];
        meta.mode = ct === 0 || ct === 4 ? "Gray" : ct === 3 ? "Indexed" : "RGB";
        meta.hasAlpha = ct === 4 || ct === 6;
      } else if (type === "pHYs" && u8[d + 8] === 1) {
        meta.dpi = Math.round(dv.getUint32(d) * 0.0254 * 10) / 10;
      } else if (type === "iCCP") {
        meta.icc = true; let z = d; while (u8[z] && z < d + 80) z++;
        meta.iccDesc = String.fromCharCode(...u8.subarray(d, z));
        try { if (window.pako) meta.iccDesc = iccDescription(window.pako.inflate(u8.subarray(z + 2, d + len))); } catch (e) { }
      } else if (type === "sRGB") { meta.icc = true; meta.iccDesc = meta.iccDesc || "sRGB (chunk)"; }
      else if (type === "tRNS") meta.hasAlpha = true;
      else if (type === "IEND") break;
      p = d + len + 4;
    }
    return meta;
  }

  function parseJPEG(u8) {
    const meta = { format: "JPEG", dpi: null, icc: false, iccDesc: null, mode: "RGB", bits: 8, hasAlpha: false };
    let p = 2; const icc = [];
    while (p + 4 < u8.length && u8[p] === 0xFF) {
      const m = u8[p + 1], len = (u8[p + 2] << 8) | u8[p + 3], d = p + 4;
      if (m === 0xD9 || m === 0xDA) break;
      const tag = String.fromCharCode(...u8.subarray(d, d + 11));
      if (m === 0xE0 && tag.startsWith("JFIF")) {
        const unit = u8[d + 7], x = (u8[d + 8] << 8) | u8[d + 9];
        if (unit === 1) meta.dpi = x; else if (unit === 2) meta.dpi = Math.round(x * 2.54 * 10) / 10;
      } else if (m === 0xE2 && tag === "ICC_PROFILE") {
        meta.icc = true; icc.push(u8.subarray(d + 14, p + 2 + len));
      } else if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        meta.bits = u8[d]; const nf = u8[d + 5];
        meta.mode = nf === 4 ? "CMYK" : nf === 1 ? "Gray" : "RGB";
      }
      p += 2 + len;
    }
    if (icc.length) { const all = new Uint8Array(icc.reduce((a, b) => a + b.length, 0)); let o = 0; icc.forEach(c => { all.set(c, o); o += c.length; }); meta.iccDesc = iccDescription(all); }
    return meta;
  }

  /* ---------- PDF deliveries written by upscale_pipeline: one page, one Flate image with a PNG predictor ---------- */
  const LATIN1 = new TextDecoder("latin1");
  function findBytes(u8, text, from = 0) {
    const n = text.length, first = text.charCodeAt(0), end = u8.length - n;
    for (let i = from; i <= end; i++) {
      if (u8[i] !== first) continue;
      let k = 1; while (k < n && u8[i + k] === text.charCodeAt(k)) k++;
      if (k === n) return i;
    }
    return -1;
  }
  function pdfObject(u8, num) {
    const i = findBytes(u8, `\n${num} 0 obj`);
    if (i < 0) throw new Error(`PDF object ${num} not found`);
    const s = i + `\n${num} 0 obj`.length, e = findBytes(u8, "endobj", s);
    return { start: s, end: e < 0 ? u8.length : e };
  }
  function pdfStream(u8, obj) {
    const head = LATIN1.decode(u8.subarray(obj.start, Math.min(obj.end, obj.start + 4096)));
    const lenRef = head.match(/\/Length\s+(\d+)\s+0\s+R/), lenDir = head.match(/\/Length\s+(\d+)(?![\s\d]*R)/);
    let len;
    if (lenRef) len = parseInt(LATIN1.decode(u8.subarray(pdfObject(u8, +lenRef[1]).start, pdfObject(u8, +lenRef[1]).start + 32)).trim(), 10);
    else if (lenDir) len = +lenDir[1];
    else throw new Error("PDF stream without a length");
    const ds = findBytes(u8, "stream\n", obj.start) + 7;
    return { head, data: u8.subarray(ds, ds + len) };
  }
  function unfilterPNG(raw, w, h, bpp) {
    const rowLen = w * bpp, out = new Uint8ClampedArray(w * h * 4);
    let prev = new Uint8Array(rowLen), cur = new Uint8Array(rowLen), src = 0;
    for (let y = 0; y < h; y++) {
      const ft = raw[src++];
      for (let x = 0; x < rowLen; x++) {
        const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0, r = raw[src + x];
        let v;
        if (ft === 0) v = r; else if (ft === 1) v = r + a; else if (ft === 2) v = r + b; else if (ft === 3) v = r + ((a + b) >> 1);
        else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        else throw new Error(`unknown PNG filter type ${ft} in the PDF image`);
        cur[x] = v;
      }
      src += rowLen;
      let o = y * w * 4;
      for (let x = 0, i = 0; x < w; x++, i += bpp, o += 4) { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = 255; }
      const t = prev; prev = cur; cur = t;
    }
    return out;
  }
  function decodePdfDelivery(u8) {
    const bad = m => new Error(`Only PDF deliveries written by upscale_pipeline are read (one page with one lossless image)${m ? ": " + m : ""}. For other PDFs export a flattened TIFF or PNG at final size.`);
    if (!window.pako) throw new Error("The inflate library did not load. Check your connection, or export the file as TIFF and try again.");
    const i = findBytes(u8, "/Subtype /Image");
    if (i < 0) throw bad("no image object");
    const objStart = u8.lastIndexOf(0x0A, i);
    const obj = { start: objStart + 1, end: findBytes(u8, "endobj", i) };
    const { head, data } = pdfStream(u8, obj);
    const num = k => { const m = head.match(new RegExp("/" + k + "\\s+(\\d+)")); return m ? +m[1] : null; };
    const w = num("Width"), h = num("Height"), bpc = num("BitsPerComponent") || 8, colors = num("Colors") || 3, predictor = num("Predictor") || 1;
    if (!w || !h) throw bad("image size missing");
    if (!/\/Filter\s*\/FlateDecode(?!\s*\])/.test(head) || /\/Filter\s*\[/.test(head)) throw bad("the image is not a single Flate stream");
    if (bpc !== 8 || colors !== 3 || /\/ColorSpace\s*\/DeviceCMYK|\/DeviceGray/.test(head)) throw bad("the image is not 8-bit RGB");
    const raw = pako.inflate(data);
    let rgba;
    if (predictor >= 10) {
      if (raw.length !== h * (w * 3 + 1)) throw bad("image data length does not match its size");
      rgba = unfilterPNG(raw, w, h, 3);
    } else {
      if (raw.length !== w * h * 3) throw bad("image data length does not match its size");
      rgba = new Uint8ClampedArray(w * h * 4);
      for (let p = 0, q = 0; p < raw.length; p += 3, q += 4) { rgba[q] = raw[p]; rgba[q + 1] = raw[p + 1]; rgba[q + 2] = raw[p + 2]; rgba[q + 3] = 255; }
    }
    const canvas = makeCanvas(w, h);
    canvas.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
    let icc = false, iccDesc = null;
    const cs = head.match(/\/ColorSpace\s*\[\s*\/ICCBased\s+(\d+)\s+0\s+R\s*\]/);
    if (cs) {
      try {
        const s = pdfStream(u8, pdfObject(u8, +cs[1]));
        const bytes = /\/FlateDecode/.test(s.head) ? pako.inflate(s.data) : s.data;
        icc = true; iccDesc = iccDescription(bytes);
      } catch (e) { icc = true; iccDesc = "Embedded profile"; }
    }
    const tail = LATIN1.decode(u8.subarray(0, Math.min(u8.length, 8192)));
    const mb = tail.match(/\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/);
    const dpi = mb ? Math.round(w / ((+mb[3] - +mb[1]) / 72) * 10) / 10 : null;
    const tb = tail.match(/\/TrimBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/);
    const pages = (tail.match(/\/Type\s*\/Page(?!s)/g) || []).length || 1;
    const pdfx = findBytes(u8, "GTS_PDFXVersion>PDF/X-4<") >= 0;
    return {
      meta: { format: "PDF · Flate" + (pdfx ? " · PDF/X-4" : ""), dpi, icc, iccDesc, mode: "RGB", bits: 8, hasAlpha: false, layers: pages,
              trimPt: tb ? [+tb[1], +tb[2], +tb[3], +tb[4]] : null, mediaPt: mb ? [+mb[1], +mb[2], +mb[3], +mb[4]] : null },
      canvas, w, h
    };
  }

  async function decode(file) {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const isTiff = (u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 42) || (u8[0] === 0x4D && u8[1] === 0x4D && u8[3] === 42);
    const isPdf = u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;
    let meta, canvas, w, h;
    if (isPdf) {
      const d = decodePdfDelivery(u8);
      meta = d.meta; canvas = d.canvas; w = d.w; h = d.h;
    } else if (isTiff) {
      if (!window.UTIF) throw new Error("The TIFF decoder did not load. Check your connection, or export the file as PNG and try again.");
      const ifds = UTIF.decode(buf);
      const ifd = ifds.reduce((best, f) => (f.width * f.height > (best ? best.width * best.height : 0) ? f : best), null) || ifds[0];
      UTIF.decodeImage(buf, ifd, ifds);
      w = ifd.width; h = ifd.height;
      const rgba = UTIF.toRGBA8(ifd);
      canvas = makeCanvas(w, h);
      canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
      const photo = ifd.t262 ? ifd.t262[0] : 2, unit = ifd.t296 ? ifd.t296[0] : 2, xr = ifd.t282 ? ifd.t282[0] : null;
      const cmpr = ifd.t259 ? ifd.t259[0] : 1;
      meta = {
        format: "TIFF" + ({ 1: "", 5: " · LZW", 8: " · ZIP", 32946: " · ZIP", 7: " · JPEG", 32773: " · PackBits" }[cmpr] || ""),
        dpi: xr ? Math.round((unit === 3 ? xr * 2.54 : xr) * 10) / 10 : null,
        icc: !!ifd.t34675, iccDesc: ifd.t34675 ? iccDescription(new Uint8Array(ifd.t34675)) : null,
        mode: photo === 5 ? "CMYK" : photo <= 1 ? "Gray" : photo === 3 ? "Indexed" : "RGB",
        bits: ifd.t258 ? ifd.t258[0] : 8,
        hasAlpha: !!ifd.t338, layers: ifds.length
      };
    } else {
      const isPng = u8[0] === 0x89 && u8[1] === 0x50;
      const isJpg = u8[0] === 0xFF && u8[1] === 0xD8;
      meta = isPng ? parsePNG(u8) : isJpg ? parseJPEG(u8) : { format: (file.type.split("/")[1] || "Image").toUpperCase(), dpi: null, icc: null, iccDesc: null, mode: "RGB", bits: 8, hasAlpha: true };
      let bmp;
      try { bmp = await createImageBitmap(file, { premultiplyAlpha: "none" }); }
      catch (e) { throw new Error("This file could not be decoded. Supported: PNG, JPEG, WebP and TIFF. For PDF, AI or PSD, export a flattened PNG or TIFF at final size."); }
      w = bmp.width; h = bmp.height;
      canvas = makeCanvas(w, h);
      canvas.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
    }
    return Object.assign(meta, { name: file.name, bytes: file.size, w, h, full: canvas });
  }

  function makeCanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

  /* ---------- measurement ---------- */
  const COLS = 32, ANALYSIS_MAX = 3000, STRIP = 480, PAD = 8, T = 24;

  async function measure(img, progress) {
    const { w, h, full } = img;
    const s = Math.min(1, ANALYSIS_MAX / Math.max(w, h));
    const aw = Math.max(1, Math.round(w * s)), ah = Math.max(1, Math.round(h * s));
    const acan = makeCanvas(aw, ah), actx = acan.getContext("2d", { willReadFrequently: true });
    actx.imageSmoothingEnabled = true; actx.imageSmoothingQuality = "high";
    actx.drawImage(full, 0, 0, aw, ah);
    progress(0.08, "Separating to simulated CMYK");
    await tick();

    const rows = Math.max(1, Math.round(COLS * ah / aw)), cells = COLS * rows;
    const G = {
      cols: COLS, rows,
      tacMax: new Float32Array(cells), tac280: new Float32Array(cells), tac300: new Float32Array(cells), tac260: new Float32Array(cells), tac250: new Float32Array(cells),
      band: new Float32Array(cells), clipLo: new Float32Array(cells), clipHi: new Float32Array(cells),
      lineMin: new Float32Array(cells), lineCnt: new Float32Array(cells), choke: new Float32Array(cells), px: new Float32Array(cells)
    };
    const cellOfA = (x, y) => Math.min(rows - 1, (y * rows / ah) | 0) * COLS + Math.min(COLS - 1, (x * COLS / aw) | 0);

    const data = actx.getImageData(0, 0, aw, ah).data;
    const N = aw * ah, L = new Uint8Array(N);
    const lumHist = new Float64Array(256), tacHist = new Float64Array(401);
    const binRGB = new Float64Array(256 * 3);
    let clipLo = 0, clipHi = 0, neutralBlack = 0, tacMax = 0, tacMaxRGB = [0, 0, 0];
    let transparent = 0, semi = 0, semiWhite = 0, semiDark = 0, semiDarkAlpha = 0;
    for (let y = 0, i = 0; y < ah; y++) {
      const rowCell = Math.min(rows - 1, (y * rows / ah) | 0) * COLS;
      for (let x = 0; x < aw; x++, i++) {
        const o = i * 4; let r = data[o], g = data[o + 1], b = data[o + 2]; const a = data[o + 3];
        if (a < 255) {
          if (a === 0) transparent++;
          else {
            semi++; const lraw = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            if (lraw > 230) semiWhite++; else if (lraw < 30) { semiDark++; semiDarkAlpha += a; }
          }
          const k = a / 255; r = r * k + 255 * (1 - k); g = g * k + 255 * (1 - k); b = b * k + 255 * (1 - k);
        }
        const l = (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.5) | 0;
        L[i] = l; lumHist[l]++;
        binRGB[l * 3] += r; binRGB[l * 3 + 1] += g; binRGB[l * 3 + 2] += b;
        const cm = toCMYK(r, g, b), tac = Math.round((cm[0] + cm[1] + cm[2] + cm[3]) * 100);
        tacHist[tac]++;
        const c = rowCell + Math.min(COLS - 1, (x * COLS / aw) | 0);
        G.px[c]++;
        if (tac > G.tacMax[c]) G.tacMax[c] = tac;
        if (tac > 250) { G.tac250[c]++; if (tac > 260) { G.tac260[c]++; if (tac > 280) { G.tac280[c]++; if (tac > 300) G.tac300[c]++; } } }
        if (tac > tacMax) { tacMax = tac; tacMaxRGB = [r | 0, g | 0, b | 0]; }
        if (l <= 3) { clipLo++; G.clipLo[c]++; } else if (l >= 252) { clipHi++; G.clipHi[c]++; }
        if (r <= 20 && g <= 20 && b <= 20 && Math.max(r, g, b) - Math.min(r, g, b) <= 6) neutralBlack++;
      }
      if (y % 600 === 599) { progress(0.08 + 0.22 * y / ah, "Separating to simulated CMYK"); await tick(); }
    }
    for (let c = 0; c < cells; c++) { const n = G.px[c] || 1; G.tac250[c] /= n; G.tac260[c] /= n; G.tac280[c] /= n; G.tac300[c] /= n; G.clipLo[c] /= n; G.clipHi[c] /= n; }

    /* tone patches for the control strip */
    const patchAt = (fromDark, frac) => {
      let target = N * frac, acc = 0, r = 0, g = 0, b = 0, n = 0;
      for (let k = 0; k < 256; k++) {
        const l = fromDark ? k : 255 - k; const cnt = lumHist[l]; if (!cnt) continue;
        r += binRGB[l * 3]; g += binRGB[l * 3 + 1]; b += binRGB[l * 3 + 2]; n += cnt; acc += cnt;
        if (acc >= target) break;
      }
      n = n || 1; const rgb = [r / n | 0, g / n | 0, b / n | 0];
      return { rgb, cmyk: toCMYK(...rgb) };
    };
    const quant = q => { let acc = 0; for (let l = 0; l < 256; l++) { acc += lumHist[l]; if (acc >= N * q) return l; } return 255; };
    const tacQ = q => { let acc = 0; for (let t = 400; t >= 0; t--) { acc += tacHist[t]; if (acc >= N * (1 - q)) return t; } return 0; };
    const patches = [
      Object.assign({ name: "Darkest 1%" }, patchAt(true, 0.01)),
      Object.assign({ name: "Shadow 10%" }, patchAt(true, 0.10)),
      Object.assign({ name: "Midtone" }, (() => { const m = quant(0.5); const n = lumHist[m] || 1; const rgb = [binRGB[m * 3] / n | 0, binRGB[m * 3 + 1] / n | 0, binRGB[m * 3 + 2] / n | 0]; return { rgb, cmyk: toCMYK(...rgb) }; })()),
      Object.assign({ name: "Highlight 5%" }, patchAt(false, 0.05)),
      { name: "Peak TAC", rgb: tacMaxRGB, cmyk: toCMYK(...tacMaxRGB) },
      { name: "RGB 0,0,0", rgb: [0, 0, 0], cmyk: toCMYK(0, 0, 0) }
    ];

    /* border: baked background box */
    let bs = 0, bs2 = 0, bn = 0; const bw = Math.max(2, Math.round(Math.min(aw, ah) * 0.01));
    for (let y = 0; y < ah; y += 2) for (let x = 0; x < aw; x += 2) {
      if (x >= bw && x < aw - bw && y >= bw && y < ah - bw) { x = aw - bw - 1; continue; }
      const v = L[y * aw + x]; bs += v; bs2 += v * v; bn++;
    }
    const bMean = bs / bn, bStd = Math.sqrt(Math.max(0, bs2 / bn - bMean * bMean));

    /* banding: stepped plateaus in smooth dark gradients, along rows and columns */
    progress(0.32, "Scanning gradients for banding");
    await tick();
    const plateau = new Float64Array(1024); let stepped = 0, posterSteps = 0, steps = 0;
    const scan = (len, idx, cellAt, stride) => {
      let runVal = -1, runLen = 0, startStep = false;
      for (let t = 1; t < len - 1; t++) {
        const i = idx(t), v = L[i];
        const smooth = v >= 2 && v < 150 && Math.abs(L[i + stride] - L[i - stride]) <= 3;
        if (!smooth) { runVal = -1; runLen = 0; startStep = false; continue; }
        if (v === runVal) { runLen++; continue; }
        const dv = runVal < 0 ? 99 : Math.abs(v - runVal);
        if (dv <= 3 && startStep && runLen >= 3) {
          plateau[Math.min(1023, runLen)] += runLen; stepped += runLen; G.band[cellAt(t)] += runLen; steps++;
          if (dv >= 2) posterSteps++;
        }
        startStep = dv <= 3; runVal = v; runLen = 1;
      }
    };
    for (let y = 1; y < ah - 1; y++) { const base = y * aw; scan(aw, t => base + t, t => cellOfA(t, y), 1); }
    await tick();
    for (let x = 1; x < aw - 1; x++) scan(ah, t => t * aw + x, t => cellOfA(x, t), aw);
    for (let c = 0; c < cells; c++) G.band[c] /= 2 * (G.px[c] || 1);
    const plateauQ = q => { let acc = 0; for (let k = 3; k < 1024; k++) { acc += plateau[k]; if (acc >= stepped * q) return k; } return 0; };
    let shadowLevels = 0, shadowLo = -1, shadowHi = -1;
    for (let l = 0; l < 64; l++) if (lumHist[l] > N * 0.00002) { shadowLevels++; if (shadowLo < 0) shadowLo = l; shadowHi = l; }

    /* hairlines and fine detail at full resolution, in strips */
    progress(0.42, "Measuring hairlines at full resolution");
    await tick();
    const fctx = full.getContext("2d", { willReadFrequently: true });
    const st = w * h > 9e6 ? 2 : 1;
    const widthDark = new Float64Array(16), widthRev = new Float64Array(16), revOnDark = new Float64Array(16);
    const pairs = []; let pairSeen = 0; const PAIR_MAX = 30000;
    let blackLinePx = 0, linePx = 0, revOnDarkTac = 0;
    const cellOfF = (x, y) => Math.min(rows - 1, (y * rows / h) | 0) * COLS + Math.min(COLS - 1, (x * COLS / w) | 0);
    for (let y0 = 0; y0 < h; y0 += STRIP) {
      const ys = Math.max(0, y0 - PAD), ye = Math.min(h, y0 + STRIP + PAD), sh = ye - ys;
      const d = fctx.getImageData(0, ys, w, sh).data, S = new Uint8Array(w * sh), SR = new Uint8Array(w * sh);
      for (let i = 0, o = 0; i < S.length; i++, o += 4) {
        const a = d[o + 3] / 255, r = d[o] * a + 255 * (1 - a), g = d[o + 1] * a + 255 * (1 - a), b = d[o + 2] * a + 255 * (1 - a);
        S[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.5) | 0;
        SR[i] = (r <= 24 && g <= 24 && b <= 24) ? 1 : 0;
      }
      const yEnd = Math.min(h, y0 + STRIP);
      for (let y = y0; y < yEnd; y += st) {
        const r0 = y - ys; if (r0 < 7 || r0 >= sh - 7) continue;
        for (let x = 7; x < w - 7; x += st) {
          const i = r0 * w + x, v = S[i];
          let hit = 0, dir = 0, pol = 0;
          for (let pass = 0; pass < 2 && !hit; pass++) {
            const q = pass === 0 ? 1 : w, lft = S[i - q], rgt = S[i + q];
            if (v < lft && v <= rgt) pol = -1; else if (v > lft && v >= rgt) pol = 1; else continue;
            for (let dd = 1; dd <= 6; dd++) {
              const dl = S[i - dd * q] - v, dr = S[i + dd * q] - v;
              if ((pol < 0 && dl >= T && dr >= T) || (pol > 0 && dl <= -T && dr <= -T)) { hit = dd; dir = q; break; }
            }
          }
          if (!hit) continue;
          const bg = (S[i - hit * dir] + S[i + hit * dir]) / 2, half = (v + bg) / 2;
          let wd = 1;
          for (let k = 1; k <= hit; k++) { const u = S[i - k * dir]; if (pol < 0 ? u < half : u > half) wd++; else break; }
          for (let k = 1; k <= hit; k++) { const u = S[i + k * dir]; if (pol < 0 ? u < half : u > half) wd++; else break; }
          wd = Math.min(15, wd);
          const c = cellOfF(x, y);
          linePx++; G.lineCnt[c]++;
          if (!G.lineMin[c] || wd < G.lineMin[c]) G.lineMin[c] = wd;
          if (pol < 0) { widthDark[wd]++; if (SR[i]) blackLinePx++; }
          else {
            widthRev[wd]++;
            if (bg < 80) {
              revOnDark[wd]++; G.choke[c]++;
              const bi = i - hit * dir, o2 = bi * 4; revOnDarkTac += (() => { const cm = toCMYK(d[o2], d[o2 + 1], d[o2 + 2]); return (cm[0] + cm[1] + cm[2] + cm[3]) * 100; })();
            }
          }
          pairSeen++;
          if (pairs.length < PAIR_MAX * 4) pairs.push(LIN[v], LIN[Math.round(bg)], bg, wd);
          else if (Math.random() < PAIR_MAX / pairSeen) { const j = (Math.random() * PAIR_MAX | 0) * 4; pairs[j] = LIN[v]; pairs[j + 1] = LIN[Math.round(bg)]; pairs[j + 2] = bg; pairs[j + 3] = wd; }
        }
      }
      progress(0.42 + 0.43 * yEnd / h, "Measuring hairlines at full resolution");
      await tick();
    }
    const revOnDarkTotal = revOnDark.reduce((a, b) => a + b, 0);

    /* intrinsic detail: how far can the file be downsampled before it loses information? */
    progress(0.88, "Testing true resolution against upscaling");
    await tick();
    let best = 0, bestCell = (rows >> 1) * COLS + (COLS >> 1);
    for (let c = 0; c < cells; c++) if (G.lineCnt[c] > best) { best = G.lineCnt[c]; bestCell = c; }
    const cs = Math.min(768, w, h);
    const cx = Math.max(0, Math.min(w - cs, Math.round(((bestCell % COLS) + 0.5) * w / COLS - cs / 2)));
    const cy = Math.max(0, Math.min(h - cs, Math.round((((bestCell / COLS) | 0) + 0.5) * h / rows - cs / 2)));
    const crop = makeCanvas(cs, cs), cctx = crop.getContext("2d", { willReadFrequently: true });
    cctx.drawImage(full, cx, cy, cs, cs, 0, 0, cs, cs);
    const ref = cctx.getImageData(0, 0, cs, cs).data;
    const refL = new Float32Array(cs * cs);
    for (let i = 0; i < refL.length; i++) refL[i] = 0.2126 * ref[i * 4] + 0.7152 * ref[i * 4 + 1] + 0.0722 * ref[i * 4 + 2];
    let lap = 0, lapN = 0;
    for (let y = 1; y < cs - 1; y += 2) for (let x = 1; x < cs - 1; x += 2) { const i = y * cs + x; const v = 4 * refL[i] - refL[i - 1] - refL[i + 1] - refL[i - cs] - refL[i + cs]; lap += v * v; lapN++; }
    const psnr = [];
    let factor = 1;
    for (const f of [0.8, 0.67, 0.5, 0.4, 0.33, 0.25]) {
      const sm = Math.max(8, Math.round(cs * f)), a = makeCanvas(sm, sm), b = makeCanvas(cs, cs);
      const ax = a.getContext("2d"); ax.imageSmoothingQuality = "high"; ax.drawImage(crop, 0, 0, sm, sm);
      const bx = b.getContext("2d", { willReadFrequently: true }); bx.imageSmoothingQuality = "high"; bx.drawImage(a, 0, 0, cs, cs);
      const rt = bx.getImageData(0, 0, cs, cs).data; let mse = 0;
      for (let y = 4; y < cs - 4; y++) for (let x = 4; x < cs - 4; x++) { const i = y * cs + x; const e = refL[i] - (0.2126 * rt[i * 4] + 0.7152 * rt[i * 4 + 1] + 0.0722 * rt[i * 4 + 2]); mse += e * e; }
      mse /= (cs - 8) * (cs - 8);
      const db = mse === 0 ? 99 : 10 * Math.log10(65025 / mse);
      psnr.push({ f, db });
      if (db >= 36) factor = f; else break;
    }
    progress(1, "Done");

    return {
      aw, ah, s, acan, grid: G, N,
      lumHist, tacHist, tacMax, tacP99: tacQ(0.99), tacP999: tacQ(0.999), patches,
      clipLo: clipLo / N, clipHi: clipHi / N, neutralBlack: neutralBlack / N,
      shadowLevels, shadowLo, shadowHi, lumP1: quant(0.01), lumP50: quant(0.5), lumP99: quant(0.99),
      band: { steppedFrac: stepped / (2 * N), p50: plateauQ(0.5), p90: plateauQ(0.9), steps, posterFrac: steps ? posterSteps / steps : 0 },
      lines: { widthDark, widthRev, revOnDark, revOnDarkTotal, revOnDarkTac: revOnDarkTotal ? revOnDarkTac / revOnDarkTotal : 0, linePx: linePx * st, blackLineFrac: linePx ? blackLinePx / linePx : 0, step: st, fullH: h },
      pairs: new Float32Array(pairs),
      detail: { factor, psnr, lapVar: lap / lapN, crop: { x: cx, y: cy, size: cs } },
      alpha: img.hasAlpha ? { transparent: transparent / N, semi: semi / N, semiWhite: semi ? semiWhite / semi : 0, semiDark: semi ? semiDark / semi : 0, semiDarkAlpha: semiDark ? semiDarkAlpha / semiDark / 255 : 0 } : null,
      border: { mean: bMean, std: bStd, kind: bStd < 3 ? (bMean > 245 ? "white" : bMean < 10 ? "black" : "flat") : null }
    };
  }

  /* ---------- generated sample artwork ---------- */
  function makeSample() {
    const w = 4200, h = 2800, c = makeCanvas(w, h), x = c.getContext("2d");
    const bg = x.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, "#0A1224"); bg.addColorStop(1, "#1C2B47");
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    const glow = x.createRadialGradient(3100, 900, 60, 3100, 900, 900); glow.addColorStop(0, "#F2A93B"); glow.addColorStop(0.45, "#C2572B"); glow.addColorStop(1, "rgba(28,43,71,0)");
    x.fillStyle = glow; x.fillRect(2000, 0, 2200, 2000);
    x.fillStyle = "#3A0D5C"; x.fillRect(0, 2250, w, 550);
    x.fillStyle = "#000000"; x.fillRect(0, 2560, w, 240);
    x.save(); x.shadowColor = "rgba(0,0,0,0.9)"; x.shadowBlur = 140; x.shadowOffsetX = 50; x.shadowOffsetY = 70;
    x.fillStyle = "#EFE9DC"; x.fillRect(360, 520, 1900, 1400); x.restore();
    x.fillStyle = "#000000"; x.font = "700 210px Georgia, 'Times New Roman', serif"; x.fillText("NOCTURNE", 470, 860);
    x.fillStyle = "#202020"; x.fillRect(470, 940, 1680, 1);
    x.font = "italic 400 44px Georgia, serif"; x.fillText("An evening of chamber works — 14 November", 470, 1040);
    x.font = "400 17px Georgia, serif"; x.fillStyle = "#3A3A3A";
    for (let i = 0; i < 9; i++) x.fillText("Doors 19:00 · Hall B · Programme subject to change · Tickets at the box office and online", 470, 1160 + i * 30);
    x.strokeStyle = "rgba(235,230,215,0.9)"; x.lineWidth = 1;
    for (let i = 0; i < 14; i++) { x.beginPath(); x.moveTo(2500, 1700 + i * 26); x.lineTo(4000, 1640 + i * 26); x.stroke(); }
    x.fillStyle = "#D9D2C2"; x.font = "400 16px Georgia, serif";
    for (let i = 0; i < 6; i++) x.fillText("Supported by the municipal arts fund · Recording prohibited · Latecomers admitted at the interval", 400, 2360 + i * 28);
    x.fillStyle = "#1A1A1A"; x.font = "400 22px Georgia, serif"; x.fillText("nocturne-hall.example", 400, 2690);
    return { format: "PNG · generated", dpi: 150, icc: true, iccDesc: "sRGB IEC61966-2.1 (assumed)", mode: "RGB", bits: 8, hasAlpha: false, name: "sample-nocturne-poster.png", bytes: 0, w, h, full: c, isSample: true };
  }

  window.PQA = { decode, measure, makeSample, toCMYK, LIN };
})();
