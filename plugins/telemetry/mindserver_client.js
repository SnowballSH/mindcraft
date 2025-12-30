import { io } from 'socket.io-client';

export class MindServerClient {
  constructor({ host = 'localhost', port = 8080 }) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.connected = false;
    this._handlers = {
      agentsStatus: new Set(),
      stateUpdate: new Set(),
      botOutput: new Set(),
      connect: new Set(),
      disconnect: new Set(),
      error: new Set(),
    };
  }

  on(eventName, cb) {
    if (!this._handlers[eventName]) throw new Error(`Unknown event: ${eventName}`);
    this._handlers[eventName].add(cb);
    return () => this._handlers[eventName].delete(cb);
  }

  _emit(eventName, ...args) {
    for (const cb of this._handlers[eventName] || []) cb(...args);
  }

  async connect() {
    if (this.connected) return;
    this.socket = io(`http://${this.host}:${this.port}`);

    await new Promise((resolve, reject) => {
      const onConnect = () => resolve();
      const onErr = (err) => reject(err);
      this.socket.once('connect', onConnect);
      this.socket.once('connect_error', onErr);
    });

    this.connected = true;
    this._emit('connect');

    this.socket.on('disconnect', () => {
      this.connected = false;
      this._emit('disconnect');
    });

    this.socket.on('agents-status', (agents) => this._emit('agentsStatus', agents));
    this.socket.on('state-update', (states) => this._emit('stateUpdate', states));
    this.socket.on('bot-output', (agentName, message) => this._emit('botOutput', agentName, message));
  }

  subscribeToState() {
    if (!this.socket) throw new Error('Not connected');
    this.socket.emit('listen-to-agents');
  }

  async getAgentSettings(agentName) {
    if (!this.socket) throw new Error('Not connected');
    return await new Promise((resolve, reject) => {
      this.socket.emit('get-settings', agentName, (resp) => {
        if (!resp) return reject(new Error('Empty response'));
        if (resp.error) return reject(new Error(resp.error));
        resolve(resp.settings);
      });
    });
  }
}


