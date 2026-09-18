#!/usr/bin/env python3
r"""tiff_to_pdf.py -- write the PDF delivery for print files that were already delivered as TIFF, without re-running
the pipeline (no upscaling, no API calls).

  python tiff_to_pdf.py output\print_batch_01        every .tif / .tiff in the folder
  python tiff_to_pdf.py a.tif b.tif                  named files
  options: --dry-run      list what would be converted and why, write nothing
           --bleed-mm 3   bleed to assume when a TIFF has no _SPEC.txt (default 3)
           --out-dir DIR  write the PDFs there instead of next to the TIFFs (spec sheets are then left as they are)
           --workers N    files converted at the same time (default: auto, from free memory and CPU cores)
           --threads N    compression threads per file (default: auto; 1 writes a byte-identical single stream)
           --force        convert again even when an up-to-date PDF is already there

Each PDF is written by upscale_pipeline.write_pdf() under a temporary name, read back and checked (page boxes, colour
space, and every decoded pixel against the TIFF), and only then renamed onto <name>.pdf. The final name therefore only
ever holds a complete, verified file, and a failed or interrupted conversion leaves an earlier PDF as it was. When the
PDF is written next to its TIFF, the _SPEC.txt gets one "PDF delivery:" line naming it, its SHA-256 and the size and
date of the TIFF it was made from (replaced, never duplicated; the rest of the sheet is kept byte for byte).

Re-running is free: a PDF is skipped when it is complete, not older than its TIFF, has the TIFF's pixel size, and
(next to a spec sheet) is the exact file the sheet records, made from the TIFF as it is now. Anything else -- missing,
interrupted, a TIFF delivered again or copied over, a sheet rewritten by the pipeline -- is converted again. Exit code:
0 when every file is converted or up to date, 1 when a file failed or a path was not usable, 2 for invalid options,
130 when interrupted.
"""
from __future__ import annotations

import argparse
import ctypes
import glob
import math
import os
import re
import stat
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import upscale_pipeline as up  # noqa: E402

Image.MAX_IMAGE_PIXELS = None

TIFF_SUFFIXES = {".tif", ".tiff"}
MODES = {"RGB", "RGBA", "L", "LA", "P", "PA", "1"}
SPEC_LINE = re.compile(r"^PDF delivery:.*\n?", re.M)
TEMP_TAG = ".tiff2pdf-"
TEMP_PID = re.compile(re.escape(TEMP_TAG) + r"(\d+)-|\.pdf\.(\d+)\.part$")
PDF_IMAGE_SIZE = re.compile(rb"/Subtype /Image /Width (\d+) /Height (\d+)")
PEAK_BYTES_PER_PIXEL = 12  # one conversion's peak private memory per image pixel, measured on real deliveries
MAX_PAGE_INCHES = 200  # the PDF page size limit (14,400 pt) without UserUnit
MAX_BLEED_MM = 50
MAX_THREADS = 8
_icc_lock = threading.Lock()


class ConversionError(Exception):
    pass


@dataclass
class Job:
    tif: Path
    dst: Path
    spec: Path | None
    pixels: int
    reason: str


class _MemoryStatus(ctypes.Structure):
    _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [
        (name, ctypes.c_ulonglong) for name in
        ("total_phys", "avail_phys", "total_page", "avail_page", "total_virtual", "avail_virtual", "avail_extended")]


def available_memory() -> int | None:
    if os.name == "nt":
        status = _MemoryStatus(dwLength=ctypes.sizeof(_MemoryStatus))
        return status.avail_phys if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)) else None
    try:
        return os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
    except (ValueError, OSError, AttributeError):
        return None


def auto_workers(pixel_counts: list[int], available: int | None, cpus: int | None) -> int:
    if not pixel_counts:
        return 1
    need = max(max(pixel_counts), 1) * PEAK_BYTES_PER_PIXEL
    by_memory = int((available or 2 << 30) * 0.7) // need
    by_cpu = max(1, (cpus or 2) // 2)
    return max(1, min(len(pixel_counts), by_cpu, by_memory))


def auto_threads(workers: int, cpus: int | None) -> int:
    return max(1, min(MAX_THREADS, (cpus or 2) // max(1, workers)))


def spec_of(tif: Path) -> Path:
    return tif.with_name(tif.stem + "_SPEC.txt")


def _read_text(path: Path) -> str:
    # surrogateescape keeps any byte that is not UTF-8 (a note typed in another encoding) exactly as it was
    return path.read_bytes().decode("utf-8", errors="surrogateescape")


def _read_only(path: Path | None) -> bool:
    if path is None:
        return False
    try:
        st = path.stat()
    except OSError:
        return False
    attributes = getattr(st, "st_file_attributes", None)
    if attributes is not None:
        return bool(attributes & stat.FILE_ATTRIBUTE_READONLY)
    return not os.access(path, os.W_OK)


def _tiff_size(tif: Path) -> tuple[int, int] | None:
    try:
        with Image.open(tif) as im:
            return im.size
    except Exception:  # noqa: BLE001 - an unreadable TIFF is reported properly when it is converted
        return None


def recorded_delivery(spec_text: str, pdf_name: str) -> dict | None:
    """The 'PDF delivery:' record for pdf_name: its file SHA-256 and, when recorded, the TIFF's (size, mtime_ns)."""
    for line in spec_text.splitlines():
        if re.match(r"PDF delivery: +" + re.escape(pdf_name) + r" \(", line):
            sha = re.search(r"; file sha256 ([0-9a-f]{64})", line)
            src = re.search(r"; source TIFF (\d+) bytes, modified (\d+)", line)
            return {"sha": sha.group(1) if sha else None,
                    "tiff": (int(src.group(1)), int(src.group(2))) if src else None}
    return None


def up_to_date(dst: Path, tif: Path, spec: Path | None) -> tuple[bool, str]:
    try:
        st = dst.stat()
    except OSError:
        return False, "no PDF yet"
    try:
        if st.st_size < 1024:
            return False, "PDF is incomplete"
        with dst.open("rb") as fh:
            head = fh.read(8192)
            fh.seek(-16, os.SEEK_END)
            if not fh.read().rstrip(b"\r\n").endswith(b"%%EOF"):
                return False, "PDF is incomplete"
        tst = tif.stat()
        if st.st_mtime < tst.st_mtime:
            return False, "the TIFF is newer than its PDF"
        m = PDF_IMAGE_SIZE.search(head)
        if not m or (int(m.group(1)), int(m.group(2))) != _tiff_size(tif):
            return False, "the PDF does not have the TIFF's pixel size"
        if spec is not None and spec.exists():
            record = recorded_delivery(_read_text(spec), dst.name)
            if record is None:
                return False, "the spec sheet does not record this PDF"
            if record["tiff"] is not None and record["tiff"] != (tst.st_size, tst.st_mtime_ns):
                return False, "the TIFF is not the one this PDF was made from"
            if record["sha"] != up.sha256_file(dst):
                return False, "the PDF is not the one the spec sheet records"
    except OSError as exc:
        return False, f"could not check the existing PDF ({exc})"
    return True, ""


def _pid_alive(pid: int) -> bool:
    if pid == os.getpid():
        return True
    if os.name == "nt":
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenProcess.restype = ctypes.c_void_p
        handle = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return ctypes.get_last_error() == 5  # access denied: the process exists but belongs to someone else
        try:
            code = ctypes.c_ulong()
            return bool(k32.GetExitCodeProcess(ctypes.c_void_p(handle), ctypes.byref(code))) and code.value == 259
        finally:
            k32.CloseHandle(ctypes.c_void_p(handle))
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def remove_leftovers(folder: Path, stem: str) -> None:
    """Delete temporary files an earlier run left behind for this name, once the process that made them is gone."""
    for p in folder.glob(glob.escape(stem) + "*"):
        m = TEMP_PID.search(p.name)
        if m and not _pid_alive(int(m.group(1) or m.group(2))):
            p.unlink(missing_ok=True)


def _replace(src: Path, dst: Path) -> None:
    for attempt in range(6):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == 5 or _read_only(dst):
                raise
            time.sleep(0.25 * 2 ** attempt)  # antivirus, indexer or thumbnailer usually lets go within seconds


def _read_only_error(path: Path) -> ConversionError:
    return ConversionError(f"{path.name} is read-only: clear its Read-only attribute (right-click > Properties) "
                           "and run again")


def read_ppi(im: Image.Image) -> float:
    # Pillow reports 1 dpi for a TIFF without resolution tags, so the tags themselves are read
    tags = getattr(im, "tag_v2", {})
    x, y, unit = tags.get(282), tags.get(283), tags.get(296)
    if x is None:
        raise ConversionError("no resolution tag in the TIFF")
    if unit == 1:
        raise ConversionError("the TIFF resolution has no unit (neither inch nor cm)")
    scale = 2.54 if unit == 3 else 1.0
    try:
        xf = float(x) * scale
        yf = float(y) * scale if y is not None else xf
    except (TypeError, ValueError, ZeroDivisionError):
        raise ConversionError("unreadable resolution tag in the TIFF") from None
    if not (math.isfinite(xf) and math.isfinite(yf)) or xf <= 0 or yf <= 0:
        raise ConversionError(f"invalid resolution tag in the TIFF ({x} x {y})")
    if abs(xf - yf) > 0.001 * xf:
        raise ConversionError(f"non-square pixels ({xf:g} x {yf:g} dpi)")
    return xf


def choose_icc(icc: bytes | None) -> tuple[bytes | None, str]:
    with _icc_lock:
        space = up.icc_header(icc).get("space") if icc else None
        if icc and space == "RGB":
            return icc, up.icc_description(icc)
        if icc:
            name = f"sRGB IEC61966-2.1 (assumed; the TIFF profile '{up.icc_description(icc)}' is " \
                   f"{space or 'not a valid ICC profile'}, not RGB)"
        else:
            name = "sRGB IEC61966-2.1 (assumed, no profile in the TIFF)"
        srgb = up.srgb_profile_bytes()
        return (srgb, name) if srgb else (None, "none")


def read_bleed(spec_text: str | None, bleed_mm: float, ppi: float) -> tuple[int, str]:
    line = re.search(r"^Bleed:[ \t]*(.*?)\r?$", spec_text, re.M) if spec_text is not None else None
    if line is None:
        return round(bleed_mm / 25.4 * ppi), f"assumed --bleed-mm {bleed_mm:g}"
    m = re.search(r"\((\d+) px\)", line.group(1))
    if m:
        return int(m.group(1)), "from the spec sheet"
    if line.group(1).lower().startswith("none"):
        return 0, "from the spec sheet"
    raise ConversionError(f"unreadable Bleed line in the spec sheet: {line.group(1)!r}")


def check_spec_size(spec_text: str | None, size: tuple[int, int]) -> None:
    m = re.search(r"^Dimensions:.*?(\d+)x(\d+) px incl\. bleed", spec_text, re.M) if spec_text is not None else None
    if m and (int(m.group(1)), int(m.group(2))) != size:
        raise ConversionError(f"the spec sheet describes a {m.group(1)}x{m.group(2)} px file, "
                              f"the TIFF is {size[0]}x{size[1]} px")


def update_spec(spec: Path, dst: Path, facts: dict, file_sha: str, source: tuple[int, int]) -> None:
    text = SPEC_LINE.sub("", _read_text(spec))
    nl = "\r\n" if "\r\n" in text else "\n"
    if text and not text.endswith("\n"):
        text += nl
    text += (f"PDF delivery:     {dst.name} ({facts['page_cm']} cm incl. bleed, trim {facts['trim_cm']} cm, "
             f"{facts['colour']}); file sha256 {file_sha}; pixels sha256 {facts['pixels_sha256']}; "
             f"source TIFF {source[0]} bytes, modified {source[1]}{nl}")
    tmp = spec.with_name(f"{spec.name}{TEMP_TAG}{os.getpid()}-{threading.get_ident()}")
    try:
        tmp.write_bytes(text.encode("utf-8", errors="surrogateescape"))
        _replace(tmp, spec)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _write(job: Job, tmp: Path, bleed_mm: float, threads: int) -> tuple[dict, dict, str]:
    """Writes the PDF to tmp; the decoded TIFF is freed on return, before verification decodes the PDF."""
    spec_text = _read_text(spec_of(job.tif)) if spec_of(job.tif).exists() else None
    with Image.open(job.tif) as im:
        if getattr(im, "n_frames", 1) > 1:
            raise ConversionError(f"{im.n_frames} pages in the TIFF; a print delivery has one")
        if im.mode not in MODES:
            raise ConversionError(f"colour mode {im.mode} is not supported (a print delivery TIFF is 8-bit RGB)")
        orientation = im.getexif().get(0x0112)
        if orientation not in (None, 1):
            raise ConversionError(f"TIFF orientation tag {orientation}: rotate the pixels first")
        ppi = read_ppi(im)
        w, h = im.size
        if max(w, h) / ppi > MAX_PAGE_INCHES:
            raise ConversionError(f"at {ppi:g} PPI the page would be {max(w, h) / ppi * 2.54 / 100:.1f} m long, "
                                  f"over the PDF limit of {MAX_PAGE_INCHES * 2.54 / 100:.2f} m")
        check_spec_size(spec_text, (w, h))
        bleed_px, bleed_from = read_bleed(spec_text, bleed_mm, ppi)
        if 2 * bleed_px >= min(w, h):
            raise ConversionError(f"bleed of {bleed_px} px per side does not fit a {w}x{h} px image")
        icc, icc_name = choose_icc(im.info.get("icc_profile"))
        im.load()
        facts = up.write_pdf(tmp, im, ppi, bleed_px, icc, icc_name, title=job.dst.stem,
                             created=datetime.now(timezone.utc), threads=threads)
    delivery = {"file_px": f"{w}x{h}", "ppi": ppi, "bleed_px": bleed_px, "icc_embedded": bool(icc), "pdf": facts}
    return facts, delivery, f"at {ppi:g} PPI, bleed {bleed_px} px ({bleed_from}), {'ICC ' + icc_name if icc else 'no ICC'}"


def convert(job: Job, bleed_mm: float, threads: int = 1) -> str:
    t0 = time.perf_counter()
    spec = job.spec if job.spec is not None and job.spec.exists() else None
    for path in (job.dst, spec):
        if _read_only(path):
            raise _read_only_error(path)
    source = job.tif.stat()
    tmp = job.dst.with_name(f"{job.dst.stem}{TEMP_TAG}{os.getpid()}-{threading.get_ident()}.pdf")
    remove_leftovers(job.dst.parent, job.dst.stem)
    try:
        facts, delivery, details = _write(job, tmp, bleed_mm, threads)
        file_sha = up.verify_pdf(tmp, delivery).sha256
        try:
            _replace(tmp, job.dst)
        except PermissionError as exc:
            if _read_only(job.dst):
                raise _read_only_error(job.dst) from exc
            raise ConversionError(f"{job.dst.name} is locked by another program (open in a PDF viewer?); "
                                  "close it and run again") from exc
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    if spec is not None:
        try:
            update_spec(spec, job.dst, facts, file_sha, (source.st_size, source.st_mtime_ns))
        except OSError as exc:
            raise ConversionError(f"{job.dst.name} was written, but {spec.name} could not be updated ({exc}); "
                                  "run again to finish it") from exc
    return (f"OK    {job.dst.name}  {facts['bytes'] / 1e6:.0f} MB  page {facts['page_cm']} cm, trim {facts['trim_cm']} cm "
            f"{details}  ({time.perf_counter() - t0:.0f} s)")


def collect(paths: list[str]) -> tuple[list[Path], list[str]]:
    files: list[Path] = []
    problems: list[str] = []
    seen: set[str] = set()
    for raw in paths:
        p = Path(raw)
        if p.is_dir():
            found = sorted(x for x in p.iterdir() if x.is_file() and x.suffix.lower() in TIFF_SUFFIXES)
            if not found:
                print(f"no TIFF files in {p}")
        elif p.is_file():
            if p.suffix.lower() not in TIFF_SUFFIXES:
                problems.append(f"not a TIFF file: {p}")
                continue
            found = [p]
        else:
            problems.append(f"not found: {p}")
            continue
        for f in found:
            key = os.path.normcase(str(f.resolve()))
            if key not in seen:
                seen.add(key)
                files.append(f)
    return files, problems


def _bleed_mm(text: str) -> float:
    try:
        v = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a number: {text!r}") from None
    if not math.isfinite(v) or not 0 <= v <= MAX_BLEED_MM:
        raise argparse.ArgumentTypeError(f"must be between 0 and {MAX_BLEED_MM} mm")
    return v


def _count(text: str) -> int | None:
    if text == "auto":
        return None
    if text.isdigit() and int(text) >= 1:
        return int(text)
    raise argparse.ArgumentTypeError("must be 'auto' or a whole number of at least 1")


def _pixels(tif: Path) -> int:
    size = _tiff_size(tif)
    return size[0] * size[1] if size else 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):  # a name the console code page cannot show must not crash a logged run
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(errors="backslashreplace")
            except (ValueError, OSError):
                pass
    ap = argparse.ArgumentParser(description="Write PDF deliveries for TIFF print files already delivered.")
    ap.add_argument("paths", nargs="+", help="TIFF files or folders")
    ap.add_argument("--bleed-mm", type=_bleed_mm, default=3.0, help="bleed to assume when a TIFF has no _SPEC.txt (default 3)")
    ap.add_argument("--out-dir", default=None, help="write the PDFs here instead of next to the TIFFs")
    ap.add_argument("--workers", type=_count, default=None, help="files converted at the same time (default: auto)")
    ap.add_argument("--threads", type=_count, default=None, help="compression threads per file (default: auto)")
    ap.add_argument("--force", action="store_true", help="convert again even when an up-to-date PDF is already there")
    ap.add_argument("--dry-run", action="store_true", help="list what would be converted and why, write nothing")
    a = ap.parse_args(argv)
    out_dir = Path(a.out_dir) if a.out_dir else None
    if out_dir is not None:
        if out_dir.exists() and not out_dir.is_dir():
            ap.error(f"--out-dir {out_dir} is a file, not a folder")
        if not a.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()

    files, problems = collect(a.paths)
    for msg in problems:
        print(msg)
    failed = skipped = ok = 0
    candidates: list[tuple[Path, Path, Path | None]] = []
    owners: dict[str, Path] = {}
    for tif in files:
        dst = (out_dir or tif.parent) / (tif.stem + ".pdf")
        key = os.path.normcase(os.path.abspath(dst))
        if key in owners:
            print(f"FAILED {tif}: its PDF {dst} would overwrite the one converted from {owners[key]}")
            failed += 1
            continue
        owners[key] = tif
        candidates.append((tif, dst, None if out_dir else spec_of(tif)))

    def check(c: tuple[Path, Path, Path | None]) -> tuple[bool, str, int]:
        fresh, why = (False, "--force") if a.force else up_to_date(c[1], c[0], c[2])
        return fresh, why, 0 if fresh else _pixels(c[0])

    jobs: list[Job] = []
    planner = ThreadPoolExecutor(max_workers=min(8, max(1, len(candidates))))
    try:
        for (tif, dst, spec), (fresh, why, pixels) in zip(candidates, planner.map(check, candidates)):
            if fresh:
                print(f"SKIP  {dst.name}  already up to date (--force to redo)")
                skipped += 1
            else:
                jobs.append(Job(tif, dst, spec, pixels, why))
    except KeyboardInterrupt:
        planner.shutdown(wait=False, cancel_futures=True)
        print("interrupted while checking the existing PDFs; nothing was written", flush=True)
        return 130
    planner.shutdown(wait=True)

    if a.dry_run:
        for j in jobs:
            print(f"WOULD CONVERT  {j.tif}  ({j.reason})")
        print(f"{len(jobs)} to convert, {skipped} already up to date, {failed} failed, of {len(files)} TIFF(s) "
              "(dry run, nothing written)")
        return 1 if failed or problems else 0

    workers = a.workers or auto_workers([j.pixels for j in jobs], available_memory(), os.cpu_count())
    workers = max(1, min(workers, len(jobs)))
    threads = a.threads or auto_threads(workers, os.cpu_count())
    if jobs:
        print(f"converting {len(jobs)} TIFF(s), {workers} at a time, {threads} compression thread(s) each", flush=True)
    executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="tiff2pdf")
    futures: dict[Future, Job] = {executor.submit(convert, j, a.bleed_mm, threads): j for j in jobs}
    pending = set(futures)
    interrupted = False

    def report(done: set[Future]) -> None:
        nonlocal ok, failed
        for f in done:
            if f.cancelled():
                continue
            job = futures[f]
            try:
                print(f.result(), flush=True)
                ok += 1
            except ConversionError as exc:
                print(f"FAILED {job.tif.name}: {exc}", flush=True)
                failed += 1
            except Exception as exc:  # noqa: BLE001 - one bad file must not stop the batch
                print(f"FAILED {job.tif.name}: {type(exc).__name__}: {exc}", flush=True)
                failed += 1

    try:
        while pending:  # short waits keep Ctrl+C responsive on Windows
            done, pending = wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
            report(done)
    except KeyboardInterrupt:
        interrupted = True
        for f in pending:
            f.cancel()
        running = {f for f in pending if not f.cancelled()}
        print(f"interrupted: finishing the {len(running)} file(s) in progress; Ctrl+C again stops at once", flush=True)
        try:
            while running:
                done, running = wait(running, timeout=0.5)
                report(done)
        except KeyboardInterrupt:
            print("stopped; files in progress were not written (their temporary files are removed on the next run)",
                  flush=True)
            os._exit(130)
    executor.shutdown(wait=True)

    not_started = sum(1 for f in futures if f.cancelled())
    print(f"{ok} converted, {skipped} already up to date, {failed} failed"
          + (f", {not_started} not started" if not_started else "")
          + f", of {len(files)} TIFF(s) in {time.perf_counter() - t0:.0f} s")
    if interrupted:
        return 130
    return 1 if failed or problems else 0


if __name__ == "__main__":
    sys.exit(main())
