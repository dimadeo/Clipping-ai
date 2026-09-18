import { completion, loadModel, unloadModel, LLAMA_3_2_1B_INST_Q4_0 } from '@qvac/sdk';

const prompt = process.argv.slice(2).join(' ').trim() ||
  'Explain why on-device AI is useful in 2 short sentences.';

async function main() {
  console.log('Starting QVAC local model demo...');

  let modelId;
  try {
    modelId = await loadModel({
      modelSrc: LLAMA_3_2_1B_INST_Q4_0,
      onProgress: (p) => {
        const pct = Math.round(p.percentage || 0);
        const dl = (p.downloaded ?? 0) / (1024 * 1024);
        const total = (p.total ?? 0) / (1024 * 1024);
        process.stderr.write(`\rLoading model: ${pct}% (${dl.toFixed(1)} / ${total.toFixed(1)} MB)`);
        if (pct >= 100) process.stderr.write('\n');
      },
    });

    console.log(`Model loaded locally: ${modelId}`);
    console.log(`\nPrompt: ${prompt}\n\nResponse:\n`);

    const result = completion({
      modelId,
      history: [{ role: 'user', content: prompt }],
      stream: true,
    });

    let fullText = '';
    for await (const event of result.events) {
      if (event.type === 'contentDelta') {
        process.stdout.write(event.text);
        fullText += event.text;
      }
    }

    const final = await result.final;
    console.log(`\n\n${final.contentText || fullText}`);
  } finally {
    if (modelId) await unloadModel({ modelId, clearStorage: false });
  }
}

main().catch((error) => {
  console.error('QVAC app failed:', error);
  process.exit(1);
});
