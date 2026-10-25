import WebSocket from 'ws';
import type { Config } from '../config/index.js';

export interface VoiceToolCall { tool_name: string; tool_call_id: string; parameters: unknown }
export interface AgentCallbacks {
  audio(pcm: Buffer, sampleRate: number): void;
  text(text: string): void;
  tool(call: VoiceToolCall, signal: AbortSignal): Promise<unknown>;
  complete(): void;
  failed(): void;
}
type SocketFactory = (url: string, headers?: Record<string, string>) => WebSocket;
const createSocket: SocketFactory = (url, headers) => new WebSocket(url, { headers, maxPayload: 2_000_000 });

/** A private authenticated agent connection. No SDK/browser microphone required. */
export class ElevenAgent {
  private socket?: WebSocket;
  private closed = false;
  private controller = new AbortController();
  private rate = 16000;
  private calls = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private config: Pick<Config, 'ELEVENLABS_API_KEY' | 'ELEVENLABS_AGENT_ID'>,
    private callbacks: AgentCallbacks, private socketFactory: SocketFactory = createSocket,
    private request: typeof fetch = fetch) {}

  async start(context: string): Promise<void> {
    try {
      const url = new URL('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url');
      url.searchParams.set('agent_id', this.config.ELEVENLABS_AGENT_ID);
      const response = await this.request(url, { headers: { 'xi-api-key': this.config.ELEVENLABS_API_KEY },
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error('Voice authentication failed.');
      const data = await response.json() as { signed_url?: string };
      if (!data.signed_url) throw new Error('Voice authentication failed.');
      const signed = new URL(data.signed_url);
      if (signed.protocol !== 'wss:' || signed.hostname !== 'api.elevenlabs.io') throw new Error('Invalid voice endpoint.');
      if (this.closed) return;
      const socket = this.socket = this.socketFactory(signed.toString());
      await new Promise<void>((resolve, reject) => {
        let ready = false;
        const timeout = setTimeout(() => { reject(new Error('Voice connection timed out.')); this.close(); }, 10000);
        const cleanup = () => clearTimeout(timeout);
        socket.on('error', () => { cleanup(); if (!ready) reject(new Error('Voice connection failed.')); else this.fail(); });
        socket.on('close', () => { cleanup(); if (!ready) reject(new Error('Voice connection closed.')); else if (!this.closed) this.fail(); });
        socket.on('open', () => this.send({ type: 'conversation_initiation_client_data' }));
        socket.on('message', raw => {
          if (this.closed) return;
          try {
            const event = JSON.parse(raw.toString());
            if (event.type === 'conversation_initiation_metadata') {
              const format = event.conversation_initiation_metadata_event?.agent_output_audio_format;
              if (!['pcm_16000', 'pcm_24000', 'pcm_48000'].includes(format)) throw new Error('Unsupported audio format.');
              this.rate = Number(format.slice(4)); ready = true; cleanup();
              this.context(context); resolve();
            } else this.event(event);
          } catch { if (!ready) { cleanup(); reject(new Error('Invalid voice protocol.')); } this.fail(); }
        });
      });
    } catch (error) { this.close(); throw error; }
  }
  context(text: string): void { this.send({ type: 'contextual_update', text: text.slice(0,24000) }); }
  message(text: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail(), 115000);
    this.send({ type: 'user_message', text: text.slice(0,4000) });
  }
  private send(value: unknown): void {
    if (!this.closed && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }
  private event(event: any): void {
    if (event.type === 'ping') this.send({ type: 'pong', event_id: event.ping_event.event_id });
    if (event.type === 'audio') this.callbacks.audio(Buffer.from(event.audio_event.audio_base_64, 'base64'), this.rate);
    if (event.type === 'agent_response') this.callbacks.text(String(event.agent_response_event.agent_response).slice(0,8000));
    if (event.type === 'agent_response_complete') { clearTimeout(this.timer); this.callbacks.complete(); }
    if (event.type === 'client_tool_call') {
      const call = event.client_tool_call as VoiceToolCall;
      if (!call || typeof call.tool_call_id !== 'string' || typeof call.tool_name !== 'string') throw new Error('Invalid tool call.');
      if (this.calls.has(call.tool_call_id)) return;
      if (this.calls.size >= 12) { this.fail(); return; }
      this.calls.add(call.tool_call_id);
      void this.callbacks.tool(call, this.controller.signal).then(result => {
        if (!this.closed) this.send({ type: 'client_tool_result', tool_call_id: call.tool_call_id, result: JSON.stringify(result) });
      }).catch(() => {
        this.send({ type: 'client_tool_result', tool_call_id: call.tool_call_id, result: 'The requested action could not be completed.', is_error: true });
      });
    }
    if (event.type === 'error' || event.type === 'client_error') this.fail();
  }
  private fail(): void { if (this.closed) return; this.close(); this.callbacks.failed(); }
  close(): void {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer); this.controller.abort();
    this.socket?.close();
  }
}

/** One bounded speech burst, tagged by the Discord adapter before entering ASR. */
export class ScribeUtterance {
  private socket: WebSocket;
  private queue: Buffer[] = [];
  private bytes = 0;
  private sent = 0;
  private finished = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout>;
  constructor(key: string, final: (text: string) => void, failed: () => void,
    socketFactory: SocketFactory = createSocket) {
    const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
    url.search = new URLSearchParams({ model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000',
      sample_rate: '16000', commit_strategy: 'manual', language_code: 'en' }).toString();
    this.socket = socketFactory(url.toString(), { 'xi-api-key': key });
    const fail = () => { if (this.closed) return; this.close(); failed(); };
    this.timer = setTimeout(fail, 40000);
    this.socket.on('error', fail);
    this.socket.on('close', () => { if (!this.closed) fail(); });
    this.socket.on('message', raw => {
      if (this.closed) return;
      try {
        const event = JSON.parse(raw.toString());
        if (event.message_type === 'session_started') {
          this.ready = true;
          for (const chunk of this.queue) this.send(chunk);
          this.queue = []; this.bytes = 0;
          if (this.finished) this.commit();
        } else if (event.message_type === 'committed_transcript') {
          this.close(); const text = String(event.text ?? '').trim().slice(0,4000); if (text) final(text);
        } else if (/error|insufficient|quota|rate_limited|auth|timeout/.test(event.message_type ?? '')) fail();
      } catch { fail(); }
    });
    // Wait for session_started, not just the WebSocket open event.
  }
  private ready = false;
  private send(pcm: Buffer): void {
    this.ready = true; this.sent += pcm.length;
    this.socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: pcm.toString('base64'), sample_rate: 16000 }));
  }
  write(pcm: Buffer): void {
    if (this.closed || this.finished) return;
    if (this.ready) this.send(pcm);
    else {
      this.bytes += pcm.length;
      if (this.bytes > 160000) { this.close(); return; }
      this.queue.push(Buffer.from(pcm));
    }
  }
  finish(): void {
    if (this.closed) return;
    this.finished = true;
    if (this.ready) this.commit();
  }
  private commit(): void {
    // Scribe manual commit requires a minimum amount of audio; pad short turns.
    if (this.sent < 16000) this.send(Buffer.alloc(16000 - this.sent));
    this.socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16000 }));
  }
  close(): void { if (this.closed) return; this.closed = true; clearTimeout(this.timer); this.queue = []; this.socket.close(); }
}
