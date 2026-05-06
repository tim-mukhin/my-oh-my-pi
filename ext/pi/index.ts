/**
 * pi tab-title extension.
 *
 * Installed to ~/.pi/agent/extensions/tab-title/index.ts (auto-discovered).
 *
 * pi has no `--no-title` knob: it calls `updateTerminalTitle()` from
 * interactive-mode internals at session start/switch and elsewhere. We can't
 * suppress those calls, so we re-assert our title on a low-frequency watchdog
 * (~800 ms) to win the race.
 */

import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { installTabTitle } from "./tab-title.js";

const HOME = os.homedir();
const CACHE_DIR = path.join(HOME, ".pi", "agent", ".cache", "tab-titles");
const LOG_FILE = path.join(CACHE_DIR, "tab-title.log");

export default function (pi: ExtensionAPI) {
	pi.logger?.info?.("tab-title extension: loaded (host=pi)");
	installTabTitle(pi as any, {
		hostBrand: "π",
		hostBin: process.env.TAB_TITLE_BIN || "pi",
		cacheDir: CACHE_DIR,
		labelModel: process.env.TAB_TITLE_MODEL, // undefined -> pi picks its default
		logFile: LOG_FILE,
		repaintIntervalMs: 800,
	});
}
