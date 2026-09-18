import assert from "node:assert/strict";
import { echoPlugin } from "../src/plugin/index.js";

const echoHandler = echoPlugin.handlers.echo;
const echoStreamHandler = echoPlugin.handlers.echoStream;

async function main() {
  const request = { message: "hello" };
  assert.deepEqual(echoHandler.requestSchema.parse(request), request);
  assert.deepEqual(echoHandler.requestSchema.safeParse({ message: 42 }).success, false);

  const echoResult = await echoHandler.handler(request);
  assert.deepEqual(echoResult.echoed, "Echo: hello");
  assert.equal(typeof echoResult.timestamp, "number");

  const streamChunks = [];
  for await (const chunk of echoStreamHandler.handler(request)) {
    streamChunks.push(chunk);
  }

  assert.deepEqual(streamChunks, [
    ..."Echo: hello".split("").map((char) => ({ char, done: false })),
    { char: null, done: true },
  ]);

  console.log("qvac-echo-plugin tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
