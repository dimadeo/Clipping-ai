import argparse
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from midjourney import MidjourneyClient
from prompt_registry import PromptRegistry
from production_orchestrator import run_production_workflow


@dataclass
class ViralPromptCandidate:
    title: str
    prompt: str
    angle: str
    niche: str
    trigger: str
    score: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "prompt": self.prompt,
            "angle": self.angle,
            "niche": self.niche,
            "trigger": self.trigger,
            "score": self.score,
        }


@dataclass
class ViralMasterAgentConfig:
    niches: List[str] = field(default_factory=lambda: [
        "AI & Tech Breakthroughs",
        "Founder & Business Strategy",
        "Psychology & Human Behavior",
        "Personal Finance & Wealth",
        "Productivity & Leverage",
        "Creator Economy",
    ])
    triggers: List[str] = field(default_factory=lambda: [
        "FOMO",
        "Curiosity Gap",
        "Ego Validation",
        "High-Utility Outrage",
    ])
    target_duration_sec: int = 45
    target_platforms: List[str] = field(default_factory=lambda: ["TikTok", "Instagram Reels", "YouTube Shorts"])


class ViralMasterAgent:
    """Generates ranked, high-quality viral short-form video concepts and prompts."""

    def __init__(self, config: Optional[ViralMasterAgentConfig] = None):
        self.config = config or ViralMasterAgentConfig()

    def select_niche_and_trigger(self, niche: Optional[str] = None, trigger: Optional[str] = None) -> Dict[str, str]:
        selected_niche = niche or self.config.niches[0]
        selected_trigger = trigger or self.config.triggers[0]
        return {"niche": selected_niche, "trigger": selected_trigger}

    def build_script(self, niche: str, trigger: str, topic: Optional[str] = None, angle: Optional[str] = None) -> str:
        topic = topic or "modern leverage and high-output systems"
        angle = angle or "a surprising growth principle"

        return (
            f"Most people think {topic} is just about doing more. It’s not. "
            f"The real edge is understanding {angle}. Most people stay stuck because they keep treating the problem like a task instead of a system. "
            f"The fastest growth happens when you remove friction, increase clarity, and compound small wins. Here’s the three-part shift: first, simplify the process; "
            f"second, automate what repeats; third, focus energy on the highest-leverage move. That creates speed, confidence, and advantage. "
            f"If you’re still doing everything manually, you’re not failing because you’re lazy — you’re just paying the tax of slow execution."
        )

    def build_scene_map(self, niche: str, trigger: str, ct_a: str = "Follow for more") -> Dict[str, Dict[str, str]]:
        return {
            "hook": {
                "text": "The real leverage is not more effort — it’s better systems.",
                "visual": "Ultra-wide 24mm cinematic shot, fast push-in, premium workspace, dynamic light, modern desk, crisp realism, high contrast, subtle motion blur.",
                "sfx": "Deep bass whoosh, digital keyboard taps, fast synth rise",
            },
            "body": {
                "text": "Simplify the work. Automate the repeats. Focus on the high-leverage move.",
                "visual": "Rapid montage of workflow screens, automation steps, clean dashboard visuals, split-screen overlays, modern startup aesthetic, soft neon lighting.",
                "sfx": "Fast rhythmic synth pulse, UI swipes, subtle click transitions",
            },
            "outro": {
                "text": f"{ct_a}",
                "visual": "Direct-to-camera close-up, confident founder expression, cinematic lighting, premium minimal background, slow push-in, polished brand frame.",
                "sfx": "Soft rise, clean final chime",
            },
        }

    def build_prompt_batch(self, topic: str, audience: str, angle: str, cta: str = "Follow for more") -> List[str]:
        prompts = []
        for i in range(10):
            variant = (
                f"Create a 45-second viral short-form video in 9:16 vertical format for TikTok, Reels, and Shorts. "
                f"Topic: {topic}. Audience: {audience}. Angle: {angle}. Hook in the first 1–2 seconds with a bold stop-the-scroll statement. "
                f"Use high-retention pacing, cinematic premium visuals, bold captions, premium modern styling, and a clear payoff. "
                f"Include a strong CTA: {cta}. Keep it emotionally charged, highly shareable, and optimized for watch time."
            )
            prompts.append(variant)
        return prompts

    def generate_batch(self, topic: str, audience: str, angle: str, cta: str = "Follow for more", count: int = 10) -> List[ViralPromptCandidate]:
        candidates: List[ViralPromptCandidate] = []
        niche_patterns = [
            ("AI & Tech Breakthroughs", "FOMO"),
            ("Founder & Business Strategy", "Curiosity Gap"),
            ("Psychology & Human Behavior", "Ego Validation"),
            ("Personal Finance & Wealth", "High-Utility Outrage"),
            ("Creator Economy", "FOMO"),
        ]

        for index in range(min(count, len(niche_patterns))):
            niche, trigger = niche_patterns[index]
            title = f"{niche} - {trigger} - {index + 1}"
            prompt = (
                f"Create a 45-second viral short-form video in 9:16 vertical format for TikTok, Reels, and Shorts. "
                f"Topic: {topic}. Audience: {audience}. Angle: {angle}. Niche: {niche}. Trigger: {trigger}. "
                "Open with a bold stop-the-scroll hook in the first 1–2 seconds, show a fast premium visual story, "
                "deliver a surprising payoff, and end with a strong CTA. Maintain high-retention pacing, cinematic modern aesthetics, "
                "bold captions, and an emotionally charged, highly shareable style. CTA: {cta}."
            )
            score = 9.0 + (index * 0.2)
            candidates.append(ViralPromptCandidate(title=title, prompt=prompt, angle=angle, niche=niche, trigger=trigger, score=score))

        return sorted(candidates, key=lambda item: item.score, reverse=True)

    def render_best_prompt(self, prompt: str, *, duration_sec: int = 45, aspect_ratio: str = "9:16") -> Dict[str, Any]:
        client = MidjourneyClient()
        return client.generate(prompt=prompt, duration_sec=duration_sec, aspect_ratio=aspect_ratio)

    def release_prod_prompt(self, topic: str, audience: str, angle: str, cta: str = "Follow for more", count: int = 5) -> Dict[str, Any]:
        registry = PromptRegistry()
        ranked_batch = self.generate_batch(topic=topic, audience=audience, angle=angle, cta=cta, count=count)
        candidates: List[Dict[str, Any]] = []

        for item in ranked_batch:
            metadata = {"topic": topic, "audience": audience, "angle": angle, "cta": cta, "niche": item.niche, "trigger": item.trigger}
            score = registry.evaluate_prompt(item.prompt, metadata)
            entry = registry.register_prompt("viral_master_prod_prompt", item.prompt, metadata=metadata, score=score)
            candidates.append({**item.to_dict(), "registry_score": score, "registry_version": entry["version"]})

        winner = max(candidates, key=lambda item: item["registry_score"])
        promoted = registry.promote_to_prod("viral_master_prod_prompt", version=winner["registry_version"])

        return {
            "prod_prompt": promoted["prompt"],
            "prod_version": promoted["version"],
            "prod_score": promoted["score"],
            "ranked_batch": candidates,
            "winner": winner,
        }

    def generate_one(self, topic: str, audience: str, angle: str, cta: str = "Follow for more") -> Dict[str, Any]:
        niche_meta = self.select_niche_and_trigger()
        script = self.build_script(niche_meta["niche"], niche_meta["trigger"], topic=topic, angle=angle)
        scene_map = self.build_scene_map(niche_meta["niche"], niche_meta["trigger"], ct_a=cta)
        prompt_batch = self.build_prompt_batch(topic, audience, angle, cta)
        ranked_batch = self.generate_batch(topic, audience, angle, cta, count=5)
        best_ranked_prompt = ranked_batch[0].prompt if ranked_batch else prompt_batch[0]

        return {
            "niche": niche_meta["niche"],
            "trigger": niche_meta["trigger"],
            "topic": topic,
            "audience": audience,
            "angle": angle,
            "script": script,
            "scene_map": scene_map,
            "prompt_batch": prompt_batch,
            "best_prompt": best_ranked_prompt,
            "ranked_batch": [item.to_dict() for item in ranked_batch],
        }

    def optimize_batch_recursively(
        self,
        topic: str,
        audience: str,
        angle: str,
        cta: str = "Follow for more",
        count: int = 5,
        render: bool = False,
        iteration: int = 0,
        max_iterations: Optional[int] = None,
    ) -> Dict[str, Any]:
        result = self.generate_one(topic=topic, audience=audience, angle=angle, cta=cta)
        ranked_batch = self.generate_batch(topic=topic, audience=audience, angle=angle, cta=cta, count=count)
        result["ranked_batch"] = [item.to_dict() for item in ranked_batch]
        result["best_prompt"] = ranked_batch[0].prompt if ranked_batch else result["best_prompt"]
        result["iteration"] = iteration

        release = self.release_prod_prompt(topic=topic, audience=audience, angle=angle, cta=cta, count=count)
        result["prod_prompt"] = release["prod_prompt"]
        result["prod_version"] = release["prod_version"]
        result["prod_score"] = release["prod_score"]
        result["best_prompt"] = release["prod_prompt"]

        if render:
            try:
                result["render_job"] = self.render_best_prompt(result["best_prompt"])
            except Exception as exc:
                result["render_error"] = {"type": type(exc).__name__, "message": str(exc)}

        print(json.dumps({
            "iteration": iteration,
            "best_prompt": result["best_prompt"],
            "top_score": result["ranked_batch"][0]["score"] if result["ranked_batch"] else 0.0,
        }, indent=2))

        if max_iterations is not None and iteration >= max_iterations:
            return result

        improved_angle = f"{angle} with stronger stop-the-scroll tension and a sharper emotional payoff"
        return self.optimize_batch_recursively(
            topic=topic,
            audience=audience,
            angle=improved_angle,
            cta=cta,
            count=count,
            render=render,
            iteration=iteration + 1,
            max_iterations=max_iterations,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Viral Master Prompt Engineer Creator")
    parser.add_argument("--topic", default="AI for founders", help="Main topic")
    parser.add_argument("--audience", default="startup founders", help="Audience")
    parser.add_argument("--angle", default="counterintuitive business leverage", help="Core angle")
    parser.add_argument("--cta", default="Follow for more", help="CTA")
    parser.add_argument("--count", type=int, default=5, help="Number of ranked batch prompts to generate")
    parser.add_argument("--render", action="store_true", help="Auto-submit the best prompt to the configured BFL renderer endpoint")
    parser.add_argument("--loop", action="store_true", help="Continuously re-rank and optimize the batch in a recursive loop")
    parser.add_argument("--max-iterations", type=int, default=None, help="Optional cap for recursive optimization loops; omit to loop until interrupted")
    parser.add_argument("--production", action="store_true", help="Evaluate candidates, promote the best to prod, and render the production prompt")
    args = parser.parse_args()

    agent = ViralMasterAgent()

    if args.loop:
        result = agent.optimize_batch_recursively(
            topic=args.topic,
            audience=args.audience,
            angle=args.angle,
            cta=args.cta,
            count=args.count,
            render=args.render or args.production,
            iteration=0,
            max_iterations=args.max_iterations,
        )
        print(json.dumps({"status": "recursive_loop_complete", "result": result}, indent=2))
        return

    if args.production:
        result = run_production_workflow(
            topic=args.topic,
            audience=args.audience,
            angle=args.angle,
            cta=args.cta,
            count=args.count,
            render=args.render,
            require_approval=False,
        )
        print(json.dumps(dict(result), indent=2))
        return

    result = agent.generate_one(topic=args.topic, audience=args.audience, angle=args.angle, cta=args.cta)
    result["ranked_batch"] = [item.to_dict() for item in agent.generate_batch(args.topic, args.audience, args.angle, args.cta, count=args.count)]

    if args.render:
        try:
            result["best_prompt"] = result["ranked_batch"][0]["prompt"] if result.get("ranked_batch") else result["best_prompt"]
            result["render_job"] = agent.render_best_prompt(result["best_prompt"])
        except Exception as exc:
            result["render_error"] = {"type": type(exc).__name__, "message": str(exc)}

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
