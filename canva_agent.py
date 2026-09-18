import argparse
import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from canva import CanvaClient


@dataclass
class CanvaAgentConfig:
    access_token: Optional[str] = None
    base_url: Optional[str] = None
    template_id: Optional[str] = None
    campaign_name: str = "DefaultCampaign"
    default_platform: str = "Instagram Reels"
    default_brand_colors: List[str] = field(default_factory=lambda: ["#FF6B6B", "#FFD93D", "#6C63FF"])

    def __post_init__(self):
        if not self.access_token:
            self.access_token = os.getenv("CANVA_ACCESS_TOKEN")
        if not self.base_url:
            self.base_url = os.getenv("CANVA_BASE_URL", "https://api.canva.com/rest/v1")
        if not self.template_id:
            self.template_id = os.getenv("CANVA_TEMPLATE_ID")


class CanvaAgent:
    """Exclusive Canva design agent for social media content creation."""

    def __init__(self, config: Optional[CanvaAgentConfig] = None):
        self.config = config or CanvaAgentConfig()
        self.client = CanvaClient(
            access_token=self.config.access_token,
            base_url=self.config.base_url,
        )

    def build_design_payload(
        self,
        title: str,
        hook: str,
        campaign_name: Optional[str] = None,
        platform: Optional[str] = None,
        cta: str = "Follow for more",
        accent_colors: Optional[List[str]] = None,
        extra_fields: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        payload = {
            "title": title or "Viral clip design",
            "hook": hook or "The growth strategy everyone is missing",
            "campaign_name": campaign_name or self.config.campaign_name,
            "platform": platform or self.config.default_platform,
            "cta": cta,
            "brand_colors": accent_colors or self.config.default_brand_colors,
            "template_id": self.config.template_id,
        }
        if extra_fields:
            payload.update(extra_fields)
        return payload

    def create_social_card(
        self,
        title: str,
        hook: str,
        campaign_name: Optional[str] = None,
        platform: Optional[str] = None,
        cta: str = "Follow for more",
        accent_colors: Optional[List[str]] = None,
        extra_fields: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not self.config.template_id:
            return {
                "status": "skipped",
                "reason": "CANVA_TEMPLATE_ID is not configured.",
                "payload": self.build_design_payload(
                    title=title,
                    hook=hook,
                    campaign_name=campaign_name,
                    platform=platform,
                    cta=cta,
                    accent_colors=accent_colors,
                    extra_fields=extra_fields,
                ),
            }

        design = self.client.create_design(
            template_id=self.config.template_id,
            title=title or "Viral clip design",
            page_count=1,
            elements=[
                {"type": "text", "text": hook or "Viral moment"},
                {"type": "text", "text": cta},
                {"type": "text", "text": campaign_name or self.config.campaign_name},
            ],
            brand_colors=accent_colors or self.config.default_brand_colors,
            platform=platform or self.config.default_platform,
            **(extra_fields or {}),
        )
        return {"status": "created", "design": design}

    def create_from_clip(self, clip_title: str, transcript_excerpt: str, campaign_name: Optional[str] = None) -> Dict[str, Any]:
        title = clip_title.strip() or "Viral short"
        hook = (transcript_excerpt or title)[:120]
        return self.create_social_card(
            title=title,
            hook=hook,
            campaign_name=campaign_name or self.config.campaign_name,
            platform=self.config.default_platform,
            cta="Follow for more",
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Exclusive Canva design agent for video social assets")
    parser.add_argument("--title", default="Viral Clip Design", help="Design title")
    parser.add_argument("--hook", default="The biggest growth mistake creators make", help="Primary text hook")
    parser.add_argument("--campaign", default="DefaultCampaign", help="Campaign name")
    parser.add_argument("--platform", default="Instagram Reels", help="Platform target")
    parser.add_argument("--template-id", default=None, help="Canva template id")
    parser.add_argument("--cta", default="Follow for more", help="Call to action")
    args = parser.parse_args()

    config = CanvaAgentConfig(
        campaign_name=args.campaign,
        template_id=args.template_id,
        default_platform=args.platform,
    )
    agent = CanvaAgent(config=config)
    result = agent.create_social_card(
        title=args.title,
        hook=args.hook,
        campaign_name=args.campaign,
        platform=args.platform,
        cta=args.cta,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
