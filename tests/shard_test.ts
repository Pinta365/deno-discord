import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { constants as zlibConstants, createDeflate, type Deflate } from "node:zlib";
import { Buffer } from "node:buffer";
import { GatewayDispatchEvents, GatewayOpcodes } from "discord-api-types/v10";
import { Logger, LogLevel, Shard, type ShardOptions } from "../mod.ts";
import { describeClose } from "../src/gateway/shard.ts";

type JsonRecord = Record<string, unknown>;

class FakeWebSocket {
    static readonly OPEN = 1;
    static instances: FakeWebSocket[] = [];

    static reset(): void {
        FakeWebSocket.instances = [];
    }

    static get latest(): FakeWebSocket {
        const socket = FakeWebSocket.instances.at(-1);
        if (!socket) throw new Error("No FakeWebSocket has been constructed");
        return socket;
    }

    readonly url: string;
    readyState = FakeWebSocket.OPEN;
    binaryType = "arraybuffer";
    onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    readonly sent: string[] = [];

    constructor(url: string) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(code = 1000, reason = ""): void {
        this.readyState = 3;
        this.onclose?.({ code, reason });
    }

    receive(payload: unknown): void {
        this.onmessage?.({ data: JSON.stringify(payload) });
    }

    receiveBinary(data: ArrayBuffer): void {
        this.onmessage?.({ data });
    }

    received(op: number): JsonRecord[] {
        return this.sent.map((data) => JSON.parse(data) as JsonRecord).filter((payload) => payload.op === op);
    }
}

function hello(interval = 45_000): JsonRecord {
    return { op: GatewayOpcodes.Hello, d: { heartbeat_interval: interval } };
}

function readyPayload(seq = 1, sessionId = "sess-1", resumeUrl = "wss://resume.discord.gg"): JsonRecord {
    return {
        op: GatewayOpcodes.Dispatch,
        s: seq,
        t: GatewayDispatchEvents.Ready,
        d: {
            v: 10,
            user: { id: "1", username: "bot", discriminator: "0", global_name: null, avatar: null },
            guilds: [],
            session_id: sessionId,
            resume_gateway_url: resumeUrl,
            application: { id: "app-1", flags: 0 },
        },
    };
}

function makeShard(overrides: Partial<ShardOptions> = {}): { shard: Shard; dispatched: JsonRecord[] } {
    const dispatched: JsonRecord[] = [];
    const shard = new Shard({
        token: "test-token",
        intents: 1,
        url: "wss://gateway.discord.gg",
        compress: false,
        logger: new Logger({ level: LogLevel.NONE }),
        WebSocket: FakeWebSocket as unknown as typeof WebSocket,
        onDispatch: (payload) => dispatched.push(payload as unknown as JsonRecord),
        ...overrides,
    });
    return { shard, dispatched };
}

Deno.test("HELLO triggers IDENTIFY with token, intents and connection properties", async () => {
    const time = new FakeTime();
    FakeWebSocket.reset();
    const { shard } = makeShard();
    try {
        shard.connect();
        const socket = FakeWebSocket.latest;

        socket.receive(hello());
        await time.tickAsync(0);

        const identify = socket.received(GatewayOpcodes.Identify)[0];
        assert(identify);
        const data = identify.d as { token: string; intents: number; properties: { os: string }; shard: number[] };
        assertEquals(data.token, "test-token");
        assertEquals(data.intents, 1);
        assertEquals(typeof data.properties.os, "string");
        assertEquals(data.shard, [0, 1]);
    } finally {
        shard.close();
        time.restore();
    }
});

Deno.test("READY resolves connect() and calls onDispatch", async () => {
    const time = new FakeTime();
    FakeWebSocket.reset();
    const { shard, dispatched } = makeShard();
    try {
        const ready = shard.connect();
        const socket = FakeWebSocket.latest;
        socket.receive(hello());
        await time.tickAsync(0);

        socket.receive(readyPayload());
        await ready;

        assertEquals(shard.status, "ready");
        assertEquals(shard.sessionId, "sess-1");
        assertEquals(dispatched.length, 1);
        assertEquals(dispatched[0].t, GatewayDispatchEvents.Ready);
    } finally {
        shard.close();
        time.restore();
    }
});

Deno.test("HEARTBEAT_ACK updates latency", async () => {
    const time = new FakeTime();
    FakeWebSocket.reset();
    const { shard } = makeShard();
    const originalRandom = Math.random;
    try {
        shard.connect();
        const socket = FakeWebSocket.latest;

        // Force the first heartbeat to be scheduled immediately so its send time is deterministic.
        Math.random = () => 0;
        socket.receive(hello(1000));
        Math.random = originalRandom;
        await time.tickAsync(0);

        assertEquals(socket.received(GatewayOpcodes.Heartbeat).length, 1);
        assertEquals(shard.latency, -1);

        await time.tickAsync(50);
        socket.receive({ op: GatewayOpcodes.HeartbeatAck, d: null });

        assertEquals(shard.latency, 50);
    } finally {
        Math.random = originalRandom;
        shard.close();
        time.restore();
    }
});

Deno.test("RECONNECT immediately opens a new socket to the resume URL and sends RESUME", async () => {
    const time = new FakeTime();
    FakeWebSocket.reset();
    const { shard } = makeShard();
    try {
        const ready = shard.connect();
        const first = FakeWebSocket.latest;
        first.receive(hello());
        await time.tickAsync(0);
        first.receive(readyPayload(5, "sess-9", "wss://resume.example"));
        await ready;

        first.receive({ op: GatewayOpcodes.Reconnect, d: null });
        // No backoff for a Discord-requested reconnect: the new socket opens on the next tick.
        await time.tickAsync(0);

        const second = FakeWebSocket.latest;
        assert(second !== first);
        assertStringIncludes(second.url, "resume.example");

        second.receive(hello());
        await time.tickAsync(0);

        const resume = second.received(GatewayOpcodes.Resume)[0];
        assert(resume);
        const data = resume.d as { token: string; session_id: string; seq: number };
        assertEquals(data.token, "test-token");
        assertEquals(data.session_id, "sess-9");
        assertEquals(data.seq, 5);
    } finally {
        shard.close();
        time.restore();
    }
});

Deno.test("close code 4004 rejects connect() and calls onFatal", async () => {
    const time = new FakeTime();
    FakeWebSocket.reset();
    let fatal: Error | undefined;
    const { shard } = makeShard({ onFatal: (error) => (fatal = error) });
    try {
        const ready = shard.connect();
        const socket = FakeWebSocket.latest;

        socket.close(4004, "Authentication failed");

        await assertRejects(() => ready, Error, "fatal code 4004");
        assert(fatal instanceof Error);
        assertEquals(shard.status, "closed");
    } finally {
        shard.close();
        time.restore();
    }
});

Deno.test("a non-resumable invalid session re-identifies", async () => {
    const time = new FakeTime();
    FakeWebSocket.reset();
    const { shard } = makeShard();
    try {
        shard.connect();
        const socket = FakeWebSocket.latest;
        socket.receive(hello(60_000));
        await time.tickAsync(0);

        assertEquals(socket.received(GatewayOpcodes.Identify).length, 1);

        socket.receive({ op: GatewayOpcodes.InvalidSession, d: false });
        await time.tickAsync(5000);
        await time.tickAsync(0);

        assertEquals(socket.received(GatewayOpcodes.Identify).length, 2);
        assertEquals(shard.sessionId, null);
    } finally {
        shard.close();
        time.restore();
    }
});

Deno.test("an unacknowledged heartbeat closes the socket and resumes on a new one", async () => {
    const time = new FakeTime();
    FakeWebSocket.reset();
    const { shard } = makeShard();
    const originalRandom = Math.random;
    try {
        Math.random = () => 0;
        const ready = shard.connect();
        const first = FakeWebSocket.latest;
        first.receive(hello(1000));
        await time.tickAsync(0); // heartbeat sent at t=0, ACK never arrives
        first.receive(readyPayload(3, "sess-zombie", "wss://resume.zombie"));
        await ready;
        assertEquals(first.received(GatewayOpcodes.Heartbeat).length, 1);

        // Next beat finds no ACK -> zombie -> the socket is closed.
        await time.tickAsync(1000);
        assertEquals(first.readyState, 3);

        await time.tickAsync(1000); // reconnect delay elapses, new socket opens
        const second = FakeWebSocket.latest;
        assert(second !== first);

        second.receive(hello(1000));
        await time.tickAsync(0);
        const resume = second.received(GatewayOpcodes.Resume)[0];
        assert(resume);
        const data = resume.d as { token: string; session_id: string; seq: number };
        assertEquals(data.token, "test-token");
        assertEquals(data.session_id, "sess-zombie");
        assertEquals(data.seq, 3);
    } finally {
        Math.random = originalRandom;
        shard.close();
        time.restore();
    }
});

Deno.test("close() during the invalid-session wait stays closed and never re-identifies", async () => {
    const time = new FakeTime();
    FakeWebSocket.reset();
    const { shard } = makeShard();
    try {
        shard.connect();
        const socket = FakeWebSocket.latest;
        socket.receive(hello(60_000));
        await time.tickAsync(0);
        assertEquals(socket.received(GatewayOpcodes.Identify).length, 1);

        socket.receive({ op: GatewayOpcodes.InvalidSession, d: false });
        shard.close();
        await time.tickAsync(6000);

        assertEquals(shard.status, "closed");
        assertEquals(socket.received(GatewayOpcodes.Identify).length, 1);
    } finally {
        shard.close();
        time.restore();
    }
});

function deflateFrame(deflate: Deflate, text: string): Promise<ArrayBuffer> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        const onData = (chunk: Buffer) => chunks.push(chunk);
        deflate.on("data", onData);
        deflate.write(Buffer.from(text), () => {
            deflate.flush(zlibConstants.Z_SYNC_FLUSH, () => {
                deflate.off("data", onData);
                const out = Buffer.concat(chunks);
                resolve(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);
            });
        });
    });
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

Deno.test("zlib-stream frames are decoded across a persistent deflate stream", async () => {
    FakeWebSocket.reset();
    const { shard, dispatched } = makeShard({ compress: true });
    const deflate = createDeflate();
    try {
        const ready = shard.connect();
        const socket = FakeWebSocket.latest;
        assertStringIncludes(socket.url, "compress=zlib-stream");

        // Frame 1: HELLO.
        socket.receiveBinary(await deflateFrame(deflate, JSON.stringify(hello(60_000))));
        await turn();
        assertEquals(socket.received(GatewayOpcodes.Identify).length, 1);

        // Frame 2: READY, decoded from the same persistent stream.
        socket.receiveBinary(await deflateFrame(deflate, JSON.stringify(readyPayload())));
        await turn();
        await ready;
        assertEquals(shard.status, "ready");
        assertEquals(dispatched.length, 1);

        // One message split across two ArrayBuffer feeds (suffix only on the second).
        const frame = await deflateFrame(
            deflate,
            JSON.stringify({ op: GatewayOpcodes.Dispatch, s: 2, t: "MESSAGE_CREATE", d: { id: "1" } }),
        );
        const bytes = new Uint8Array(frame);
        const mid = Math.floor(bytes.length / 2);
        socket.receiveBinary(bytes.slice(0, mid).buffer as ArrayBuffer);
        await turn();
        socket.receiveBinary(bytes.slice(mid).buffer as ArrayBuffer);
        await turn();
        await turn();

        assertEquals(dispatched.length, 2);
        assertEquals(dispatched[1].t, "MESSAGE_CREATE");
    } finally {
        deflate.close();
        shard.close();
    }
});

Deno.test("describeClose names gateway and standard close codes", () => {
    assertEquals(describeClose(4004, "Authentication failed."), "4004 AuthenticationFailed: Authentication failed.");
    assertEquals(
        describeClose(1006, "", "Unexpected EOF"),
        "1006 abnormal closure, no close frame (Unexpected EOF)",
    );
    assertEquals(describeClose(1000, ""), "1000 normal closure");
    assertEquals(describeClose(3999, "x"), "3999 unknown close code: x");
});

Deno.test("an abrupt drop (Deno code 0) is logged as 1006 with the socket error, then resumed", async () => {
    const time = new FakeTime();
    FakeWebSocket.reset();
    const logs: string[] = [];
    const logger = new Logger({
        level: LogLevel.WARN,
        handler: (_level, _scope, args) => logs.push(args.map(String).join(" ")),
    });
    const { shard } = makeShard({ logger });
    try {
        const ready = shard.connect();
        const first = FakeWebSocket.latest;
        first.receive(hello());
        await time.tickAsync(0);
        first.receive(readyPayload(3, "sess-x", "wss://resume.example"));
        await ready;

        first.onerror?.({ type: "error", message: "Unexpected EOF" });
        first.readyState = 3;
        first.onclose?.({ code: 0, reason: "" });

        assertEquals(logs, ["Connection closed: 1006 abnormal closure, no close frame (Unexpected EOF)"]);
        await time.tickAsync(60_000);
        assertStringIncludes(FakeWebSocket.latest.url, "resume.example", "1006 is resumable");
    } finally {
        shard.close();
        time.restore();
    }
});
