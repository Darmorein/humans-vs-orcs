import {
  DEFAULT_PVP_WS,
  type ClientNetMessage,
  type ServerNetMessage,
} from './Protocol';

type Handler = (msg: ServerNetMessage) => void;

/**
 * Thin WebSocket client for the 1v1 room relay.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private url: string;

  constructor(url = DEFAULT_PVP_WS) {
    this.url = url;
  }

  public get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public onMessage(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`Cannot connect to PvP relay at ${this.url}`));
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as ServerNetMessage;
          for (const h of this.handlers) h(msg);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        this.ws = null;
      };
    });
  }

  public send(msg: ClientNetMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  public close() {
    this.ws?.close();
    this.ws = null;
  }
}
