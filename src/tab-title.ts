/**
 * Shared tab-title logic for omp and pi extensions.
 *
 * Both hosts expose a near-identical ExtensionAPI:
 *   pi.on("agent_start"|"agent_end"|"session_start"|"session_switch", handler)
 *   pi.exec(cmd, args, opts) -> { stdout, stderr, code }
 *   pi.getSessionName() -> string | undefined
 *   ctx.ui.setTitle(string)
 *   ctx.cwd
 *
 * We don't import host types here (omp uses @oh-my-pi/pi-coding-agent, pi uses
 * @mariozechner/pi-coding-agent — same shape, different package). The per-host
 * wrappers pass the API in as `pi: any`.
 *
 * Behavior:
 *   - On session start/switch: render `⋯ π · <basename(cwd)>` immediately.
 *   - On agent_start: ⋯ (working). Spawn a background `<hostBin> -p` to generate
 *     "<emoji> <2-4 words>" from the first user message. Cache by sessionId.
 *   - On agent_end: ✳ (idle, ready for input). Repaint with label if it arrived.
 *   - Optional repaintIntervalMs: re-assert title periodically (used for `pi`,
 *     which has no --no-title knob and overwrites the title from interactive-mode).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export type TabTitleConfig = {
	/** Display brand: "π", "omp", "pi". Used in fallback title body. */
	hostBrand: string;
	/** CLI binary for label generation, e.g. "omp" or "pi". */
	hostBin: string;
	/** Cache directory, e.g. `~/.omp/agent/.cache/tab-titles`. */
	cacheDir: string;
	/** Smol model pattern via `--model`. Undefined = let host pick default. */
	labelModel?: string;
	/** Extra CLI args for the label-gen subprocess. */
	labelExtraArgs?: string[];
	/** Optional log file. If undefined, errors are swallowed silently. */
	logFile?: string;
	/**
	 * If set (>0), re-paint the title on a timer to defend against the host
	 * overwriting it. Use ~800 ms for `pi`. Leave undefined for `omp` (it has
	 * --no-title / PI_NO_TITLE).
	 */
	repaintIntervalMs?: number;
};

const ICON_WORK = "⋯";
const ICON_IDLE = "✳";

const LABEL_SYSTEM_PROMPT = `You produce short tab labels for a terminal coding agent.

Given the user's first message in <user-message>...</user-message>, output ONE line:
<emoji> <2-4 words>

Rules:
- Pick ONE concrete emoji that fits the topic.
- Title in the SAME LANGUAGE as the user message (Russian message → Russian label).
- 2-4 words. No punctuation. No quotes. No file paths. No code.
- Generic fallback if unclear: "💬 Диалог" (RU) / "💬 Chat" (EN).

Output ONLY the line. No preamble. No explanation.`;

function ensureDir(dir: string): void {
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch {
		/* ignore */
	}
}

function sessionKey(pi: any, cwd: string): string {
	const name = typeof pi?.getSessionName === "function" ? pi.getSessionName() : undefined;
	if (name && typeof name === "string") {
		return crypto.createHash("sha1").update(name).digest("hex").slice(0, 16);
	}
	return crypto.createHash("sha1").update(`${cwd}|${process.pid}`).digest("hex").slice(0, 12);
}

function readCachedLabel(cacheDir: string, key: string): string | undefined {
	try {
		const p = path.join(cacheDir, `${key}.label.txt`);
		const v = fs.readFileSync(p, "utf8").trim();
		return v || undefined;
	} catch {
		return undefined;
	}
}

function writeCachedLabel(cacheDir: string, key: string, label: string): void {
	try {
		ensureDir(cacheDir);
		fs.writeFileSync(path.join(cacheDir, `${key}.label.txt`), label.trim());
	} catch {
		/* ignore */
	}
}

function logErr(cfg: TabTitleConfig, msg: string): void {
	if (!cfg.logFile) return;
	try {
		ensureDir(path.dirname(cfg.logFile));
		fs.appendFileSync(cfg.logFile, `[${new Date().toISOString()}] ${msg}\n`);
	} catch {
		/* ignore */
	}
}

/** Sanitize model output: strip terminal control chars, quotes, newlines. */
function sanitizeLabel(raw: string): string | undefined {
	if (!raw) return undefined;
	const cleaned = raw
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/^["'`\s]+|["'`\s]+$/g, "")
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)[0];
	if (!cleaned) return undefined;
	if (cleaned.length > 40 || /[<>{}\[\]]/.test(cleaned)) return undefined;
	return cleaned;
}

/** Pull the first user-typed text from session entries. */
function extractFirstUserMessage(pi: any, ctx: any): string | undefined {
	try {
		// ExtensionContext exposes sessionManager directly. Older shapes
		// might also expose it via pi.pi.sessionManager.
		const sm = ctx?.sessionManager ?? pi?.pi?.sessionManager ?? pi?.sessionManager;
		const entries: any[] | undefined = sm?.getEntries?.();
		if (!entries) return undefined;
		for (const e of entries) {
			if (e?.type !== "message" || e?.message?.role !== "user") continue;
			const c = e.message.content;
			if (typeof c === "string") return c.slice(0, 2000);
			if (Array.isArray(c)) {
				const txt = c
					.filter((p: any) => p?.type === "text" && typeof p.text === "string")
					.map((p: any) => p.text)
					.join("\n")
					.trim();
				if (txt) return txt.slice(0, 2000);
			}
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function fallbackBaseTitle(cfg: TabTitleConfig, cwd: string): string {
	const base = path.basename(cwd) || cwd;
	return `${cfg.hostBrand} · ${base}`;
}

const compose = (icon: string, body: string): string => `${icon} ${body}`;

async function generateLabelAsync(
	pi: any,
	cfg: TabTitleConfig,
	firstMessage: string,
): Promise<string | undefined> {
	const args: string[] = ["-p"];
	if (cfg.labelModel) args.push("--model", cfg.labelModel);
	if (cfg.labelExtraArgs?.length) args.push(...cfg.labelExtraArgs);
	args.push(
		"--no-tools",
		"--no-skills",
		"--no-extensions",
		"--no-session",
		"--system-prompt",
		LABEL_SYSTEM_PROMPT,
	);
	args.push(`<user-message>\n${firstMessage}\n</user-message>`);
	try {
		const res = await pi.exec(cfg.hostBin, args, {
			timeout: 30_000,
			env: { ...process.env, OMPCODE: "1" },
		});
		if (res?.code !== 0) {
			logErr(cfg, `label gen exit=${res?.code} stderr=${(res?.stderr ?? "").slice(0, 200)}`);
			return undefined;
		}
		return sanitizeLabel(res?.stdout ?? "");
	} catch (e) {
		logErr(cfg, `label gen threw: ${e instanceof Error ? e.message : String(e)}`);
		return undefined;
	}
}

export function installTabTitle(pi: any, cfg: TabTitleConfig): void {
	ensureDir(cfg.cacheDir);
	logErr(cfg, `installTabTitle: init host=${cfg.hostBin} cwd=${process.cwd()}`);

	let currentLabel: string | undefined;
	let currentCwd = process.cwd();
	let labelGenerationInFlight = false;
	let lastIcon: string = ICON_IDLE;
	let lastCtx: any = undefined;
	let watchdog: ReturnType<typeof setInterval> | undefined;

	function paint(icon: string, ctx: any): void {
		lastIcon = icon;
		if (ctx) lastCtx = ctx;
		const target = ctx ?? lastCtx;
		const body = currentLabel ?? fallbackBaseTitle(cfg, currentCwd);
		try {
			target?.ui?.setTitle?.(compose(icon, body));
		} catch (e) {
			logErr(cfg, `setTitle failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	function startWatchdog(): void {
		if (watchdog || !cfg.repaintIntervalMs || cfg.repaintIntervalMs <= 0) return;
		watchdog = setInterval(() => paint(lastIcon, undefined), cfg.repaintIntervalMs);
		(watchdog as any)?.unref?.();
	}

	function stopWatchdog(): void {
		if (watchdog) {
			clearInterval(watchdog);
			watchdog = undefined;
		}
	}

	function refreshFromCache(): void {
		const key = sessionKey(pi, currentCwd);
		const cached = readCachedLabel(cfg.cacheDir, key);
		if (cached) currentLabel = cached;
	}

	function maybeStartLabelGen(ctx: any, explicitText?: string): void {
		if (currentLabel) return;
		if (labelGenerationInFlight) return;
		const first = explicitText && explicitText.trim().length >= 3
			? explicitText
			: extractFirstUserMessage(pi, ctx);
		if (!first || first.trim().length < 3) {
			logErr(cfg, `label-gen skip: no first user msg (got ${first ? first.length : 0} chars)`);
			return;
		}
		logErr(cfg, `label-gen start: ${first.slice(0, 60)}...`);
		labelGenerationInFlight = true;
		generateLabelAsync(pi, cfg, first)
			.then((label) => {
				if (!label) {
					logErr(cfg, "label-gen done: empty result");
					return;
				}
				logErr(cfg, `label-gen done: "${label}"`);
				currentLabel = label;
				writeCachedLabel(cfg.cacheDir, sessionKey(pi, currentCwd), label);
				paint(lastIcon, ctx);
			})
			.catch((e) => logErr(cfg, `label gen rejected: ${e?.message ?? e}`))
			.finally(() => {
				labelGenerationInFlight = false;
			});
	}

	function onSessionEvent(ctx: any): void {
		currentCwd = ctx?.cwd ?? process.cwd();
		currentLabel = undefined;
		refreshFromCache();
		paint(ICON_IDLE, ctx);
		startWatchdog();
	}

	pi.on("session_start", async (_event: unknown, ctx: any) => onSessionEvent(ctx));
	pi.on("session_switch", async (_event: unknown, ctx: any) => onSessionEvent(ctx));

	// `input` fires the moment the user hits Enter, before the model request.
	// Use it to start label-gen immediately and flip the icon to "working"
	// without waiting for `agent_start`.
	pi.on("input", async (event: any, ctx: any) => {
		paint(ICON_WORK, ctx);
		const text = typeof event?.text === "string" ? event.text : undefined;
		maybeStartLabelGen(ctx, text);
	});

	pi.on("agent_start", async (_event: unknown, ctx: any) => {
		paint(ICON_WORK, ctx);
		maybeStartLabelGen(ctx);
	});

	pi.on("agent_end", async (_event: unknown, ctx: any) => {
		paint(ICON_IDLE, ctx);
		maybeStartLabelGen(ctx);
	});

	pi.on("session_shutdown", async (_event: unknown, ctx: any) => {
		stopWatchdog();
		paint(ICON_IDLE, ctx);
	});
}
