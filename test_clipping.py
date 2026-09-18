import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from midjourney import MidjourneyClient
from prompt_registry import PromptRegistry
from viral_master_prompt_engineer import ViralMasterPromptEngineerCreator
from clipping import (
    AUTONOMOUS_VIDEO_LOCALIZATION_WORKFLOW,
    CampaignConfig,
    ClipMetaData,
    ClipSegmenter,
    DubbingGenerator,
    DEFAULT_EXTRACTION_PROMPT,
    PLATFORM_LENGTHS,
    SYSTEM_PROMPT,
    VIRAL_CLIP_AGENT_COMMAND,
    VerticalFFmpegProcessor,
    VideoDownloader,
)


class ClippingFeatureTests(unittest.TestCase):
    def test_default_clips_use_the_growth_strategy(self):
        segmenter = ClipSegmenter()
        clips = segmenter.analyze_and_extract_hooks(video_path=None)

        self.assertGreater(len(clips), 0)
        self.assertIn("Target Duration", DEFAULT_EXTRACTION_PROMPT)
        self.assertIn("FREE TIER ONLY", AUTONOMOUS_VIDEO_LOCALIZATION_WORKFLOW)
        self.assertIn("FREE TIER ONLY", SYSTEM_PROMPT)
        self.assertIn("Virality Score", VIRAL_CLIP_AGENT_COMMAND)
        self.assertIn("Transcript Excerpt", VIRAL_CLIP_AGENT_COMMAND)
        self.assertTrue(all(20 <= clip.duration <= 50 for clip in clips))
        self.assertTrue(all(clip.viral_score >= 80 for clip in clips))

    def test_caption_filter_falls_back_to_disabled_overlay(self):
        processor = VerticalFFmpegProcessor()
        filter_text = processor._build_caption_filter("Stop overthinking your content")

        self.assertEqual(filter_text, "")

    def test_color_filter_increases_saturation_for_vibrant_output(self):
        processor = VerticalFFmpegProcessor()
        filter_text = processor._build_color_filter()

        self.assertIn("saturation=1.8", filter_text)
        self.assertIn("contrast=1.2", filter_text)

    def test_dubbing_generator_creates_audio_for_each_language(self):
        clip = ClipMetaData(
            clip_id="clip_010",
            start_sec=2.0,
            duration=6.0,
            hook_title="This is the best product for creators",
            viral_score=90,
            transcript="This is the best product for creators. It makes your brand pop.",
            campaign_name="BrightCampaign"
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            files = DubbingGenerator.build_for_languages(clip, ["en", "es"], Path(temp_dir))

            self.assertEqual(len(files), 2)
            self.assertTrue(all(path.exists() and path.stat().st_size > 0 for path in files))

    def test_campaign_config_keeps_valid_platform_length_rules(self):
        config = CampaignConfig(target_platforms=["TikTok", "YouTube Shorts", "Unknown"])

        self.assertEqual(config.target_platforms, ["TikTok", "YouTube Shorts"])
        self.assertEqual(PLATFORM_LENGTHS["TikTok"]["recommended_max_sec"], 45)

    def test_youtube_channel_id_url_is_normalized(self):
        normalized = VideoDownloader._normalize_youtube_url(
            "https://www.youtube.com/@UCIzdh7oty8jCnXUj3eUj2WQ"
        )

        self.assertEqual(
            normalized,
            "https://www.youtube.com/channel/UCIzdh7oty8jCnXUj3eUj2WQ/videos",
        )

    def test_local_file_source_is_used_directly(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "source.mp4"
            source.write_bytes(b"local video placeholder")

            self.assertEqual(VideoDownloader._normalize_youtube_url(str(source)), str(source))

    def test_viral_prompt_engineer_creates_high_retention_prompt(self):
        agent = ViralMasterPromptEngineerCreator()
        prompt = agent.build_prompt(
            topic="AI for founders",
            audience="startup founders",
            angle="counterintuitive business leverage",
            CTA="Follow for more",
            brand_style="luxury startup",
            duration_sec=30,
        )

        self.assertIn("AI for founders", prompt)
        self.assertIn("counterintuitive business leverage", prompt)
        self.assertIn("Follow for more", prompt)
        self.assertIn("9:16", prompt)

    @patch("midjourney.request.urlopen")
    def test_midjourney_client_creates_render_job(self, mock_urlopen):
        mock_urlopen.return_value.__enter__.return_value.read.return_value = (
            b'{"id": "job_123", "status": "queued", "output_url": "https://example.com/render"}'
        )

        client = MidjourneyClient(api_key="test-token", endpoint="https://example.com/render")
        result = client.generate(prompt="viral entrepreneur short")

        self.assertEqual(result["id"], "job_123")
        request = mock_urlopen.call_args.args[0]
        self.assertIn(b'"prompt": "viral entrepreneur short"', request.data)

    @patch("midjourney.request.urlopen")
    def test_bfl_client_uses_x_key_header_and_polling_url(self, mock_urlopen):
        mock_urlopen.return_value.__enter__.return_value.read.side_effect = [
            b'{"polling_url": "https://example.com/poll/abc123", "status": "Pending"}',
            b'{"status": "Ready", "result": {"sample": "https://example.com/video.mp4"}}',
        ]

        client = MidjourneyClient(api_key="bfl_test_key", endpoint="https://api.bfl.ai/v1/flux-3-video")
        result = client.generate(prompt="Cinematic shot of a futuristic city at sunset", mode="t2v", aspect_ratio="16:9", generate_audio=True)
        self.assertEqual(result["status"], "Pending")
        self.assertEqual(result["polling_url"], "https://example.com/poll/abc123")

        ready = client.poll(result["polling_url"])
        self.assertEqual(ready["status"], "Ready")
        self.assertEqual(ready["result"]["sample"], "https://example.com/video.mp4")

        submit_request = mock_urlopen.call_args_list[0].args[0]
        key_header = next((k for k in submit_request.headers if k.lower() == "x-key"), None)
        self.assertIsNotNone(key_header)
        self.assertEqual(submit_request.headers[key_header], "bfl_test_key")
        self.assertNotIn("Authorization", {k.lower(): v for k, v in submit_request.headers.items()})

    def test_prompt_registry_promotes_best_prompt_to_prod(self):
        registry = PromptRegistry(path="tmp_prompt_registry.json")
        registry.clear()
        prompt = "Create a 45-second viral short-form video for startup founders with a baited hook and strong CTA."
        score = registry.evaluate_prompt(prompt, {"topic": "AI for founders", "audience": "startup founders", "angle": "counterintuitive business leverage"})
        registered = registry.register_prompt("viral_short_prompt", prompt, {"topic": "AI for founders"}, score=score)
        promoted = registry.promote_to_prod("viral_short_prompt", version=registered["version"])

        self.assertGreater(score, 0)
        self.assertEqual(promoted["status"], "prod")
        self.assertEqual(registry.get_prod("viral_short_prompt")["version"], promoted["version"])
        registry.clear()


if __name__ == "__main__":
    unittest.main()
