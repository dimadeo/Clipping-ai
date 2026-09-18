import { z } from "zod";
import { defineHandler, definePlugin } from "@qvac/sdk/plugin-utils";
import type { CreateModelParams, PluginModelResult } from "@qvac/sdk";

export const echoPlugin = definePlugin({
  modelType: "echo",
  displayName: "Echo Plugin",
  addonPackage: "none",
  loadConfigSchema: z.object({}).catchall(z.unknown()),

  createModel: (params: CreateModelParams): PluginModelResult => {
    const model = {
      id: params.modelId,
      load: async () => {},
    };
    return { model };
  },

  handlers: {
    echo: defineHandler({
      requestSchema: z.object({ message: z.string() }),
      responseSchema: z.object({ echoed: z.string(), timestamp: z.number() }),
      streaming: false,
      handler: async (request) => ({
        echoed: `Echo: ${request.message}`,
        timestamp: Date.now(),
      }),
    }),
    echoStream: defineHandler({
      requestSchema: z.object({ message: z.string() }),
      responseSchema: z.object({ char: z.string().nullable(), done: z.boolean() }),
      streaming: true,
      handler: async function* (request) {
        for (const char of `Echo: ${request.message}`) {
          yield { char, done: false };
        }
        yield { char: null, done: true };
      },
    }),
  },
});
