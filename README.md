# mock-opanai-api

A tiny Koa mock of the OpenAI HTTP API for Cursor custom-model / Base URL testing.

It stays a mock: every completion returns the same simulated reply. No upstream model is called.

## Run

```bash
npm install
npm start
```

The server listens on `PORT` or `3000`.

Point Cursor at this process with:

- **Base URL**: `http://<host>:3000/v1` or `http://<host>:3000` (both `/v1/...` and unprefixed routes are registered)
- **API Key**: any non-empty string
- **Model**: `hi`

## Implemented routes

| Method | Paths | Notes |
| --- | --- | --- |
| `POST` | `/chat/completions`, `/v1/chat/completions` | JSON or SSE when `stream: true` |
| `GET` | `/models`, `/v1/models` | Includes model id `hi` |
| `GET` | `/models/:id`, `/v1/models/:id` | Single-model lookup |
| `POST` | `/responses`, `/v1/responses` | Minimal Responses API mock |

Every request, including unmatched ones, logs `METHOD /path STATUS`.

Streaming chat completions reuse one `id` for the whole request and start writing SSE as soon as the handler returns (they do not buffer the full reply first). The stream ends with `data: [DONE]`.

CORS reflects the request `Origin` so Cursor desktop (`vscode-file://vscode-app`), Codespaces, and browsers can call the mock.

## Checks

```bash
npm test
```

Manual curl:

```bash
curl -sS -D- http://127.0.0.1:3000/v1/models | head

curl -sS http://127.0.0.1:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"hi","messages":[{"role":"user","content":"hi"}]}'

curl -sS -N http://127.0.0.1:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"hi","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```
