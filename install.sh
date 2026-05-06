#!/usr/bin/env bash
# Install tab-title extensions for omp and pi.
#
# Layout after install:
#   ~/.omp/agent/extensions/tab-title/{index.ts, tab-title.ts}
#   ~/.pi/agent/extensions/tab-title/{index.ts, tab-title.ts}
#
# Also appends `export PI_NO_TITLE=1` to your shell rc (~/.zshrc by default)
# so omp doesn't fight the extension over the title. (pi has no equivalent
# knob; the pi extension uses a watchdog instead.)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHELL_RC="${SHELL_RC:-$HOME/.zshrc}"

install_one() {
	local host="$1"     # omp | pi
	local home_dir="$2" # ~/.omp/agent | ~/.pi/agent
	local dest="$home_dir/extensions/tab-title"
	mkdir -p "$dest"
	cp -f "$REPO_DIR/src/tab-title.ts" "$dest/tab-title.ts"
	cp -f "$REPO_DIR/ext/$host/index.ts" "$dest/index.ts"
	cp -f "$REPO_DIR/ext/$host/package.json" "$dest/package.json"
	echo "  installed: $dest"
}

echo "Installing tab-title extension..."
install_one omp "$HOME/.omp/agent"
install_one pi  "$HOME/.pi/agent"

# Append PI_NO_TITLE=1 to shell rc if not already present.
if [ -f "$SHELL_RC" ]; then
	if grep -q '^export PI_NO_TITLE=' "$SHELL_RC"; then
		echo "  $SHELL_RC: PI_NO_TITLE already set, skipping"
	else
		printf '\n# Disable omp built-in tab title (managed by my-oh-my-pi extension)\nexport PI_NO_TITLE=1\n' >> "$SHELL_RC"
		echo "  $SHELL_RC: appended 'export PI_NO_TITLE=1'"
	fi
else
	echo "  WARN: $SHELL_RC not found; set 'export PI_NO_TITLE=1' manually"
fi

cat <<EOF

Done.

Next steps:
  1. Open a NEW terminal (or run: source $SHELL_RC) to pick up PI_NO_TITLE=1.
  2. Start omp/pi as usual; the title will become:
       \`⋯ π · <cwd>\`         (right after start, while label is generating)
       \`⋯ <emoji> <label>\`   (working)
       \`✳ <emoji> <label>\`   (idle, ready for input)
  3. Logs: ~/.omp/agent/.cache/tab-titles/tab-title.log
           ~/.pi/agent/.cache/tab-titles/tab-title.log

To uninstall:
  rm -rf ~/.omp/agent/extensions/tab-title ~/.pi/agent/extensions/tab-title
  # and remove the PI_NO_TITLE line from $SHELL_RC
EOF
