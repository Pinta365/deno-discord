/** Log levels, from least to most verbose. */
export enum LogLevel {
    /** Logging disabled. */
    NONE = -1,
    /** Errors that need attention. */
    ERROR = 0,
    /** Recoverable problems. */
    WARN = 1,
    /** Normal lifecycle information (connects, reconnects). */
    INFO = 2,
    /** Detailed debug information. */
    DEBUG = 3,
    /** Very verbose tracing, including raw gateway traffic. */
    TRACE = 4,
}

/** A function that receives log records. Replace it to route logs elsewhere. */
export type LogHandler = (level: LogLevel, scope: string, args: unknown[]) => void;

const COLORS: Record<number, string> = {
    [LogLevel.ERROR]: "\x1b[31m",
    [LogLevel.WARN]: "\x1b[33m",
    [LogLevel.INFO]: "\x1b[36m",
    [LogLevel.DEBUG]: "\x1b[35m",
    [LogLevel.TRACE]: "\x1b[90m",
};

/** Default handler: colored, timestamped output to the console. */
export const consoleLogHandler: LogHandler = (level, scope, args) => {
    const prefix = `${COLORS[level] ?? ""}[${new Date().toISOString()}] [${LogLevel[level]}] [${scope}]\x1b[0m`;
    const fn = level === LogLevel.ERROR ? console.error : level === LogLevel.WARN ? console.warn : console.log;
    fn(prefix, ...args);
};

/** Options for {@link Logger}. */
export interface LoggerOptions {
    /** Minimum level to emit. Defaults to {@link LogLevel.WARN}. */
    level?: LogLevel;
    /** Where log records go. Defaults to {@link consoleLogHandler}. */
    handler?: LogHandler;
}

/** A small scoped logger. Each client owns its own instance. */
export class Logger {
    /** Current minimum level. */
    level: LogLevel;
    /** Current handler. */
    handler: LogHandler;
    readonly #scope: string;

    /**
     * Creates a logger.
     * @param options Level and handler.
     * @param scope Label included with each record, e.g. `"gateway"`.
     */
    constructor(options: LoggerOptions = {}, scope = "discord") {
        this.level = options.level ?? LogLevel.WARN;
        this.handler = options.handler ?? consoleLogHandler;
        this.#scope = scope;
    }

    /** Creates a logger that shares this logger's level and handler, with a different scope. */
    child(scope: string): Logger {
        const child = new Logger({}, scope);
        Object.defineProperties(child, {
            level: { get: () => this.level, set: (v: LogLevel) => (this.level = v) },
            handler: { get: () => this.handler, set: (v: LogHandler) => (this.handler = v) },
        });
        return child;
    }

    /** Logs at ERROR. */
    error(...args: unknown[]): void {
        this.#log(LogLevel.ERROR, args);
    }
    /** Logs at WARN. */
    warn(...args: unknown[]): void {
        this.#log(LogLevel.WARN, args);
    }
    /** Logs at INFO. */
    info(...args: unknown[]): void {
        this.#log(LogLevel.INFO, args);
    }
    /** Logs at DEBUG. */
    debug(...args: unknown[]): void {
        this.#log(LogLevel.DEBUG, args);
    }
    /** Logs at TRACE. */
    trace(...args: unknown[]): void {
        this.#log(LogLevel.TRACE, args);
    }

    #log(level: LogLevel, args: unknown[]): void {
        if (level > this.level) return;
        this.handler(level, this.#scope, args);
    }
}
