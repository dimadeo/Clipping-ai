import json
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class CanvaDesignBrief:
    clip_title: str
    campaign_name: str = "DefaultCampaign"
    platform: str = "Instagram Reels"
    hook: str = ""
    CTA: str = "Follow for more"
    aspect_ratio: str = "9:16"
    duration_sec: int = 45
    color_palette: List[str] = field(default_factory=lambda: ["#0F172A", "#8B5CF6", "#22D3EE", "#F8FAFC"])
    effects: List[str] = field(default_factory=lambda: [
        "Digital Aura / Spotlight Spin",
        "Aisle Glide / Smooth Zoom",
        "Sky Bubble / Magic Morph",
    ])
    visual_style: str = "premium cinematic neon creator brand"
    text_overlays: List[str] = field(default_factory=lambda: [
        "Hook line",
        "Key insight",
        "CTA"
    ])
    animation_notes: str = "Fast opening, smooth motion, dramatic reveal in final 5 seconds"
    output_format: str = "TikTok/Reels/Shorts optimized"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)


class CanvaDesignBriefBuilder:
    """Builds Canva-ready design briefs from generated clip metadata."""

    @staticmethod
    def from_clip_meta(
        clip_title: str,
        campaign_name: str,
        hook: str,
        platform: str = "Instagram Reels",
        duration_sec: int = 45,
        cta: str = "Follow for more",
        accent_colors: Optional[List[str]] = None,
    ) -> CanvaDesignBrief:
        return CanvaDesignBrief(
            clip_title=clip_title,
            campaign_name=campaign_name,
            platform=platform,
            hook=hook or clip_title,
            CTA=cta,
            duration_sec=duration_sec,
            color_palette=accent_colors or ["#0F172A", "#8B5CF6", "#22D3EE", "#F8FAFC"],
        )

    @staticmethod
    def build_prompt(brief: CanvaDesignBrief) -> str:
        return (
            f"Create a {brief.duration_sec}-second vertical social video for {brief.platform} in a {brief.visual_style} style. "
            f"Use the hook: '{brief.hook}'. Start with {brief.effects[0]} for the first 2 seconds, then use {brief.effects[1]} for the middle, "
            f"and finish with {brief.effects[2]} in the final reveal. Use this palette: {', '.join(brief.color_palette)}. "
            f"Include text overlays for: {', '.join(brief.text_overlays)}. Add a strong CTA: '{brief.CTA}'. "
            f"Keep it optimized for {brief.output_format}."
        )


if __name__ == "__main__":
    brief = CanvaDesignBriefBuilder.from_clip_meta(
        clip_title="The CTA everyone ignores",
        campaign_name="CreatorGrowth",
        hook="This is why your content is getting ignored.",
        platform="Instagram Reels",
        duration_sec=45,
    )
    print(brief.to_json())
    print("\n--- Prompt ---\n")
    print(CanvaDesignBriefBuilder.build_prompt(brief))
