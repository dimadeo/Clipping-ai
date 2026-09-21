import base64
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import dashboard_server


class DashboardServerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.original_upload_dir = dashboard_server.UPLOAD_DIR
        self.original_status_file = dashboard_server.STATUS_FILE
        self.original_run_audit_file = dashboard_server.RUN_AUDIT_FILE
        self.original_offline_runtime_status_file = dashboard_server.OFFLINE_RUNTIME_STATUS_FILE
        dashboard_server.UPLOAD_DIR = self.temp_path / "uploads"
        dashboard_server.STATUS_FILE = self.temp_path / "dashboard_state.json"
        dashboard_server.RUN_AUDIT_FILE = self.temp_path / "dashboard_run_audit.jsonl"
        dashboard_server.OFFLINE_RUNTIME_STATUS_FILE = self.temp_path / "offline_runtime_status.json"

    def tearDown(self):
        dashboard_server.UPLOAD_DIR = self.original_upload_dir
        dashboard_server.STATUS_FILE = self.original_status_file
        dashboard_server.RUN_AUDIT_FILE = self.original_run_audit_file
        dashboard_server.OFFLINE_RUNTIME_STATUS_FILE = self.original_offline_runtime_status_file
        self.temp_dir.cleanup()

    def test_prepare_run_payload_requires_subject_for_fine_art_creation(self):
        with self.assertRaises(ValueError):
            dashboard_server.prepare_run_payload({"workflow": "fine_art_creation"})

    def test_prepare_run_payload_accepts_campaign_alias_and_topic_alias(self):
        payload = dashboard_server.prepare_run_payload({"workflow": "campaign", "topic": "Brutalist light memory"})

        self.assertEqual(payload["workflow"], "fine_art_creation")
        self.assertEqual(payload["subject"], "Brutalist light memory")
        self.assertEqual(payload["topic"], "Brutalist light memory")
        self.assertEqual(payload["ratio"], "4:5")
        self.assertEqual(payload["intended_environment"], "gallery print")
        self.assertEqual(payload["art_dna_mode"], "AUTO")
        self.assertEqual(payload["creative_freedom"], 100)
        self.assertEqual(payload["originality_priority"], 100)
        self.assertEqual(payload["similarity_tolerance"], 1)
        self.assertEqual(payload["commercial_cliche_tolerance"], 0)
        self.assertEqual(payload["predictability_tolerance"], 0)
        self.assertEqual(payload["artistic_ambition"], 100)
        self.assertEqual(payload["creation_size_family"], "a_series")
        self.assertEqual(payload["creation_a_series_size"], "A1")
        self.assertEqual(payload["creation_orientations"], ["portrait"])

    def test_prepare_run_payload_accepts_creation_square_controls(self):
        command_text = "CREATE ART DNA #[AUTO]\nSubject or starting idea: Monolithic memory sea"
        override_text = "ARTWORK TITLE\nControl Prompt"
        payload = dashboard_server.prepare_run_payload(
            {
                "workflow": "fine_art_creation",
                "subject": "Monolithic memory sea",
                "prompt_creator_command": command_text,
                "creation_prompt_override": override_text,
                "creation_size_family": "square_1_1",
                "creation_square_size_cm": 120,
                "creation_orientations": ["landscape", "vertical"],
                "creative_freedom": 92,
                "originality_priority": 97,
                "similarity_tolerance": 5,
                "commercial_cliche_tolerance": 1,
                "predictability_tolerance": 3,
                "artistic_ambition": 100,
            }
        )

        self.assertEqual(payload["creation_size_family"], "square_1_1")
        self.assertEqual(payload["creation_square_size_cm"], 120)
        self.assertEqual(payload["creation_orientations"], ["landscape", "vertical"])
        self.assertEqual(payload["prompt_creator_command"], command_text)
        self.assertEqual(payload["creation_prompt_override"], override_text)
        self.assertEqual(payload["creative_freedom"], 92)
        self.assertEqual(payload["originality_priority"], 97)
        self.assertEqual(payload["similarity_tolerance"], 5)
        self.assertEqual(payload["commercial_cliche_tolerance"], 1)
        self.assertEqual(payload["predictability_tolerance"], 3)
        self.assertEqual(payload["artistic_ambition"], 100)

    def test_prepare_run_payload_rejects_invalid_creation_dial_value(self):
        with self.assertRaises(ValueError):
            dashboard_server.prepare_run_payload(
                {
                    "workflow": "fine_art_creation",
                    "subject": "Mineral cathedral",
                    "creative_freedom": 101,
                }
            )

    def test_prepare_run_payload_does_not_reroute_fine_art_when_require_approval_is_true(self):
        payload = dashboard_server.prepare_run_payload(
            {
                "workflow": "fine_art_creation",
                "subject": "Memory architecture",
                "require_approval": True,
            }
        )

        self.assertEqual(payload["workflow"], "fine_art_creation")
        self.assertTrue(payload["require_approval"])

    def test_prepress_quality_gate_blocks_critical_runs_without_override(self):
        with patch.object(
            dashboard_server,
            "get_print_review",
            return_value={"available": True, "failed": 0, "critical": 2, "caveats": 0},
        ):
            with self.assertRaises(ValueError):
                dashboard_server.prepare_run_payload(
                    {
                        "workflow": "prepress",
                        "prepress_mode": "run",
                        "confirm_external_actions": True,
                    }
                )

    def test_prepress_quality_gate_accepts_explicit_override(self):
        with patch.object(
            dashboard_server,
            "get_print_review",
            return_value={"available": True, "failed": 0, "critical": 1, "caveats": 0},
        ):
            payload = dashboard_server.prepare_run_payload(
                {
                    "workflow": "prepress",
                    "prepress_mode": "run",
                    "confirm_external_actions": True,
                    "quality_gate_override_reason": "Client accepted current critical findings.",
                }
            )

        self.assertTrue(payload["run_id"].startswith("run-"))
        self.assertEqual(payload["quality_gate"]["status"], "bypassed")
        self.assertIn("critical", " ".join(payload["quality_gate"]["blockers"]).lower())

    def test_append_run_audit_writes_manifest_records(self):
        run_id = "run-20260921T000000Z-abc123def0"
        dashboard_server.append_run_audit(
            run_id=run_id,
            workflow="fine_art_creation",
            event="queued",
            status="queued",
            message="Run queued",
            payload={"run_id": run_id, "workflow": "fine_art_creation", "subject": "AI testing"},
        )

        self.assertTrue(dashboard_server.RUN_AUDIT_FILE.exists())
        line = dashboard_server.RUN_AUDIT_FILE.read_text(encoding="utf-8").strip()
        record = json.loads(line)
        self.assertEqual(record["run_id"], run_id)
        self.assertEqual(record["event"], "queued")
        self.assertEqual(record["payload"]["subject"], "AI testing")

    def test_offline_health_payload_uses_local_runtime_report(self):
        dashboard_server.OFFLINE_RUNTIME_STATUS_FILE.write_text(
            json.dumps(
                {
                    "passed": True,
                    "checked_at": "2026-09-21T00:00:00Z",
                    "command": "python -m unittest",
                    "exit_code": 0,
                    "duration_seconds": 12.4,
                    "summary": "All local checks passed.",
                    "output_tail": ["OK"],
                }
            ),
            encoding="utf-8",
        )

        payload = dashboard_server.offline_health_payload()

        self.assertTrue(payload["runtime"]["available"])
        self.assertTrue(payload["runtime"]["passed"])
        self.assertEqual(payload["runtime"]["exit_code"], 0)
        self.assertIn("dashboard_server", {entry["name"] for entry in payload["files"]})

    def test_read_json_accepts_utf8_bom_content(self):
        path = self.temp_path / "bom.json"
        path.write_text("\ufeff{\"ok\": true}", encoding="utf-8")

        parsed = dashboard_server.read_json(path)

        self.assertEqual(parsed, {"ok": True})

    def test_normalize_workflow_accepts_supported_values_and_rejects_unknown_values(self):
        self.assertEqual(dashboard_server.normalize_workflow("prompt"), "fine_art_creation")
        self.assertEqual(dashboard_server.normalize_workflow("campaign"), "fine_art_creation")
        self.assertEqual(dashboard_server.normalize_workflow("fine-art"), "fine_art_creation")
        self.assertEqual(dashboard_server.normalize_workflow("upscale"), "production")
        self.assertEqual(dashboard_server.normalize_workflow(None), "fine_art_creation")

        with self.assertRaises(ValueError):
            dashboard_server.normalize_workflow("everything")

    def test_normalize_production_engine_accepts_supported_values(self):
        self.assertEqual(dashboard_server.normalize_production_engine(None), "auto")
        self.assertEqual(dashboard_server.normalize_production_engine("default"), "auto")
        self.assertEqual(dashboard_server.normalize_production_engine("rust"), "rust")
        self.assertEqual(dashboard_server.normalize_production_engine("python"), "python")

        with self.assertRaises(ValueError):
            dashboard_server.normalize_production_engine("all")

    def test_build_command_uses_fine_art_creation_agent(self):
        command = dashboard_server.build_command(
            {
                "subject": "Geological memory architecture",
                "ratio": "9:16",
                "intended_environment": "museum-scale print",
                "render": True,
            }
        )

        self.assertIn("fine_art_creation_agent.py", command[1])
        self.assertIn("--subject", command)
        self.assertIn("Geological memory architecture", command)
        self.assertIn("--ratio", command)
        self.assertIn("9:16", command)
        self.assertIn("--intended-environment", command)
        self.assertIn("museum-scale print", command)
        self.assertIn("--render", command)

    def test_build_command_includes_creation_controls(self):
        command = dashboard_server.build_command(
            {
                "subject": "Geological memory architecture",
                "ratio": "4:5",
                "intended_environment": "gallery print",
                "prompt_creator_command": "CREATE ART DNA #[AUTO]",
                "creation_prompt_override": "ARTWORK TITLE\nControl Prompt",
                "art_dna_mode": "AUTO",
                "creative_freedom": 100,
                "originality_priority": 95,
                "similarity_tolerance": 2,
                "commercial_cliche_tolerance": 0,
                "predictability_tolerance": 1,
                "artistic_ambition": 99,
                "creation_size_family": "square_1_1",
                "creation_square_size_cm": 150,
                "creation_orientations": ["portrait", "vertical"],
            }
        )

        self.assertIn("--art-dna-mode", command)
        self.assertIn("--prompt-creator-command", command)
        self.assertIn("CREATE ART DNA #[AUTO]", command)
        self.assertIn("--creation-prompt-override", command)
        self.assertIn("ARTWORK TITLE\nControl Prompt", command)
        self.assertIn("--creative-freedom", command)
        self.assertIn("--creation-size-family", command)
        self.assertIn("square_1_1", command)
        self.assertIn("--creation-square-size-cm", command)
        self.assertIn("150", command)
        self.assertIn("--creation-orientations", command)
        self.assertIn("portrait,vertical", command)

    def test_prepare_run_payload_production_requires_image_attachment(self):
        with self.assertRaises(ValueError):
            dashboard_server.prepare_run_payload({"workflow": "production", "target_format": "A1"})

    def test_prepare_run_payload_production_sets_upscale_defaults(self):
        attachment = dashboard_server.save_attachment(
            {
                "name": "source.png",
                "content_type": "image/png",
                "data": base64.b64encode(b"source-image").decode("ascii"),
            }
        )

        payload = dashboard_server.prepare_run_payload(
            {
                "workflow": "production",
                "topic": "Gallery master",
                "target_format": "A1",
                "orientation": "portrait",
                "aspect_mode": "preserve",
                "attachments": [attachment],
            }
        )

        self.assertEqual(payload["workflow"], "production")
        self.assertEqual(payload["target_format"], "A1")
        self.assertEqual(payload["orientation"], "portrait")
        self.assertEqual(payload["aspect_mode"], "preserve")
        self.assertEqual(payload["target_dpi"], 300)
        self.assertEqual(payload["source_attachment_id"], attachment["id"])
        self.assertFalse(payload["require_approval"])
        self.assertFalse(payload["render"])

    def test_build_upscale_production_command_uses_upscale_agent(self):
        source = self.temp_path / "source.png"
        source.write_bytes(b"image")
        command = dashboard_server.build_upscale_production_command(
            {
                "run_id": "run-123",
                "topic": "Gallery master",
                "target_format": "A0",
                "orientation": "landscape",
                "aspect_mode": "crop",
                "target_dpi": 300,
            },
            source,
        )

        self.assertIn("upscale_digital_fine_art_agent.py", command[1])
        self.assertIn("--source", command)
        self.assertIn(str(source), command)
        self.assertIn("--target-format", command)
        self.assertIn("A0", command)
        self.assertIn("--orientation", command)
        self.assertIn("landscape", command)
        self.assertIn("--aspect-mode", command)
        self.assertIn("crop", command)

    def test_run_production_job_executes_upscale_workflow_and_updates_state(self):
        attachment = dashboard_server.save_attachment(
            {
                "name": "source.png",
                "content_type": "image/png",
                "data": base64.b64encode(b"source-image").decode("ascii"),
            }
        )
        payload = {
            "workflow": "production",
            "run_id": "run-abc",
            "topic": "Gallery master",
            "target_format": "A0",
            "orientation": "portrait",
            "aspect_mode": "preserve",
            "target_dpi": 300,
            "source_attachment_id": attachment["id"],
            "attachments": [attachment],
            "links": [],
        }
        completed = subprocess.CompletedProcess(
            args=["python", "upscale_digital_fine_art_agent.py"],
            returncode=0,
            stdout=json.dumps({"status": "completed", "workflow": "upscale_digital_fine_art"}),
            stderr="",
        )

        with patch.object(dashboard_server.subprocess, "run", return_value=completed) as runner:
            dashboard_server.run_production_job(payload)

        state = dashboard_server.read_state()
        runner.assert_called_once()
        self.assertEqual(state["workflow"], "production")
        self.assertEqual(state["status"], "completed")
        self.assertEqual(state["result"]["workflow"], "upscale_digital_fine_art")
        self.assertIn("upscale_digital_fine_art_agent.py", " ".join(state.get("command") or []))

    def test_prepress_run_requires_explicit_confirmation(self):
        self.assertEqual(dashboard_server.normalize_prepress_mode("plan"), "plan")
        self.assertEqual(dashboard_server.normalize_prepress_mode("dry-run"), "dry_run")
        with self.assertRaises(ValueError):
            dashboard_server.normalize_prepress_mode("run")

    def test_run_job_dispatches_each_unified_workflow(self):
        cases = [
            ("fine_art_creation", "run_campaign_job"),
            ("production", "run_production_job"),
            ("prepress", "run_prepress_job"),
        ]
        for workflow, runner_name in cases:
            with self.subTest(workflow=workflow), patch.object(dashboard_server, runner_name) as runner:
                dashboard_server.run_job({"workflow": workflow})
                runner.assert_called_once()

    def test_run_job_keeps_fine_art_dispatch_when_require_approval_is_true(self):
        with patch.object(dashboard_server, "run_campaign_job") as campaign_runner, patch.object(
            dashboard_server,
            "run_production_job",
        ) as production_runner:
            dashboard_server.run_job({"workflow": "fine_art_creation", "require_approval": True})

        campaign_runner.assert_called_once()
        production_runner.assert_not_called()

    def test_prepress_runner_persists_the_common_workflow_state(self):
        completed = subprocess.CompletedProcess(args=["powershell"], returncode=0, stdout="Plan complete", stderr="")
        with patch.object(dashboard_server, "build_prepress_command", return_value=["powershell", "-Plan"]), patch.object(
            dashboard_server,
            "get_print_review",
            return_value={"available": False},
        ), patch.object(dashboard_server.subprocess, "run", return_value=completed):
            dashboard_server.run_prepress_job({"prepress_mode": "plan"})

        state = dashboard_server.read_state()
        self.assertEqual(state["workflow"], "prepress")
        self.assertEqual(state["status"], "completed")
        self.assertEqual(state["stages"]["prepress"]["status"], "completed")

    def test_render_results_are_exposed_as_a_common_creation_and_final_output(self):
        state = dashboard_server.default_state()
        state.update(
            status="completed",
            result={
                "topic": "Gallery systems",
                "winner": {"title": "Gallery master", "prompt": "A strong visual direction"},
                "render_job": {"output_url": "https://example.com/final-art.png"},
            },
        )
        dashboard_server.write_state(state)

        payload = dashboard_server.status_payload()

        self.assertEqual(payload["review"]["creation"]["title"], "Gallery master")
        self.assertEqual(payload["final_result"]["url"], "https://example.com/final-art.png")

    def test_saved_attachment_is_available_to_a_dashboard_run(self):
        attachment = dashboard_server.save_attachment(
            {
                "name": "reference image.png",
                "content_type": "image/png",
                "data": base64.b64encode(b"test image").decode("ascii"),
            }
        )

        self.assertEqual(attachment["name"], "reference image.png")
        self.assertEqual(attachment["kind"], "image")
        self.assertTrue(attachment["url"].startswith("/api/v1/attachments/"))
        self.assertTrue(dashboard_server.attachment_path(attachment["id"]).is_file())
        self.assertEqual(dashboard_server.normalize_attachments([attachment]), [attachment])

    def test_route_suffix_handles_canonical_and_legacy_paths(self):
        artifact_name = "museum-print.tiff"
        canonical = f"/api/v1/artifacts/print/{artifact_name}"
        legacy = f"/print-artifact/{artifact_name}"

        canonical_suffix = dashboard_server.route_suffix(
            canonical,
            dashboard_server.LEGACY_ROUTE_PRINT_ARTIFACTS,
            dashboard_server.ROUTE_PRINT_ARTIFACTS,
        )
        legacy_suffix = dashboard_server.route_suffix(
            legacy,
            dashboard_server.LEGACY_ROUTE_PRINT_ARTIFACTS,
            dashboard_server.ROUTE_PRINT_ARTIFACTS,
        )

        self.assertEqual(canonical_suffix, artifact_name)
        self.assertEqual(legacy_suffix, artifact_name)

    def test_route_manifest_contains_canonical_paths_and_legacy_aliases(self):
        manifest = dashboard_server.route_manifest_payload()
        routes = {route["name"]: route for route in manifest["routes"]}

        self.assertEqual(manifest["base_path"], "/api/v1")
        self.assertEqual(routes["status"]["path"], "/api/v1/status")
        self.assertEqual(routes["offline_health"]["path"], "/api/v1/offline-health")
        self.assertEqual(routes["runs"]["path"], "/api/v1/runs")
        self.assertIn("/status", routes["status"]["aliases"])
        self.assertIn("/offline-health", routes["offline_health"]["aliases"])
        self.assertIn("/run", routes["runs"]["aliases"])
        self.assertEqual(routes["dashboard"]["path"], "/")
        self.assertEqual(routes["offline_dashboard"]["path"], "/offline-ready.html")
        self.assertEqual(routes["attachment_download"]["path"], "/api/v1/attachments/{id}")
        self.assertIn("/attachments/{id}", routes["attachment_download"]["aliases"])
        self.assertIn("description", routes["status"])
        self.assertIn("group", routes["status"])
        self.assertIn("legacy_alias_policy", manifest)
        self.assertIn("fine_art_creation", manifest["run_contract"])
        self.assertIn("A0", manifest["upscale_target_formats"])
        self.assertIn("auto", manifest["upscale_orientation_values"])
        self.assertIn("preserve", manifest["upscale_aspect_mode_values"])
        self.assertIn("a_series", manifest["creation_size_families"])
        self.assertIn("A1", manifest["creation_a_series_sizes"])
        self.assertIn(100, manifest["creation_square_sizes_cm"])
        self.assertIn("portrait", manifest["creation_orientation_values"])
        self.assertIn("run_contract", manifest)
        self.assertIn("prepress", manifest["run_contract"])
        self.assertIn("creative_freedom", manifest["run_contract"]["fine_art_creation"]["optional"])
        self.assertIn("prompt_creator_command", manifest["run_contract"]["fine_art_creation"]["optional"])
        self.assertIn("creation_prompt_override", manifest["run_contract"]["fine_art_creation"]["optional"])

    def test_print_auditor_review_exposes_final_delivery_and_quality_flags(self):
        output_dir = self.temp_path / "upscale-output"
        output_dir.mkdir()
        final = output_dir / "museum_print.tiff"
        final.write_bytes(b"print delivery")
        (output_dir / "batch_status.json").write_text(
            json.dumps(
                {
                    "updated_utc": "2026-09-18T20:00:00+00:00",
                    "total": 1,
                    "done": 1,
                    "ok": 1,
                    "failed": 0,
                    "critical": 0,
                    "caveats": 1,
                    "images": [
                        {
                            "name": "source.png",
                            "status": "ok",
                            "final": final.name,
                            "print_size_cm": "150x100",
                            "ppi": 150,
                            "grade": "caveats",
                            "quality_flags": ["Review shadow detail before press."],
                            "error": None,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        with patch.dict(os.environ, {"UPSCALE_OUTPUT_DIR": str(output_dir)}):
            review = dashboard_server.get_print_review()
            warnings = dashboard_server.get_warnings({"status": "idle", "result": {}}, review)
            artifact = dashboard_server.print_artifact_path(final.name)

        self.assertTrue(review["available"])
        self.assertEqual(review["selected"]["final"], final.name)
        self.assertEqual(review["selected"]["ppi"], 150)
        self.assertEqual(review["selected"]["quality_flags"], ["Review shadow detail before press."])
        self.assertEqual(review["selected"]["final_url"], f"/api/v1/artifacts/print/{final.name}")
        self.assertEqual(artifact, final.resolve())
        self.assertTrue(any(warning["scope"] == "Print Quality Auditor" for warning in warnings))


if __name__ == "__main__":
    unittest.main()