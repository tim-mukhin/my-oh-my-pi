# my-oh-my-pi

Personal config for [`omp`](https://github.com/oh-my-pi/pi-coding-agent) (`@oh-my-pi/pi-coding-agent`) and [`pi`](https://github.com/mariozechner/pi-coding-agent) (`@mariozechner/pi-coding-agent`): terminal tab title with status icon + LLM-generated session label.

By analogy with [`my-claude-code`](../my-claude-code/), [`my-opencode`](../my-opencode/), [`my-copilot-cli`](../my-copilot-cli/) — same idea, two more hosts.

## What you get

```
⋯ 🧠 Анализ сессий       <- agent is working
✳ 🧠 Анализ сессий       <- idle, ready for input
⋯ π · second_brain       <- right after start, before the label is generated
```

Status icons:

- `⋯` working
- `✳` idle, ready for input

The label (emoji + 2-4 words) is generated once per session by a background `omp -p` / `pi -p` call using the configured smol model. Cached on disk so it doesn't regenerate when you switch sessions.

Language follows your first message: Russian message → Russian label, English → English. Etc.

## How it works

Both hosts expose a first-class extension API (`ExtensionAPI`) with the same shape:

| Event           | What we do                                                           |
| --------------- | -------------------------------------------------------------------- |
| `session_start` | Paint `✳ π · <cwd>` (or cached label). Start watchdog (pi only).     |
| `session_switch`| Same.                                                                |
| `agent_start`   | Paint `⋯` (working). Spawn label-gen subprocess if no label yet.     |
| `agent_end`     | Paint `✳` (idle). Repaint with label if it just arrived.             |
| `session_shutdown` | Paint `✳`, stop watchdog.                                          |

Title is set via `ctx.ui.setTitle(...)` which both hosts route through their TUI's terminal-title writer (OSC 0).

## The PI_NO_TITLE / watchdog story

Both hosts write the tab title themselves on session events. Without disabling that, our title flickers and gets overwritten.

- **omp** has `--no-title` and reads `PI_NO_TITLE=1` from the env. The install script appends `export PI_NO_TITLE=1` to your shell rc.
- **pi** has no such knob: it calls `updateTerminalTitle()` from `interactive-mode.js` at session-bind and a few other points, with no way to suppress. The pi extension uses a low-frequency watchdog (re-paints every 800 ms) to win the race. Cost: trivial.

## Installation

```bash
git clone <this-repo> ~/projects/my-oh-my-pi
cd ~/projects/my-oh-my-pi
./install.sh
```

This:

1. Copies `src/tab-title.ts` + `ext/omp/index.ts` into `~/.omp/agent/extensions/tab-title/`.
2. Same for `~/.pi/agent/extensions/tab-title/`.
3. Appends `export PI_NO_TITLE=1` to `~/.zshrc` (override with `SHELL_RC=path/to/rc ./install.sh`).

Open a fresh terminal, then start omp or pi as usual. Subagent / RPC sessions (with no UI) get a no-op `setTitle` from the host, so they don't hijack the tab.

## Files

| File                  | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `src/tab-title.ts`    | Shared core: status icon, label cache, label-gen subprocess, watchdog.  |
| `ext/omp/index.ts`    | omp wrapper: imports `@oh-my-pi/pi-coding-agent` types, no watchdog.    |
| `ext/pi/index.ts`     | pi wrapper: imports `@mariozechner/pi-coding-agent` types, watchdog on. |
| `install.sh`          | Copy core + wrapper into each host's extension dir, set env var.        |

Logs (label-gen errors, setTitle errors):

- `~/.omp/agent/.cache/tab-titles/tab-title.log`
- `~/.pi/agent/.cache/tab-titles/tab-title.log`

Cache (per-session generated labels):

- `~/.omp/agent/.cache/tab-titles/<sid>.label.txt`
- `~/.pi/agent/.cache/tab-titles/<sid>.label.txt`

## Customization

- **Icons** — edit `ICON_WORK`, `ICON_IDLE` in `src/tab-title.ts`.
- **Label prompt / language behavior** — `LABEL_SYSTEM_PROMPT` in `src/tab-title.ts`.
- **Label model** — defaults to `claude-sonnet-4.5`. The dynamic default (haiku-4.5) currently 400s on github-copilot when MCP tool definitions leak into the label-gen request, so we pin sonnet. Override with the `TAB_TITLE_MODEL` env var, e.g. `export TAB_TITLE_MODEL=claude-opus-4.5`.
- **Watchdog interval (pi)** — `repaintIntervalMs` in `ext/pi/index.ts`. 800 ms is comfortable; raise to 1500 if you want fewer wakes.

## Uninstall

```bash
rm -rf ~/.omp/agent/extensions/tab-title ~/.pi/agent/extensions/tab-title
# remove the `export PI_NO_TITLE=1` line from ~/.zshrc
```

## Compared to my-claude-code, my-opencode, my-copilot-cli

| Host         | Title API                       | Disable host title via    | Label-gen        | Status icon source   |
| ------------ | ------------------------------- | ------------------------- | ---------------- | -------------------- |
| Claude Code  | shell hook writes OSC 0         | n/a (we own it)           | `claude --print` | jsonl tail watcher   |
| OpenCode     | plugin (`@opencode-ai/plugin`)  | unset shell title trick   | `opencode run`   | plugin events        |
| Copilot CLI  | watcher + hook                  | settings.json             | `copilot -p`     | events.jsonl watcher |
| **omp**      | extension `ctx.ui.setTitle()`   | `PI_NO_TITLE=1`           | `omp -p`         | extension events     |
| **pi**       | extension `ctx.ui.setTitle()`   | watchdog re-paint         | `pi -p`          | extension events     |
