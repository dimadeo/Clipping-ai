"""Tests for tiff_to_pdf.py on tiny synthetic TIFFs: python -m unittest -v test_tiff_to_pdf (next to tiff_to_pdf.py).
Set TIFF2PDF_OLD to a previous tiff_to_pdf.py to also check byte-for-byte parity with it."""
import hashlib
import importlib.util
import io
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zlib
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image, ImageCms

HERE = Path(__file__).resolve().parent
PROJECT = Path(os.environ.get("UPSCALED_ROOT", r"C:\Users\andre\Upscaled"))
sys.path[:0] = [str(HERE), str(PROJECT)]
import tiff_to_pdf as t2p  # noqa: E402
import upscale_pipeline as up  # noqa: E402

PPI = 150
OLD = os.environ.get("TIFF2PDF_OLD")
FIXED_TIME = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
SPEC = """PRINT DELIVERY SPEC
============================================================
File:             {name}
Dimensions:       {dims} px incl. bleed
Bleed:            {bleed}
Colour:           sRGB -- ICC embedded, 8-bit RGB
Format:           TIF, LZW, single layer
Pipeline:         upscale_pipeline 1.4.2; models: local
"""


class FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return FIXED_TIME


def pixels(w: int = 401, h: int = 1100, seed: int = 0) -> np.ndarray:
    """Gradients plus noise, taller than two 512-row PDF bands so band boundaries are exercised."""
    y, x = np.mgrid[0:h, 0:w]
    base = np.stack([x * 255 // (w - 1), y * 255 // (h - 1), (x + y) % 256], axis=-1)
    noise = np.random.default_rng(seed).integers(-12, 13, size=(h, w, 3))
    return np.clip(base + noise, 0, 255).astype(np.uint8)


def save_tiff(path: Path, im: Image.Image, dpi=(PPI, PPI), icc="srgb", **kw) -> None:
    if dpi is not None:
        kw["dpi"] = dpi
    if icc == "srgb":
        kw["icc_profile"] = up.srgb_profile_bytes()
    elif icc is not None:
        kw["icc_profile"] = icc
    im.save(path, "TIFF", compression="tiff_lzw", **kw)


def decode_pdf(pdf: Path) -> np.ndarray:
    """Independent of upscale_pipeline: inflate the image stream and undo the PNG Up predictor row by row."""
    buf = pdf.read_bytes()
    m = re.search(rb"\d+ 0 obj\n(<< /Type /XObject /Subtype /Image .*?>>)\nstream\n", buf, re.S)
    head = m.group(1)
    w = int(re.search(rb"/Width (\d+)", head).group(1))
    h = int(re.search(rb"/Height (\d+)", head).group(1))
    ref = re.search(rb"/Length (\d+) 0 R", head).group(1)
    length = int(re.search(rb"\n" + ref + rb" 0 obj\n(\d+)\nendobj", buf).group(1))
    raw = np.frombuffer(zlib.decompress(buf[m.end():m.end() + length]), np.uint8).reshape(h, 3 * w + 1)
    assert (raw[:, 0] == 2).all(), "every row should use the Up filter"
    out = np.empty((h, 3 * w), np.uint8)
    prev = np.zeros(3 * w, np.uint8)
    for r in range(h):
        prev = out[r] = prev + raw[r, 1:]
    return out.reshape(h, w, 3)


def make_writable(path: Path) -> None:
    for p in [path, *path.rglob("*")] if path.is_dir() else [path]:
        try:
            os.chmod(p, stat.S_IREAD | stat.S_IWRITE)
        except OSError:
            pass


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=os.environ.get("TIFF2PDF_TEST_TMP"))
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        make_writable(self.dir)
        self._tmp.cleanup()

    def run_cli(self, *args) -> tuple[int, str]:
        out = io.StringIO()
        with redirect_stdout(out):
            code = t2p.main([str(a) for a in args])
        return code, out.getvalue()

    def tiff(self, name="art_7x19cm_150ppi", mode="RGB", spec_bleed="3.0 mm per side (18 px)", folder=None, seed=0,
             spec_dims="401x1100", **kw) -> tuple[Path, np.ndarray]:
        folder = folder or self.dir
        folder.mkdir(parents=True, exist_ok=True)
        arr = pixels(seed=seed)
        im = Image.fromarray(arr, "RGB")
        if mode != "RGB":
            im = im.convert(mode)
        path = folder / f"{name}.tif"
        save_tiff(path, im, **kw)
        if spec_bleed is not None:
            (folder / f"{name}_SPEC.txt").write_text(SPEC.format(name=path.name, bleed=spec_bleed, dims=spec_dims),
                                                    encoding="utf-8")
        return path, arr

    def spec_path(self, tif: Path) -> Path:
        return tif.with_name(tif.stem + "_SPEC.txt")

    def spec_text(self, tif: Path) -> str:
        return self.spec_path(tif).read_text(encoding="utf-8")

    def assert_pdf_is_tiff(self, pdf: Path, tif: Path) -> None:
        with Image.open(tif) as im:
            expected = np.asarray(im.convert("RGB"))
        np.testing.assert_array_equal(decode_pdf(pdf), expected)

    def assert_no_temp_files(self) -> None:
        left = [p.name for p in self.dir.rglob("*") if t2p.TEMP_TAG in p.name or p.name.endswith(".part")]
        self.assertEqual(left, [])

    def assert_refused(self, tif: Path, message: str) -> None:
        code, out = self.run_cli(tif)
        self.assertEqual(code, 1, out)
        self.assertIn(message, out)
        self.assertFalse(tif.with_suffix(".pdf").exists())
        self.assert_no_temp_files()


class Conversion(Base):
    def test_rgb_tiff_becomes_a_verified_pdf_with_the_spec_sheet_bleed(self):
        tif, arr = self.tiff(spec_bleed="3.0 mm per side (25 px)")
        code, out = self.run_cli(self.dir)
        self.assertEqual(code, 0, out)
        pdf = tif.with_suffix(".pdf")
        np.testing.assert_array_equal(decode_pdf(pdf), arr)
        facts = up.read_pdf_delivery(pdf)
        self.assertTrue(facts["icc_based"])
        self.assertEqual((facts["width"], facts["height"]), (401, 1100))
        b = 25 / PPI * 72
        for got, want in zip(facts["trim"], (b, b, 401 / PPI * 72 - b, 1100 / PPI * 72 - b)):
            self.assertAlmostEqual(got, want, places=2)
        lines = [line for line in self.spec_text(tif).splitlines() if line.startswith("PDF delivery:")]
        self.assertEqual(len(lines), 1)
        self.assertIn(up.sha256_file(pdf), lines[0])
        self.assertIn(hashlib.sha256(arr.tobytes()).hexdigest(), lines[0])
        st = tif.stat()
        self.assertTrue(lines[0].endswith(f"; source TIFF {st.st_size} bytes, modified {st.st_mtime_ns}"), lines[0])
        self.assertIn("bleed 25 px (from the spec sheet)", out)
        self.assert_no_temp_files()

    def test_bleed_from_the_option_when_there_is_no_spec_sheet(self):
        tif, _ = self.tiff(spec_bleed=None)
        code, out = self.run_cli(tif, "--bleed-mm", "5")
        self.assertEqual(code, 0, out)
        self.assertIn("assumed --bleed-mm 5", out)
        facts = up.read_pdf_delivery(tif.with_suffix(".pdf"))
        self.assertAlmostEqual(facts["trim"][0], round(5 / 25.4 * PPI) / PPI * 72, places=2)
        self.assertFalse(self.spec_path(tif).exists())

    def test_spec_sheet_without_bleed(self):
        tif, _ = self.tiff(spec_bleed="none")
        self.assertEqual(self.run_cli(tif)[0], 0)
        facts = up.read_pdf_delivery(tif.with_suffix(".pdf"))
        self.assertEqual(facts["trim"], facts["media"])

    def test_resolution_in_centimetres(self):
        tif, arr = self.tiff(dpi=None, resolution=59.06, resolution_unit=3)
        code, out = self.run_cli(tif)
        self.assertEqual(code, 0, out)
        facts = up.read_pdf_delivery(tif.with_suffix(".pdf"))
        self.assertAlmostEqual(facts["media"][2], 401 / (59.06 * 2.54) * 72, places=1)
        np.testing.assert_array_equal(decode_pdf(tif.with_suffix(".pdf")), arr)

    def test_grayscale_and_palette_tiffs_become_rgb(self):
        for mode in ("L", "P"):
            with self.subTest(mode=mode):
                tif, _ = self.tiff(name=f"img_{mode}", mode=mode, icc=None)
                code, out = self.run_cli(tif)
                self.assertEqual(code, 0, out)
                self.assert_pdf_is_tiff(tif.with_suffix(".pdf"), tif)
                self.assertIn("assumed, no profile in the TIFF", out)

    def test_transparency_is_flattened_on_white(self):
        alpha = np.tile(np.linspace(0, 255, 401).astype(np.uint8), (1100, 1))
        im = Image.fromarray(np.dstack([pixels(), alpha]), "RGBA")
        tif = self.dir / "alpha.tif"
        save_tiff(tif, im)
        code, out = self.run_cli(tif)
        self.assertEqual(code, 0, out)
        white = Image.new("RGB", im.size, (255, 255, 255))
        white.paste(im, mask=im.getchannel("A"))
        np.testing.assert_array_equal(decode_pdf(tif.with_suffix(".pdf")), np.asarray(white))

    def test_non_rgb_or_broken_profile_is_replaced_by_srgb(self):
        lab = ImageCms.ImageCmsProfile(ImageCms.createProfile("LAB")).tobytes()
        for name, icc, note in (("lab", lab, "is Lab, not RGB"), ("junk", b"not a profile " * 20, "not a valid ICC profile")):
            with self.subTest(name):
                tif, arr = self.tiff(name=name, icc=icc)
                code, out = self.run_cli(tif)
                self.assertEqual(code, 0, out)
                self.assertIn(note, out)
                self.assertTrue(up.read_pdf_delivery(tif.with_suffix(".pdf"))["icc_based"])
                np.testing.assert_array_equal(decode_pdf(tif.with_suffix(".pdf")), arr)

    def test_spec_sheet_keeps_crlf_and_non_ascii_bytes(self):
        tif, _ = self.tiff()
        spec = self.spec_path(tif)
        original = spec.read_bytes().replace(b"\n", b"\r\n") + "Notes:            café — Zürich\r\n".encode("utf-8") + b"Legacy:           \xe9t\xe9\r\n"
        spec.write_bytes(original)
        for _ in range(2):
            code, out = self.run_cli(tif, "--force")
            self.assertEqual(code, 0, out)
        data = spec.read_bytes()
        kept = b"".join(line for line in data.splitlines(keepends=True) if not line.startswith(b"PDF delivery:"))
        self.assertEqual(kept, original)
        self.assertEqual(data.count(b"PDF delivery:"), 1)
        self.assertTrue(data.endswith(b"\r\n"))
        self.assertNotIn(b"\n", data.replace(b"\r\n", b""))

    def test_compression_threads_change_only_the_stream_layout(self):
        tif, arr = self.tiff()
        outs = {}
        with mock.patch.object(t2p, "datetime", FixedDatetime):
            for n in (1, 3):
                code, out = self.run_cli(tif, "--out-dir", self.dir / f"t{n}", "--threads", n)
                self.assertEqual(code, 0, out)
                self.assertIn(f"{n} compression thread(s) each", out)
                outs[n] = self.dir / f"t{n}" / tif.with_suffix(".pdf").name
        np.testing.assert_array_equal(decode_pdf(outs[3]), arr)
        self.assertEqual(up.read_pdf_delivery(outs[1])["pixels_sha256"], up.read_pdf_delivery(outs[3])["pixels_sha256"])
        self.assertNotEqual(outs[1].read_bytes(), outs[3].read_bytes())
        self.assertLess(abs(outs[1].stat().st_size - outs[3].stat().st_size), 0.01 * outs[1].stat().st_size)

    def test_names_the_console_cannot_encode_do_not_break_a_logged_run(self):
        folder = self.dir / "names"
        self.tiff(name="Łódź_poster", folder=folder)
        env = {k: v for k, v in os.environ.items() if k not in ("PYTHONIOENCODING", "PYTHONUTF8")}
        env["PYTHONPATH"] = str(PROJECT)
        runs = []
        for _ in range(2):
            proc = subprocess.run([sys.executable, str(HERE / "tiff_to_pdf.py"), str(folder)], env=env,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=300)
            runs.append((proc.returncode, proc.stdout.decode("ascii", errors="replace")))
        self.assertEqual(runs[0][0], 0, runs[0][1])
        self.assertIn("1 converted", runs[0][1])
        self.assertEqual(runs[1][0], 0, runs[1][1])
        self.assertIn("1 already up to date", runs[1][1])


class WriterThreads(unittest.TestCase):
    def test_band_boundaries_and_tiny_images(self):
        rows = up.PDF_BAND_ROWS
        with tempfile.TemporaryDirectory(dir=os.environ.get("TIFF2PDF_TEST_TMP")) as d:
            for h in (1, 2, rows - 1, rows, rows + 1, 2 * rows, 2 * rows + 3):
                for threads in (1, 2, 4):
                    with self.subTest(height=h, threads=threads):
                        arr = np.random.default_rng(h).integers(0, 256, (h, 7, 3), dtype=np.uint8)
                        pdf = Path(d) / f"h{h}_t{threads}.pdf"
                        facts = up.write_pdf(pdf, Image.fromarray(arr, "RGB"), 150.0, 0, None, "none", title="t",
                                             created=FIXED_TIME, threads=threads)
                        want = hashlib.sha256(arr.tobytes()).hexdigest()
                        self.assertEqual(facts["pixels_sha256"], want)
                        self.assertEqual(up.read_pdf_delivery(pdf)["pixels_sha256"], want)
                        np.testing.assert_array_equal(decode_pdf(pdf), arr)
            self.assertEqual([p.name for p in Path(d).iterdir() if p.suffix == ".part"], [])

    def test_threaded_stream_is_deterministic_and_single_thread_matches_the_old_writer(self):
        arr = pixels(w=64, h=1300)
        with tempfile.TemporaryDirectory(dir=os.environ.get("TIFF2PDF_TEST_TMP")) as d:
            written = {}
            for threads in (1, 2, 5):
                pdf = Path(d) / f"t{threads}.pdf"
                up.write_pdf(pdf, Image.fromarray(arr, "RGB"), 150.0, 0, None, "none", title="t", created=FIXED_TIME,
                             threads=threads)
                written[threads] = pdf.read_bytes()
            self.assertEqual(written[2], written[5])
            self.assertNotEqual(written[1], written[2])
            comp = zlib.compressobj(6)
            stream = b""
            prev = np.zeros((64, 3), np.uint8)
            for y0 in range(0, 1300, up.PDF_BAND_ROWS):
                band = arr[y0:y0 + up.PDF_BAND_ROWS]
                above = np.concatenate([prev[None], band[:-1]], axis=0)
                rows = np.concatenate([np.full((len(band), 1), 2, np.uint8), (band - above).reshape(len(band), -1)], axis=1)
                stream += comp.compress(rows.tobytes())
                prev = band[-1]
            stream += comp.flush()
            self.assertIn(stream, written[1])

    def test_decoder_returns_when_bytes_follow_the_zlib_stream(self):
        arr = pixels(w=33, h=700)
        with tempfile.TemporaryDirectory(dir=os.environ.get("TIFF2PDF_TEST_TMP")) as d:
            good = Path(d) / "good.pdf"
            want = up.write_pdf(good, Image.fromarray(arr, "RGB"), 150.0, 0, None, "none", title="t",
                                created=FIXED_TIME, threads=2)["pixels_sha256"]
            data = good.read_bytes()
            length = int(re.search(rb"\n9 0 obj\n(\d+)\nendobj", data).group(1))
            for extra in (1, 10):
                with self.subTest(extra=extra):
                    bad = Path(d) / f"length_plus_{extra}.pdf"
                    bad.write_bytes(data.replace(b"\n9 0 obj\n%d\nendobj" % length, b"\n9 0 obj\n%d\nendobj" % (length + extra)))
                    result = {}
                    worker = threading.Thread(target=lambda: result.update(up.read_pdf_delivery(bad)), daemon=True)
                    worker.start()
                    worker.join(20)
                    self.assertFalse(worker.is_alive(), "read_pdf_delivery did not return")
                    self.assertEqual(result["pixels_sha256"], want)


class Refusals(Base):
    def test_tiff_without_resolution(self):
        tif, _ = self.tiff(dpi=None)
        self.assert_refused(tif, "no resolution tag")

    def test_resolution_without_unit(self):
        tif, _ = self.tiff(dpi=None, resolution=150, resolution_unit=1)
        self.assert_refused(tif, "has no unit")

    def test_page_too_large_for_pdf(self):
        tif, _ = self.tiff(dpi=(1, 1))
        self.assert_refused(tif, "over the PDF limit")

    def test_non_square_pixels(self):
        tif, _ = self.tiff(dpi=(150, 300))
        self.assert_refused(tif, "non-square pixels")

    def test_spec_sheet_for_another_size(self):
        tif, _ = self.tiff(spec_dims="400x1100")
        self.assert_refused(tif, "spec sheet describes a 400x1100 px file")

    def test_unreadable_bleed_line(self):
        tif, _ = self.tiff(spec_bleed="three millimetres")
        self.assert_refused(tif, "unreadable Bleed line")

    def test_bleed_larger_than_the_image(self):
        tif, _ = self.tiff(spec_bleed="big (250 px)")
        self.assert_refused(tif, "does not fit")

    def test_cmyk(self):
        tif = self.dir / "cmyk.tif"
        save_tiff(tif, Image.fromarray(pixels()).convert("CMYK"), icc=None)
        self.assert_refused(tif, "colour mode CMYK")

    def test_16_bit(self):
        tif = self.dir / "g16.tif"
        save_tiff(tif, Image.fromarray(pixels()[..., 0].astype(np.uint16) * 257), icc=None)
        self.assert_refused(tif, "colour mode I;16")

    def test_multi_page(self):
        tif = self.dir / "pages.tif"
        page = Image.fromarray(pixels())
        page.save(tif, "TIFF", dpi=(PPI, PPI), save_all=True, append_images=[page.copy()])
        self.assert_refused(tif, "2 pages")

    def test_rotated_by_orientation_tag(self):
        tif, _ = self.tiff(tiffinfo={274: 6})
        self.assert_refused(tif, "orientation tag 6")

    def test_read_only_spec_sheet_is_refused_at_once_before_converting(self):
        tif, _ = self.tiff()
        os.chmod(self.spec_path(tif), stat.S_IREAD)
        t = time.perf_counter()
        code, out = self.run_cli(tif)
        self.assertEqual(code, 1, out)
        self.assertIn(f"{self.spec_path(tif).name} is read-only", out)
        self.assertLess(time.perf_counter() - t, 5)
        self.assertFalse(tif.with_suffix(".pdf").exists())
        self.assert_no_temp_files()

    def test_read_only_pdf_is_refused_at_once_and_kept(self):
        tif, _ = self.tiff()
        pdf = tif.with_suffix(".pdf")
        self.assertEqual(self.run_cli(tif)[0], 0)
        before = pdf.read_bytes()
        os.chmod(pdf, stat.S_IREAD)
        code, out = self.run_cli(tif, "--force")
        self.assertEqual(code, 1, out)
        self.assertIn(f"{pdf.name} is read-only", out)
        self.assertNotIn("locked by another program", out)
        self.assertEqual(pdf.read_bytes(), before)
        self.assert_no_temp_files()


class Rerun(Base):
    def test_up_to_date_pdf_is_skipped_and_force_converts_again(self):
        tif, _ = self.tiff()
        pdf = tif.with_suffix(".pdf")
        self.assertEqual(self.run_cli(self.dir)[0], 0)
        before = pdf.stat().st_mtime_ns
        code, out = self.run_cli(self.dir)
        self.assertEqual(code, 0, out)
        self.assertIn("SKIP", out)
        self.assertEqual(pdf.stat().st_mtime_ns, before)
        code, out = self.run_cli(self.dir, "--force")
        self.assertEqual(code, 0, out)
        self.assertIn("OK ", out)
        self.assertEqual(self.spec_text(tif).count("PDF delivery:"), 1)

    def assert_converted_again(self, tif: Path, reason: str, *extra) -> None:
        code, out = self.run_cli(tif, "--dry-run", *extra)
        self.assertEqual(code, 0, out)
        self.assertIn(reason, out)
        code, out = self.run_cli(tif, *extra)
        self.assertEqual(code, 0, out)
        self.assertIn("OK ", out)
        self.assertNotIn("SKIP", out)
        pdf = (Path(extra[1]) if extra else tif.parent) / tif.with_suffix(".pdf").name
        self.assert_pdf_is_tiff(pdf, tif)
        if not extra:
            self.assertIn(up.sha256_file(pdf), self.spec_text(tif))
        code, out = self.run_cli(tif, *extra)
        self.assertIn("SKIP", out)

    def test_tiff_delivered_again_after_its_pdf_is_converted_again(self):
        tif, _ = self.tiff()
        self.run_cli(tif)
        save_tiff(tif, Image.fromarray(pixels(seed=7)))
        pdf = tif.with_suffix(".pdf")
        old = tif.stat().st_mtime - 3600
        os.utime(pdf, (old, old))
        self.assert_converted_again(tif, "the TIFF is newer than its PDF")

    def test_tiff_replaced_by_a_copy_with_an_older_date_is_converted_again(self):
        tif, _ = self.tiff()
        self.run_cli(tif)
        incoming = self.dir / "incoming"
        incoming.mkdir()
        replacement = incoming / tif.name
        save_tiff(replacement, Image.fromarray(pixels(seed=9)))
        day_ago = time.time() - 86400
        os.utime(replacement, (day_ago, day_ago))
        shutil.copy2(replacement, tif)
        self.assert_converted_again(tif, "the TIFF is not the one this PDF was made from")

    def test_tiff_of_another_size_copied_over_is_converted_again_with_out_dir(self):
        tif, _ = self.tiff(spec_bleed=None)
        out_dir = self.dir / "pdfs"
        self.assertEqual(self.run_cli(tif, "--out-dir", out_dir)[0], 0)
        replacement = self.dir / "replacement.tif"
        save_tiff(replacement, Image.fromarray(pixels(w=300, h=900, seed=3)))
        day_ago = time.time() - 86400
        os.utime(replacement, (day_ago, day_ago))
        shutil.copy2(replacement, tif)
        self.assert_converted_again(tif, "the PDF does not have the TIFF's pixel size", "--out-dir", str(out_dir))

    def test_records_written_before_the_tiff_record_existed_still_skip(self):
        tif, _ = self.tiff()
        self.run_cli(tif)
        spec = self.spec_path(tif)
        spec.write_text(re.sub(r"; source TIFF \d+ bytes, modified \d+", "", spec.read_text(encoding="utf-8")),
                        encoding="utf-8")
        code, out = self.run_cli(tif)
        self.assertEqual(code, 0, out)
        self.assertIn("SKIP", out)

    def test_spec_sheet_rewritten_by_the_pipeline_is_converted_again(self):
        tif, _ = self.tiff()
        self.run_cli(tif)
        self.spec_path(tif).write_text(SPEC.format(name=tif.name, bleed="3.0 mm per side (18 px)", dims="401x1100"),
                                       encoding="ascii")
        self.assert_converted_again(tif, "the spec sheet does not record this PDF")

    def test_pdf_that_differs_from_the_spec_sheet_record_is_converted_again(self):
        tif, _ = self.tiff()
        self.run_cli(tif)
        spec = self.spec_path(tif)
        text = spec.read_text(encoding="utf-8")
        spec.write_text(re.sub(r"file sha256 [0-9a-f]{64}", "file sha256 " + "0" * 64, text), encoding="utf-8")
        self.assert_converted_again(tif, "not the one the spec sheet records")

    def test_truncated_pdf_is_converted_again(self):
        tif, _ = self.tiff()
        pdf = tif.with_suffix(".pdf")
        self.run_cli(tif)
        data = pdf.read_bytes()
        pdf.write_bytes(data[: len(data) // 2])
        self.assert_converted_again(tif, "PDF is incomplete")

    def test_name_starting_with_a_space_is_skipped_after_conversion(self):
        tif, _ = self.tiff(name=" poster")
        self.assertEqual(self.run_cli(tif)[0], 0)
        code, out = self.run_cli(tif)
        self.assertEqual(code, 0, out)
        self.assertIn("SKIP", out)

    def test_dry_run_writes_nothing(self):
        tif, _ = self.tiff()
        spec_before = self.spec_path(tif).read_bytes()
        out_dir = self.dir / "never"
        for extra in ([], ["--out-dir", out_dir]):
            code, out = self.run_cli(tif, "--dry-run", *extra)
            self.assertEqual(code, 0, out)
            self.assertIn("WOULD CONVERT", out)
            self.assertIn("no PDF yet", out)
        self.assertFalse(tif.with_suffix(".pdf").exists())
        self.assertFalse(out_dir.exists())
        self.assertEqual(self.spec_path(tif).read_bytes(), spec_before)
        self.run_cli(tif)
        code, out = self.run_cli(tif, "--dry-run")
        self.assertIn("SKIP", out)
        self.assertIn("0 to convert", out)

    def test_ctrl_c_while_checking_existing_pdfs_exits_130(self):
        tif, _ = self.tiff()
        for extra in ([], ["--dry-run"]):
            with self.subTest(extra=extra), mock.patch.object(t2p, "up_to_date", side_effect=KeyboardInterrupt):
                code, out = self.run_cli(tif, *extra)
            self.assertEqual(code, 130, out)
            self.assertIn("interrupted while checking the existing PDFs", out)
        self.assertFalse(tif.with_suffix(".pdf").exists())


class Safety(Base):
    def test_failed_verification_keeps_the_previous_pdf(self):
        tif, _ = self.tiff()
        pdf = tif.with_suffix(".pdf")
        self.run_cli(tif)
        good = pdf.read_bytes()
        real = up.read_pdf_delivery

        def wrong_pixels(path):
            facts = real(path)
            facts["pixels_sha256"] = "0" * 64
            return facts

        with mock.patch.object(up, "read_pdf_delivery", side_effect=wrong_pixels):
            code, out = self.run_cli(tif, "--force")
        self.assertEqual(code, 1, out)
        self.assertIn("VerificationError", out)
        self.assertEqual(pdf.read_bytes(), good)
        self.assertIn(up.sha256_file(pdf), self.spec_text(tif))
        self.assert_no_temp_files()

    def test_crash_after_writing_leaves_no_files(self):
        tif, _ = self.tiff()
        real = up.write_pdf

        def crash(*a, **k):
            real(*a, **k)
            raise MemoryError("simulated")

        with mock.patch.object(up, "write_pdf", side_effect=crash):
            code, out = self.run_cli(tif)
        self.assertEqual(code, 1, out)
        self.assertIn("MemoryError", out)
        self.assertFalse(tif.with_suffix(".pdf").exists())
        self.assertNotIn("PDF delivery:", self.spec_text(tif))
        self.assert_no_temp_files()

    def test_crash_inside_threaded_compression_leaves_no_files(self):
        tif, _ = self.tiff()
        real = up._deflate_band
        calls = {"n": 0}

        def flaky(*a, **k):
            calls["n"] += 1
            if calls["n"] == 2:
                raise MemoryError("simulated in a compression thread")
            return real(*a, **k)

        with mock.patch.object(up, "_deflate_band", side_effect=flaky):
            code, out = self.run_cli(tif, "--threads", "3")
        self.assertEqual(code, 1, out)
        self.assertIn("simulated in a compression thread", out)
        self.assertFalse(tif.with_suffix(".pdf").exists())
        self.assert_no_temp_files()

    @staticmethod
    def flaky_replace(failures: int, target: str = ".pdf"):
        real = os.replace
        seen = {"n": 0}

        def replace(src, dst):
            s = str(src)
            if t2p.TEMP_TAG in s and not s.endswith(".part") and str(dst).endswith(target) and seen["n"] < failures:
                seen["n"] += 1
                raise PermissionError(5, "Access is denied")
            return real(src, dst)

        return replace

    def test_briefly_locked_pdf_is_retried(self):
        tif, _ = self.tiff()
        with mock.patch("os.replace", side_effect=self.flaky_replace(2)), mock.patch("time.sleep"):
            code, out = self.run_cli(tif)
        self.assertEqual(code, 0, out)
        self.assert_pdf_is_tiff(tif.with_suffix(".pdf"), tif)

    def test_pdf_locked_for_good_is_reported_and_cleaned_up(self):
        tif, _ = self.tiff()
        with mock.patch("os.replace", side_effect=self.flaky_replace(99)), mock.patch("time.sleep"):
            code, out = self.run_cli(tif)
        self.assertEqual(code, 1, out)
        self.assertIn("locked by another program", out)
        self.assertFalse(tif.with_suffix(".pdf").exists())
        self.assert_no_temp_files()

    def test_locked_spec_sheet_is_reported_and_finished_on_the_next_run(self):
        tif, _ = self.tiff()
        with mock.patch("os.replace", side_effect=self.flaky_replace(99, "_SPEC.txt")), mock.patch("time.sleep"):
            code, out = self.run_cli(tif)
        self.assertEqual(code, 1, out)
        self.assertIn("could not be updated", out)
        self.assertNotIn("PDF delivery:", self.spec_text(tif))
        self.assert_no_temp_files()
        code, out = self.run_cli(tif)
        self.assertEqual(code, 0, out)
        self.assertIn(up.sha256_file(tif.with_suffix(".pdf")), self.spec_text(tif))

    def test_leftovers_of_a_dead_run_are_removed_and_live_ones_kept(self):
        tif, _ = self.tiff()
        dead = [self.dir / f"{tif.stem}.tiff2pdf-999999999-1.pdf", self.dir / f"{tif.stem}.pdf.999999999.part",
                self.dir / f"{tif.stem}_SPEC.txt.tiff2pdf-999999999-1"]
        live = self.dir / f"{tif.stem}.tiff2pdf-{os.getpid()}-12345.pdf"
        for p in [*dead, live]:
            p.write_bytes(b"partial")
        self.assertEqual(self.run_cli(tif)[0], 0)
        self.assertEqual([p.exists() for p in dead], [False, False, False])
        self.assertTrue(live.exists())
        live.unlink()


class Folders(Base):
    def test_out_dir_leaves_spec_sheets_alone_and_refuses_name_clashes(self):
        a, _ = self.tiff(folder=self.dir / "a")
        b, _ = self.tiff(folder=self.dir / "b", seed=1)
        spec_before = self.spec_path(a).read_bytes()
        out_dir = self.dir / "pdfs"
        code, out = self.run_cli(a, b, "--out-dir", out_dir)
        self.assertEqual(code, 1, out)
        self.assertIn("would overwrite", out)
        self.assert_pdf_is_tiff(out_dir / f"{a.stem}.pdf", a)
        self.assertEqual(self.spec_path(a).read_bytes(), spec_before)

    def test_parallel_workers_write_the_same_bytes_as_one_worker(self):
        src = self.dir / "src"
        arrays = {f"img{i}": self.tiff(name=f"img{i}", folder=src, seed=i)[1] for i in range(5)}
        with mock.patch.object(t2p, "datetime", FixedDatetime):
            self.assertEqual(self.run_cli(src, "--out-dir", self.dir / "one", "--workers", "1", "--threads", "2")[0], 0)
            code, out = self.run_cli(src, "--out-dir", self.dir / "three", "--workers", "3", "--threads", "4")
        self.assertEqual(code, 0, out)
        self.assertIn("3 at a time", out)
        for stem, arr in arrays.items():
            one, three = self.dir / "one" / f"{stem}.pdf", self.dir / "three" / f"{stem}.pdf"
            self.assertEqual(one.read_bytes(), three.read_bytes())
            np.testing.assert_array_equal(decode_pdf(three), arr)

    def test_file_given_twice_is_converted_once_and_an_empty_folder_is_fine(self):
        tif, _ = self.tiff()
        code, out = self.run_cli(tif, tif, self.dir)
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("OK "), 1)
        empty = self.dir / "empty"
        empty.mkdir()
        code, out = self.run_cli(empty)
        self.assertEqual(code, 0, out)
        self.assertIn("no TIFF files", out)


class CommandLine(Base):
    def test_missing_path_and_non_tiff_file_fail(self):
        txt = self.dir / "notes.txt"
        txt.write_text("x")
        code, out = self.run_cli(self.dir / "nope", txt)
        self.assertEqual(code, 1, out)
        self.assertIn("not found", out)
        self.assertIn("not a TIFF file", out)

    def test_bad_options_are_rejected(self):
        tif, _ = self.tiff()
        a_file = self.dir / "a_file"
        a_file.write_text("x")
        for args in (["--bleed-mm", "-1"], ["--bleed-mm", "nan"], ["--bleed-mm", "60"], ["--workers", "0"],
                     ["--workers", "many"], ["--threads", "0"], ["--out-dir", str(a_file)]):
            with self.subTest(args=args):
                with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
                    t2p.main([str(tif), *args])
                self.assertEqual(cm.exception.code, 2)
        self.assertFalse(tif.with_suffix(".pdf").exists())

    def test_auto_workers_and_threads_are_bounded(self):
        px, gb = 5942 * 5942, 1 << 30
        self.assertEqual(t2p.auto_workers([px] * 10, 8 * gb, 8), 4)
        self.assertEqual(t2p.auto_workers([px] * 10, 1 * gb, 8), 1)
        self.assertEqual(t2p.auto_workers([px] * 2, 16 * gb, 16), 2)
        self.assertEqual(t2p.auto_workers([], None, None), 1)
        self.assertEqual(t2p.auto_threads(1, 8), 8)
        self.assertEqual(t2p.auto_threads(4, 8), 2)
        self.assertEqual(t2p.auto_threads(1, 32), t2p.MAX_THREADS)
        self.assertEqual(t2p.auto_threads(3, 2), 1)


@unittest.skipUnless(OLD, "set TIFF2PDF_OLD to a previous tiff_to_pdf.py")
class Parity(Base):
    def test_same_bytes_as_the_previous_converter_with_one_thread(self):
        spec = importlib.util.spec_from_file_location("tiff_to_pdf_previous", OLD)
        old = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(old)
        for name, kw in (("rgb", {}), ("gray_no_icc", {"mode": "L", "icc": None})):
            with self.subTest(name):
                tif, _ = self.tiff(name=name, **kw)
                (self.dir / "old").mkdir(exist_ok=True)
                with mock.patch.object(old, "datetime", FixedDatetime), mock.patch.object(t2p, "datetime", FixedDatetime):
                    status, msg = old.convert(tif, 3.0, self.dir / "old", True)
                    self.assertEqual(status, "ok", msg)
                    code, out = self.run_cli(tif, "--out-dir", self.dir / "new", "--force", "--threads", "1")
                self.assertEqual(code, 0, out)
                pdf = tif.with_suffix(".pdf").name
                self.assertEqual((self.dir / "old" / pdf).read_bytes(), (self.dir / "new" / pdf).read_bytes())


if __name__ == "__main__":
    unittest.main(verbosity=2)
