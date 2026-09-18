import asyncio
import os
from pathlib import Path

from tetherto.qvac_sdk import Client, completion, load_model
from tetherto.qvac_sdk.models import QWEN3_600M_INST_Q4


def resolve_sdk_dir() -> str:
    env_value = os.environ.get("QVAC_SDK_DIR")
    if env_value:
        return env_value

    candidates = [
        Path.home() / "AppData" / "Local" / "hermes" / "node" / "node_modules" / "@qvac" / "sdk",
        Path("C:/Users/andre/AppData/Local/hermes/node/node_modules/@qvac/sdk"),
        Path("/usr/local/lib/node_modules/@qvac/sdk"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    raise RuntimeError(
        "QVAC SDK not found. Install it with: npm install -g @qvac/sdk@0.19.1"
    )


async def main() -> None:
    prompt = (
        "You are a helpful local assistant. "
        "Give a short answer in exactly 2 sentences explaining why on-device AI is useful."
    )

    sdk_dir = resolve_sdk_dir()
    print("Starting QVAC on-device demo...")
    print(f"Using QVAC SDK directory: {sdk_dir}")

    async with Client(sdk_dir=sdk_dir) as client:
        print("Loading model...")
        model_id = await load_model(client.transport, model_src=QWEN3_600M_INST_Q4)
        print(f"Model loaded: {model_id}")

        run = completion(
            client.transport,
            model_id=model_id,
            history=[{"role": "user", "content": prompt}],
            stream=False,
        )
        final = await run.final
        answer = (final.content_text or "").strip()
        print("\nQVAC response:\n")
        print(answer)


if __name__ == "__main__":
    asyncio.run(main())
