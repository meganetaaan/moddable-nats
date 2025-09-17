// Moddable (ECMA-419) TCP/TLS transport for NATS.js Core.
// - Raw byte bridge only (no protocol parsing here).
// - TLS via SecureSocket ('ssl').
// Language target: ES2024.

import TCP from "embedded:io/socket/tcp";
// @ts-ignore
import TLS from "embedded:io/socket/tcp/tls";
import Timer from "timer";

// @ts-ignore
import { NatsConnectionImpl, setTransportFactory } from "nats-core/internal";

// @ts-ignore
import type { ConnectionOptions, NatsConnection, Server, Transport, TransportFactory, } from "nats-core/internal";

export interface Writer {
  write(data: Uint8Array): Promise<void>;
}
export interface Conn {
  writer: Writer;
  onData(cb: (c: Uint8Array) => void): void;
  onEnd(cb: (err?: Error) => void): void;
  close(): void;
  isClosed(): boolean;
  closed: Promise<void>;
}

export interface DialOpts {
  host: string;
  port: number;
  tls?: boolean;
  tlsOptions?: Record<string, any>; // passed as 'secure' to TLS
  noDelay?: boolean;
  keepalive?: { idle?: number; interval?: number; count?: number } | undefined;
}

export interface TransportFactoryOpts {
  tls?: boolean;
  tlsOptions?: Record<string, any>;
  socketOptions?: { noDelay?: boolean; keepalive?: { idle?: number; interval?: number; count?: number } };
  defaultPort?: number;
  lang?: string;
  version?: string;
}

export async function dial({
  host, port, tls = false, tlsOptions, noDelay = true, keepalive: _keepalive,
}: DialOpts): Promise<Conn> {
  let closed = false;
  let onDataCb: ((c: Uint8Array) => void) | null = null;
  let onEndCb: ((e?: Error) => void) | null = null;
  let sock: TCP | TLS;
  let bytesWritable = 0;
  let connectionReady = false;
  const pendingData: Uint8Array[] = []; // Buffer data until onDataCb is set

  const closedPromise = new Promise<void>((resolve) => {
    // This will be resolved when the socket is closed
    const checkClosed = () => {
      if (closed) {
        Timer.clear(checkTimer);
        resolve();
      }
    };
    const checkTimer = Timer.repeat(checkClosed, 100);
  });

  // Initialize socket
  await new Promise<void>((resolve, reject) => {
    const options = {
      address: host,  // TCP socket expects 'address' field, not 'host'
      port,
      nodelay: noDelay,
      format: "buffer" as const,
      onReadable: (bytes: number) => {
        if (closed) {
          return;
        }
        
        try {
          const data = sock.read();
          if (data instanceof ArrayBuffer) {
            const u8 = new Uint8Array(data);
            
            if (onDataCb) {
              onDataCb(u8);
            } else {
              pendingData.push(u8);
            }
          } else {
            // ignore non-buffer reads
          }
        } catch (e) {
          if (!closed) {
            closed = true;
            const err = e instanceof Error ? e : new Error(String(e));
            onEndCb?.(err);
          }
        }
      },
      onWritable: (bytes: number) => {
        bytesWritable = bytes;
        if (!connectionReady) {
          connectionReady = true;
          resolve(); // Connection established and ready for writing
        }
      },
      onError: () => {
        if (!closed) {
          closed = true;
          const error = new Error("Socket connection failed");
          onEndCb?.(error);
          reject(error);
        }
      },
      ...(tls ? { secure: tlsOptions ?? {} } : {})
    };

    sock = tls ? new TLS(options) : new TCP(options);
  });

  const writer: Writer = {
    write(data: Uint8Array) {
      return new Promise<void>((res, rej) => {
        try {
          if (closed) {
            rej(new Error("Socket is closed"));
            return;
          }
          
          // Write and update bytesWritable with the return value
          bytesWritable = sock.write(data.buffer);
          
          res();
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          rej(err);
        }
      });
    },
  };

  return {
    writer,
    onData(cb) { 
      onDataCb = cb;
      // Send any buffered data
      if (pendingData.length > 0) {
        for (const data of pendingData) {
          cb(data);
        }
        pendingData.length = 0; // Clear the buffer
      }
    },
    onEnd(cb) { onEndCb = cb; },
    close() {
      if (!closed) {
        closed = true;
        try { 
          sock.close(); 
        } catch {
          // Ignore close errors
        }
      }
    },
    isClosed() { return closed; },
    closed: closedPromise,
  };
}

class ModdableTransport implements Transport {
  readonly lang: string;
  readonly version: string;

  private _conn?: Conn;
  private _done = false;
  private _encrypted = false;
  private _frames: Uint8Array[] = [];
  private _next: (() => void) | null = null;
  private _closeError?: Error;
  private readonly _closed: Promise<void | Error>;
  private _resolveClosed!: (value: void | Error) => void;

  constructor(private readonly factoryOpts: TransportFactoryOpts = {}) {
    this.lang = factoryOpts.lang ?? "nats.moddable";
    this.version = factoryOpts.version ?? "0.0.0-dev";
    this._closed = new Promise((resolve) => {
      this._resolveClosed = resolve;
    });
  }

  get isClosed(): boolean {
    return this._done;
  }

  get closeError(): Error | undefined {
    return this._closeError;
  }

  async connect(server: Server, options: ConnectionOptions): Promise<void> {
    const host = server.hostname || "127.0.0.1";
    const port = server.port ?? this.factoryOpts.defaultPort ?? 4222;
    const tlsOpt = options.tls;
    const tlsEnabled = typeof tlsOpt === "boolean"
      ? tlsOpt
      : typeof tlsOpt === "object"
        ? true
        : !!this.factoryOpts.tls;
    const tlsOpts = typeof tlsOpt === "object" ? tlsOpt : this.factoryOpts.tlsOptions;

    this._conn = await dial({
      host,
      port,
      tls: tlsEnabled,
      tlsOptions: tlsOpts,
      noDelay: this.factoryOpts.socketOptions?.noDelay ?? true,
      keepalive: this.factoryOpts.socketOptions?.keepalive,
    });
    this._encrypted = !!tlsEnabled;

    this._conn.onData((chunk) => {
      if (this._done) {
        return;
      }
      if (chunk && chunk.length) {
        this._frames.push(chunk);
        if (this._next) {
          const resolve = this._next;
          this._next = null;
          resolve();
        }
      }
    });

    this._conn.onEnd((err) => {
      if (this._done) {
        return;
      }
      this._done = true;
      if (err) {
        this._closeError = err;
      }
      if (this._next) {
        const resolve = this._next;
        this._next = null;
        resolve();
      }
      this._resolveClosed(this._closeError ?? undefined);
    });
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    while (true) {
      if (this._frames.length) {
        yield this._frames.shift()!;
        continue;
      }
      if (this._done) {
        break;
      }
      await new Promise<void>((resolve) => {
        this._next = resolve;
      });
    }
  }

  isEncrypted(): boolean {
    return this._encrypted;
  }

  send(frame: Uint8Array): void {
    if (this._done || !this._conn) {
      return;
    }
    this._conn.writer.write(frame).catch(() => {});
  }

  async close(err?: Error): Promise<void> {
    if (this._done) {
      if (err && !this._closeError) {
        this._closeError = err;
      }
      return;
    }
    this._done = true;
    if (err) {
      this._closeError = err;
    }
    try {
      this._conn?.close();
    } catch {}
    if (this._next) {
      const resolve = this._next;
      this._next = null;
      resolve();
    }
    this._resolveClosed(this._closeError ?? undefined);
  }

  disconnect(): void {
    if (this._done) {
      return;
    }
    this._done = true;
    try {
      this._conn?.close();
    } catch {}
    if (this._next) {
      const resolve = this._next;
      this._next = null;
      resolve();
    }
    this._resolveClosed(this._closeError ?? undefined);
  }

  closed(): Promise<void | Error> {
    return this._closed;
  }

  discard(): void {
    // Moddable transport doesn't require extra discard handling.
  }
}

function buildTransportFactory(factoryOpts: TransportFactoryOpts = {}): TransportFactory {
  return {
    defaultPort: factoryOpts.defaultPort ?? 4222,
    factory: () => new ModdableTransport(factoryOpts),
  };
}

export function createModdableTransport(factoryOpts: TransportFactoryOpts = {}): TransportFactory {
  return buildTransportFactory(factoryOpts);
}

export function registerModdableTransport(factoryOpts: TransportFactoryOpts = {}): TransportFactory {
  const factory = buildTransportFactory(factoryOpts);
  setTransportFactory(factory);
  return factory;
}

export async function connect(
  opts: ConnectionOptions = {},
  factoryOpts: TransportFactoryOpts = {},
): Promise<NatsConnection> {
  registerModdableTransport(factoryOpts);
  return NatsConnectionImpl.connect(opts);
}

// @ts-ignore
export * from "nats-core";
