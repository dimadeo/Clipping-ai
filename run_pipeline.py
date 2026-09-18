import json
import requests

# Cleaned payload with all 3 aesthetic variations mapped into the prompt batch
payload = {
    "status": "success",
    "result": {
        "niche": "AI & Tech Breakthroughs",
        "trigger": "FOMO",
        "topic": "AI for founders",
        "audience": "startup founders",
        "angle": "counterintuitive business leverage with high stop-the-scroll tension and a sharp emotional payoff",
        "script": "Most people think AI for founders is just about doing more. It’s not. The real edge is understanding counterintuitive business leverage. Most people stay stuck because they keep treating the problem like a task instead of a system. The fastest growth happens when you remove friction, increase clarity, and compound small wins. Here’s the three-part shift: first, simplify the process; second, automate what repeats; third, focus energy on the highest-leverage move. That creates speed, confidence, and advantage. If you’re still doing everything manually, you’re not failing because you’re lazy — you’re just paying the tax of slow execution. Follow for more.",
        "scene_map": {
            "hook": {
                "text": "The real leverage is not more effort — it’s better systems.",
                "visual": "Ultra-wide 24mm cinematic shot, fast push-in, premium workspace, dynamic light, modern desk, crisp realism, high contrast, subtle motion blur.",
                "sfx": "Deep bass whoosh, digital keyboard taps, fast synth rise"
            },
            "body": {
                "text": "Simplify the work. Automate the repeats. Focus on the high-leverage move.",
                "visual": "Rapid montage of workflow screens, automation steps, clean dashboard visuals, split-screen overlays, modern startup aesthetic, soft neon lighting.",
                "sfx": "Fast rhythmic synth pulse, UI swipes, subtle click transitions"
            },
            "outro": {
                "text": "Follow for more",
                "visual": "Direct-to-camera close-up, confident founder expression, cinematic lighting, premium minimal background, slow push-in, polished brand frame.",
                "sfx": "Soft rise, clean final chime"
            }
        },
        "prompt_batch": [
            "Create a 45-second viral short-form video in 9:16 vertical format for TikTok, Reels, and Shorts. Topic: AI for founders. Style: Sleek dark-mode productivity aesthetic. Moody charcoal backdrops, stark white bold typography overlays, high-contrast matrix-like accent lighting. Intense macro-shot cutaways of sleek tech setups and smooth software dashboard transitions. Keep watch-time retention pacing aggressive with hard visual cuts matching crisp sound design.",
            "Create a 45-second viral short-form video in 9:16 vertical format for TikTok, Reels, and Shorts. Topic: AI for founders. Style: Raw 35mm film aesthetic, subtle grain, cinematic natural lighting, look and feel of an raw behind-the-scenes documentary. Bold minimal captions. Visuals follow the fast, unpolished reality of a founder problem-solving in a late-night workspace. High psychological tension, grounded and authentic delivery.",
            "Create a 45-second viral short-form video in 9:16 vertical format for TikTok, Reels, and Shorts. Topic: AI for founders. Style: Clean, hyper-minimalist premium studio style. Balanced pastel and neutral background colorways, elegant clean typography tracking, soft diffusion studio lighting. Silky smooth parallax motion effects over minimalist app automation architectures. Elegant, high-status presentation aimed at high-tier executives."
        ]
    }
}

def execute_pipeline(api_url=None):
    try:
        json_payload = json.dumps(payload, indent=2)
        print("✅ Local validation passed: JSON structure is perfectly clean.")
        
        if api_url:
            print(f"📡 Forwarding expanded batch data to: {api_url}...")
            headers = {"Content-Type": "application/json"}
            response = requests.post(api_url, data=json_payload, headers=headers, timeout=10)
            
            if response.status_code == 200:
                print("🚀 API dispatch successful! Multi-prompt batch accepted.")
                return response.json()
            else:
                print(f"❌ Target server returned error status code: {response.status_code}")
        else:
            print("💡 Local simulation mode active. Add an endpoint URL to test live webhooks.")
            
    except Exception as e:
        print(f"❌ Error executing pipeline script: {e}")

if __name__ == "__main__":
    # Replace None with your true generation API URL string if sending this data outward
    execute_pipeline(api_url=None)
