import { strictFormat } from '../utils/text.js';

export class LMStudio {
    static prefix = 'lmstudio';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;
        this.url = url || process.env.LMSTUDIO_URL || 'http://127.0.0.1:1234';
        this.chat_endpoint = '/api/v0/chat/completions';
        this.openai_chat_endpoint = '/v1/chat/completions';
        this.completions_endpoint = '/api/v0/completions';
        this.embedding_endpoint = '/api/v0/embeddings';
        this.models_endpoint = '/api/v0/models';
    }

    async sendRequest(turns, systemMessage, stop_seq = '***') {
        let model = this.model_name || 'functiongemma-270m';
        let messages = strictFormat(turns);
        if (systemMessage) {
            messages.unshift({ role: 'system', content: systemMessage });
        }

        let res = null;
        try {
            console.log(`Awaiting LM Studio response... (model: ${model})`);
            const payload = {
                model,
                messages,
                stream: false,
                ...(this.params || {})
            };
            if (stop_seq) {
                payload.stop = stop_seq;
            }
            const data = await this.send(this.chat_endpoint, payload);
            res = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
        } catch (err) {
            if (err.message?.toLowerCase().includes('context') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq);
            }
            console.log(err);
            res = 'My brain disconnected, try again.';
        }
        return res;
    }

    async sendToolRequest(turns, systemMessage, tools) {
        let model = this.model_name || 'functiongemma-270m';
        let messages = strictFormat(turns);
        if (systemMessage) {
            messages.unshift({ role: 'system', content: systemMessage });
        }
        let res = null;
        try {
            console.log(`Awaiting LM Studio tool response... (model: ${model})`);
            const payload = {
                model,
                messages,
                tools,
                tool_choice: 'auto',
                stream: false,
                ...(this.params || {})
            };
            const data = await this.send(this.openai_chat_endpoint, payload);
            const message = data?.choices?.[0]?.message;
            res = {
                content: message?.content ?? '',
                tool_calls: message?.tool_calls ?? [],
                raw: data
            };
        } catch (err) {
            if (err.message?.toLowerCase().includes('context') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendToolRequest(turns.slice(1), systemMessage, tools);
            }
            console.log(err);
            res = { content: '', tool_calls: [], error: err };
        }
        return res;
    }

    async embed(text) {
        let model = this.model_name || 'nomic-embed-text';
        let body = { model: model, input: text };
        let res = await this.send(this.embedding_endpoint, body);
        return res?.data?.[0]?.embedding ?? res?.embedding;
    }

    async getModels() {
        return await this.send(this.models_endpoint, null, 'GET');
    }

    async getModelInfo(model) {
        return await this.send(`${this.models_endpoint}/${encodeURIComponent(model)}`, null, 'GET');
    }

    async send(endpoint, body, method = 'POST') {
        const url = new URL(endpoint, this.url);
        let headers = new Headers();
        if (method !== 'GET') {
            headers.set('Content-Type', 'application/json');
        }
        const request = new Request(url, {
            method,
            headers,
            body: method === 'GET' ? null : JSON.stringify(body)
        });
        try {
            const res = await fetch(request);
            if (!res.ok) {
                throw new Error(`LM Studio Status: ${res.status}`);
            }
            return await res.json();
        } catch (err) {
            console.error('Failed to send LM Studio request.');
            console.error(err);
            throw err;
        }
    }

    async sendVisionRequest() {
        return 'Vision is only supported by certain models.';
    }
}
