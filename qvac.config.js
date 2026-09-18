module.exports = {
  plugins: [
    "@qvac/sdk/llamacpp-completion/plugin",
    "@qvac/sdk/ggml-ocr/plugin",
    "qvac-echo-plugin/plugin",
  ],
  loggerConsoleOutput: true,
  loggerLevel: "info",
  swarmRelays: ["<hyperbee_key_1>", "<hyperbee_key_2>"],
  cacheDirectory: "</absolute/path/to/.qvac/models>",
  httpDownloadConcurrency: 3,
  httpConnectionTimeoutMs: 10000,
  requireHttpChecksum: false,
  requireSecureTransport: false,
  registryDownloadMaxRetries: 3,
  registryStreamTimeoutMs: 60000,
  rpcInitTimeoutMs: 30000,
  deviceDefaults: [
    {
      name: "Samsung Galaxy force CPU",
      match: { platform: "android", deviceBrand: "samsung" },
      defaults: { llm: { device: "cpu" } },
    },
  ],
  bareRuntimeVersion: "<x.y.z>",
  serve: {
    cors: {
      origins: ["https://app.example.com"],
    },
    models: {
      "<model_alias>": {
        model: "<SDK_MODEL_CONSTANT>",
        default: true,
        preload: true,
        config: {},
      },
    },
  },
};
