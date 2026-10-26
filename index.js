const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const { PassThrough } = require('stream');

const MOCK_REPLY = '这是一个模拟的回复';
const DEFAULT_MODELS = [
    { id: 'hi', object: 'model', created: 1710000000, owned_by: 'mock' },
    { id: 'gpt-3.5-turbo', object: 'model', created: 1677610602, owned_by: 'openai' },
    { id: 'gpt-4o', object: 'model', created: 1715367049, owned_by: 'openai' },
];

function createApp() {
    const app = new Koa();
    const router = new Router();

    // Log first so CORS preflight and unmatched 404s are both visible.
    app.use(async (ctx, next) => {
        try {
            await next();
        } finally {
            const status = ctx.status || 404;
            console.log(`${ctx.method} ${ctx.path} ${status}`);
        }
    });

    // Reflect any Origin so Cursor desktop, Codespaces, and browsers can call the mock.
    app.use(cors({
        origin: (ctx) => ctx.get('Origin') || '*',
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
        allowHeaders: [
            'Content-Type',
            'Authorization',
            'OpenAI-Beta',
            'OpenAI-Organization',
            'X-Requested-With',
            'Accept',
            'x-api-key',
        ],
        credentials: true,
    }));

    app.use(bodyParser());

    const chatCompletions = async (ctx) => {
        try {
            const requestBody = ctx.request.body || {};
            console.log('收到的请求:', JSON.stringify(requestBody, null, 2));
            const isStream = Boolean(requestBody.stream);
            const model = requestBody.model || 'hi';
            const completionId = 'chatcmpl-' + Date.now();
            const created = Math.floor(Date.now() / 1000);

            if (!isStream) {
                ctx.body = {
                    id: completionId,
                    object: 'chat.completion',
                    created,
                    model,
                    system_fingerprint: 'fp_' + created,
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: MOCK_REPLY,
                        },
                        finish_reason: 'stop',
                    }],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 10,
                        total_tokens: 20,
                    },
                };
                return;
            }

            ctx.set({
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });

            const stream = new PassThrough();
            ctx.status = 200;
            ctx.body = stream;

            const generateEvent = (content, finishReason) => JSON.stringify({
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                    index: 0,
                    delta: content,
                    finish_reason: finishReason,
                }],
            });

            // Hand the body to Koa immediately; write chunks afterward so the
            // client starts receiving SSE before the mock reply is finished.
            stream.write(`data: ${generateEvent({ role: 'assistant' }, null)}\n\n`);

            setImmediate(async () => {
                try {
                    for (const char of MOCK_REPLY) {
                        await new Promise((resolve) => setTimeout(resolve, 20));
                        stream.write(`data: ${generateEvent({ content: char }, null)}\n\n`);
                    }
                    stream.write(`data: ${generateEvent({}, 'stop')}\n\n`);
                    stream.write('data: [DONE]\n\n');
                    stream.end();
                } catch (error) {
                    console.error('Error:', error);
                    stream.destroy(error);
                }
            });
        } catch (error) {
            console.error('Error:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
    };

    const listModels = async (ctx) => {
        ctx.body = {
            object: 'list',
            data: DEFAULT_MODELS,
        };
    };

    const getModel = async (ctx) => {
        const model = DEFAULT_MODELS.find((item) => item.id === ctx.params.id);
        if (!model) {
            ctx.status = 404;
            ctx.body = {
                error: {
                    message: `The model '${ctx.params.id}' does not exist`,
                    type: 'invalid_request_error',
                    param: 'model',
                    code: 'model_not_found',
                },
            };
            return;
        }
        ctx.body = model;
    };

    const createResponse = async (ctx) => {
        const requestBody = ctx.request.body || {};
        const model = requestBody.model || 'hi';
        const responseId = 'resp_' + Date.now();
        const createdAt = Math.floor(Date.now() / 1000);
        const payload = {
            id: responseId,
            object: 'response',
            created_at: createdAt,
            status: 'completed',
            model,
            output: [{
                type: 'message',
                id: 'msg_' + createdAt,
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: MOCK_REPLY }],
            }],
            usage: {
                input_tokens: 10,
                output_tokens: 10,
                total_tokens: 20,
            },
        };

        if (!requestBody.stream) {
            ctx.body = payload;
            return;
        }

        ctx.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });

        const stream = new PassThrough();
        ctx.status = 200;
        ctx.body = stream;

        const writeEvent = (event, data) => {
            stream.write(`event: ${event}\n`);
            stream.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        writeEvent('response.created', { ...payload, status: 'in_progress', output: [] });
        setImmediate(() => {
            writeEvent('response.output_text.delta', { id: responseId, delta: MOCK_REPLY });
            writeEvent('response.completed', payload);
            stream.write('data: [DONE]\n\n');
            stream.end();
        });
    };

    router.post('/chat/completions', chatCompletions);
    router.post('/v1/chat/completions', chatCompletions);
    router.get('/models', listModels);
    router.get('/v1/models', listModels);
    router.get('/models/:id', getModel);
    router.get('/v1/models/:id', getModel);
    router.post('/responses', createResponse);
    router.post('/v1/responses', createResponse);

    app.use(router.routes()).use(router.allowedMethods());
    return app;
}

if (require.main === module) {
    const port = Number(process.env.PORT) || 3000;
    createApp().listen(port, () => {
        console.log('Mock OpenAI Start');
    });
}

module.exports = { createApp };
