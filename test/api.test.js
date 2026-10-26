const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../index.js');

let server;
let baseUrl;
const logs = [];
const originalLog = console.log;

before(async () => {
    console.log = (...args) => {
        logs.push(args.map(String).join(' '));
        originalLog(...args);
    };
    const app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    console.log = originalLog;
    await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
    });
});

async function json(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, options);
    const body = await res.json();
    return { res, body };
}

test('POST /chat/completions returns a mock completion', async () => {
    const { res, body } = await json('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'hi', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(body.object, 'chat.completion');
    assert.equal(body.choices[0].message.content, '这是一个模拟的回复');
    assert.match(body.id, /^chatcmpl-/);
});

test('POST /v1/chat/completions returns a mock completion', async () => {
    const { res, body } = await json('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'hi', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(body.model, 'hi');
    assert.equal(body.choices[0].finish_reason, 'stop');
});

test('POST /v1/chat/completions streams SSE with a fixed id and [DONE]', async () => {
    const started = Date.now();
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'hi',
            stream: true,
            messages: [{ role: 'user', content: 'hi' }],
        }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let firstChunkAt = 0;
    let text = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!firstChunkAt) firstChunkAt = Date.now();
        text += decoder.decode(value, { stream: true });
    }

    const timeToFirstByte = firstChunkAt - started;
    assert.ok(timeToFirstByte < 150, `expected prompt SSE start, TTFB was ${timeToFirstByte}ms`);
    assert.match(text, /data: \[DONE\]\s*$/);

    const payloads = [...text.matchAll(/^data: (.+)$/gm)]
        .map((match) => match[1])
        .filter((line) => line !== '[DONE]')
        .map((line) => JSON.parse(line));
    assert.ok(payloads.length >= 2);
    const ids = new Set(payloads.map((chunk) => chunk.id));
    assert.equal(ids.size, 1, `expected a single completion id, got ${[...ids].join(', ')}`);
    assert.equal(payloads.at(-1).choices[0].finish_reason, 'stop');
});

test('GET /models and /v1/models include model id hi', async () => {
    for (const path of ['/models', '/v1/models']) {
        const { res, body } = await json(path);
        assert.equal(res.status, 200);
        assert.equal(body.object, 'list');
        assert.ok(body.data.some((model) => model.id === 'hi'), `${path} missing model hi`);
    }
});

test('GET /v1/models/hi returns the hi model', async () => {
    const { res, body } = await json('/v1/models/hi');
    assert.equal(res.status, 200);
    assert.equal(body.id, 'hi');
    assert.equal(body.object, 'model');
});

test('POST /v1/responses returns a mock response', async () => {
    const { res, body } = await json('/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'hi', input: 'hi' }),
    });
    assert.equal(res.status, 200);
    assert.equal(body.object, 'response');
    assert.equal(body.status, 'completed');
    assert.equal(body.output[0].content[0].text, '这是一个模拟的回复');
});

test('unmatched routes return 404 and are logged', async () => {
    logs.length = 0;
    const res = await fetch(`${baseUrl}/definitely-missing`);
    assert.equal(res.status, 404);
    assert.ok(
        logs.some((line) => line.includes('GET /definitely-missing 404')),
        `expected 404 log, got: ${logs.join(' | ')}`,
    );
});

test('matched routes are logged with method, path, and status', async () => {
    logs.length = 0;
    const res = await fetch(`${baseUrl}/v1/models`);
    assert.equal(res.status, 200);
    assert.ok(
        logs.some((line) => line.includes('GET /v1/models 200')),
        `expected 200 log, got: ${logs.join(' | ')}`,
    );
});
