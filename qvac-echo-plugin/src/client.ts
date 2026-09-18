import { invokePlugin, invokePluginStream } from "@qvac/sdk";

export async function echo(options: { modelId: string; message: string }) {
  return invokePlugin<{ echoed: string; timestamp: number }>({
    modelId: options.modelId,
    handler: "echo",
    params: options,
  });
}

export async function* echoStream(options: { modelId: string; message: string }) {
  for await (const chunk of invokePluginStream<{ char: string | null; done: boolean }>({
    modelId: options.modelId,
    handler: "echoStream",
    params: options,
  })) {
    if (!chunk.done && chunk.char) {
      yield chunk.char;
    }
  }
}
