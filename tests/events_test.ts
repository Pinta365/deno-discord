import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { Emitter } from "../mod.ts";

type Events = {
    ping: [value: number];
    idle: [];
};

class TestEmitter extends Emitter<Events> {
    readonly errors: { error: unknown; event: keyof Events }[] = [];

    protected override onListenerError(error: unknown, event: keyof Events): void {
        this.errors.push({ error, event });
    }
}

Deno.test("on registers a listener and the returned function unsubscribes it", () => {
    const emitter = new TestEmitter();
    const seen: number[] = [];

    const off = emitter.on("ping", (value) => seen.push(value));
    assertEquals(emitter.emit("ping", 1), true);
    off();
    assertEquals(emitter.emit("ping", 2), false);
    assertEquals(seen, [1]);
    assertEquals(emitter.listenerCount("ping"), 0);
});

Deno.test("off removes a specific listener", () => {
    const emitter = new TestEmitter();
    let calls = 0;
    const listener = () => calls++;

    emitter.on("ping", listener);
    emitter.off("ping", listener);

    assertFalse(emitter.emit("ping", 1));
    assertEquals(calls, 0);
});

Deno.test("once runs a listener at most once", () => {
    const emitter = new TestEmitter();
    let calls = 0;

    emitter.once("ping", () => calls++);
    emitter.emit("ping", 1);
    emitter.emit("ping", 2);

    assertEquals(calls, 1);
    assertEquals(emitter.listenerCount("ping"), 0);
});

Deno.test("waitFor resolves with the emitted arguments", async () => {
    const emitter = new TestEmitter();

    const waiting = emitter.waitFor("ping");
    emitter.emit("ping", 42);

    assertEquals(await waiting, [42]);
});

Deno.test("waitFor rejects when its signal aborts", async () => {
    const emitter = new TestEmitter();
    const controller = new AbortController();

    const waiting = emitter.waitFor("ping", { signal: controller.signal });
    controller.abort(new Error("stop"));

    await assertRejects(() => waiting, Error, "stop");
    assertEquals(emitter.listenerCount("ping"), 0);
});

Deno.test("waitFor rejects immediately when the signal is already aborted", async () => {
    const emitter = new TestEmitter();
    const controller = new AbortController();
    controller.abort(new Error("already gone"));

    await assertRejects(() => emitter.waitFor("ping", { signal: controller.signal }), Error, "already gone");
    assertEquals(emitter.listenerCount("ping"), 0);
});

Deno.test("a throwing listener is routed to onListenerError without aborting emit", () => {
    const emitter = new TestEmitter();
    const boom = new Error("boom");
    let reached = false;

    emitter.on("ping", () => {
        throw boom;
    });
    emitter.on("ping", () => {
        reached = true;
    });

    assertEquals(emitter.emit("ping", 1), true);
    assert(reached);
    assertEquals(emitter.errors.length, 1);
    assertEquals(emitter.errors[0].error, boom);
    assertEquals(emitter.errors[0].event, "ping");
});

Deno.test("a rejecting async listener is routed to onListenerError", async () => {
    const emitter = new TestEmitter();
    const boom = new Error("async boom");

    emitter.on("ping", () => Promise.reject(boom));
    emitter.emit("ping", 1);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(emitter.errors.length, 1);
    assertEquals(emitter.errors[0].error, boom);
});

Deno.test("removeAllListeners clears one event or everything", () => {
    const emitter = new TestEmitter();
    emitter.on("ping", () => {});
    emitter.on("idle", () => {});

    emitter.removeAllListeners("ping");
    assertEquals(emitter.listenerCount("ping"), 0);
    assertEquals(emitter.listenerCount("idle"), 1);

    emitter.removeAllListeners();
    assertEquals(emitter.listenerCount("idle"), 0);
});
