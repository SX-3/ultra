/* eslint-disable antfu/no-top-level-await */
import { $, sleep } from 'bun';
import { Ultra } from '../src/ultra';

async function waitForOK(url: string, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    }
    catch {}
    await sleep(50);
  }
  throw new Error(`Server did not become ready in ${timeoutMs}ms: ${url}`);
}

const app = new Ultra().routes(input => ({
  hello: input().http().handler(() => 'Hello, World!'),
  object: input().http().handler(() => ({ message: 'Hello, World!' })),
}));

app.start();

const url = 'http://127.0.0.1:3000/object';
await waitForOK(url);

// Measure
await $`oha -c 50 -z 10s --wait-ongoing-requests-after-deadline --no-tui --disable-color ${url}`;

await app.stop();
