import type { Logger } from "./logger.ts";

/** A map from event name to the listener's argument tuple. */
// deno-lint-ignore no-explicit-any
export type EventMap = Record<string, any[]>;

/** Listener function for an event in `E`. */
export type Listener<E extends EventMap, K extends keyof E> = (...args: E[K]) => unknown;

/**
 * A small typed event emitter. Listener errors (sync or async) are caught and
 * passed to {@link Emitter.onListenerError} instead of crashing the process.
 */
export class Emitter<E extends EventMap> {
    readonly #listeners = new Map<keyof E, Set<Listener<E, keyof E>>>();
    /** Logger used for listener errors. */
    protected logger?: Logger;

    /**
     * Adds a listener.
     * @returns A function that removes the listener.
     */
    on<K extends keyof E>(event: K, listener: Listener<E, K>): () => void {
        let set = this.#listeners.get(event);
        if (!set) this.#listeners.set(event, set = new Set());
        set.add(listener as Listener<E, keyof E>);
        return () => this.off(event, listener);
    }

    /**
     * Adds a listener that runs at most once.
     * @returns A function that removes the listener.
     */
    once<K extends keyof E>(event: K, listener: Listener<E, K>): () => void {
        const off = this.on(event, (...args) => {
            off();
            return listener(...args);
        });
        return off;
    }

    /** Waits for the next occurrence of an event and resolves with its arguments. */
    waitFor<K extends keyof E>(event: K, options: { signal?: AbortSignal } = {}): Promise<E[K]> {
        return new Promise((resolve, reject) => {
            const { signal } = options;
            if (signal?.aborted) return reject(signal.reason);
            const onAbort = () => {
                off();
                reject(signal!.reason);
            };
            const off = this.once(event, (...args) => {
                signal?.removeEventListener("abort", onAbort);
                resolve(args);
            });
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    /** Removes a listener. */
    off<K extends keyof E>(event: K, listener: Listener<E, K>): void {
        this.#listeners.get(event)?.delete(listener as Listener<E, keyof E>);
    }

    /** Removes all listeners, or all listeners for one event. */
    removeAllListeners(event?: keyof E): void {
        if (event === undefined) this.#listeners.clear();
        else this.#listeners.delete(event);
    }

    /** Number of listeners for an event. */
    listenerCount(event: keyof E): number {
        return this.#listeners.get(event)?.size ?? 0;
    }

    /**
     * Calls every listener for `event`.
     * @returns `true` if the event had listeners.
     */
    emit<K extends keyof E>(event: K, ...args: E[K]): boolean {
        const set = this.#listeners.get(event);
        if (!set?.size) return false;
        for (const listener of [...set]) {
            try {
                const result = listener(...args);
                if (result instanceof Promise) result.catch((err) => this.onListenerError(err, event));
            } catch (err) {
                this.onListenerError(err, event);
            }
        }
        return true;
    }

    /** Called when a listener throws or rejects. Override to customize. */
    protected onListenerError(error: unknown, event: keyof E): void {
        if (this.logger) this.logger.error(`Unhandled error in "${String(event)}" listener:`, error);
        else console.error(`Unhandled error in "${String(event)}" listener:`, error);
    }
}
