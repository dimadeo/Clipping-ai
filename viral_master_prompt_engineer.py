import argparse
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ViralMasterPromptEngineerConfig:
    default_target_platform: str = "TikTok"
    default_duration_sec: int = 30
    default_cta: str = "Follow for more"
    default_brand_style: str = "luxury startup"
    default_audience: str = "founders and creators"
    default_angle: str = "counterintuitive business leverage"


class ViralMasterPromptEngineerCreator:
    """Builds high-retention viral generation prompts for short-form social videos."""

    def __init__(self, config: Optional[ViralMasterPromptEngineerConfig] = None):
        self.config = config or ViralMasterPromptEngineerConfig()

    def build_prompt(
        self,
        topic: str,
        audience: Optional[str] = None,
        angle: Optional[str] = None,
        CTA: Optional[str] = None,
        brand_style: Optional[str] = None,
        duration_sec: Optional[int] = None,
        target_platform: Optional[str] = None,
    ) -> str:
        topic = (topic or "viral business growth").strip()
        audience = (audience or self.config.default_audience).strip()
        angle = (angle or self.config.default_angle).strip()
        cta = (CTA or self.config.default_cta).strip()
        brand_style = (brand_style or self.config.default_brand_style).strip()
        duration_sec = int(duration_sec or self.config.default_duration_sec)
        target_platform = (target_platform or self.config.default_target_platform).strip()

        return (
            f"Create a {duration_sec}-second viral short-form video for {target_platform}, "
            f"targeting {audience}. Topic: {topic}. Angle: {angle}. "
            f"Use a premium {brand_style} visual style, 9:16 vertical framing, instant stop-the-scroll hook in the first 1–2 seconds, "
            "fast cuts, bold captions, dramatic tension, and a strong payoff before the final beat. "
            "Keep the pacing high-retention, emotionally charged, and platform-native for TikTok, Reels, and Shorts. "
            f"Include a clear CTA: {cta}. Output a polished, shareable, rewatchable viral social ad."
        )

    def build_payload(self, **kwargs: Any) -> Dict[str, Any]:
        prompt = self.build_prompt(**kwargs)
        return {
            "prompt": prompt,
            "media_type": "video",
            "aspect_ratio": "9:16",
            "duration_sec": kwargs.get("duration_sec") or self.config.default_duration_sec,
            "cta": kwargs.get("CTA") or self.config.default_cta,
            "topic": kwargs.get("topic") or "viral business growth",
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Viral Master Prompt Engineer Creator")
    parser.add_argument("--topic", default="AI for founders", help="Primary topic")
    parser.add_argument("--audience", default="startup founders", help="Target audience")
    parser.add_argument("--angle", default="counterintuitive business leverage", help="Core angle")
    parser.add_argument("--cta", default="Follow for more", help="CTA text")
    parser.add_argument("--brand-style", default="luxury startup", help="Visual style")
    parser.add_argument("--duration", type=int, default=30, help="Video duration in seconds")
    parser.add_argument("--platform", default="TikTok", help="Target platform")
    args = parser.parse_args()

    agent = ViralMasterPromptEngineerCreator()
    prompt = agent.build_prompt(
        topic=args.topic,
        audience=args.audience,
        angle=args.angle,
        CTA=args.cta,
        brand_style=args.brand_style,
        duration_sec=args.duration,
        target_platform=args.platform,
    )
    print(json.dumps({"prompt": prompt}, indent=2))


if __name__ == "__main__":
    main()
