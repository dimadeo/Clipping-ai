// The SDK's quickstart, adapted for Bare with @qvac/inference.
import process from 'bare-process';
import { plugins, LLAMA_3_2_1B_INST_Q4_0 } from '@qvac/inference';
import { llmPlugin } from '@qvac/inference/llamacpp-completion/plugin';

const { loadModel, completion, unloadModel } = plugins([llmPlugin]);

const modelId = await loadModel({
  modelSrc: LLAMA_3_2_1B_INST_Q4_0,
  modelConfig: { device: 'cpu', gpu_layers: 0, ctx_size: 256 },
});

const history = [{ role: 'user', content: 'Explain quantum computing in one sentence' }];
const result = completion({ modelId, history, stream: true });
for await (const token of result.tokenStream) {
  process.stdout.write(token);
}

await unloadModel({ modelId, autoClose: true });
