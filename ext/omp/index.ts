/**
 * omp tab-title extension.
 *
 * Installed to ~/.omp/agent/extensions/tab-title/index.ts (auto-discovered).
 *
 * Disable omp's built-in title with `--no-title` or `PI_NO_TITLE=1` so this
 * extension is the only writer of the terminal title. The install script adds
 * `export PI_NO_TITLE=1` to your shell rc.
 *
 * Note: label generation always shells out to `pi -p`, not `omp -p`. omp's
 * non-interactive mode currently leaks MCP tool definitions into the request
 * even with --no-tools, which 400s on github-copilot/claude-haiku-4.5. pi is
 * a minimal CLI that just works for this. Override the binary with the
 * TAB_TITLE_BIN env var if you really want to.
 */

import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { installTabTitle } from "./tab-title.js";

const HOME = os.homedir();
const CACHE_DIR = path.join(HOME, ".omp", "agent", ".cache", "tab-titles");
const LOG_FILE = path.join(CACHE_DIR, "tab-title.log");

export default function (pi: ExtensionAPI) {
	pi.logger?.info?.("tab-title extension: loaded (host=omp)");
	installTabTitle(pi as any, {
		hostBrand: "π",
		hostBin: process.env.TAB_TITLE_BIN || "pi",
		cacheDir: CACHE_DIR,
		labelModel: process.env.TAB_TITLE_MODEL, // undefined -> pi picks its default
		logFile: LOG_FILE,
		// omp respects PI_NO_TITLE — no watchdog needed.
	});
}
