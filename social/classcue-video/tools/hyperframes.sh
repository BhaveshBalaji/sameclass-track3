#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/tools:$PATH"
task_node="$(command -v node)"
task_major="$($task_node -p 'process.versions.node.split(".")[0]')"
if [ "$task_major" -lt 22 ]; then
  task_bundled_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  if [ -x "$task_bundled_node" ]; then task_node="$task_bundled_node"; fi
fi
task_ffmpeg_dir="$($task_node -p 'require("path").dirname(require("ffmpeg-static"))')"
task_ffprobe_dir="$($task_node -p 'require("path").dirname(require("ffprobe-static").path)')"
export PATH="$task_ffmpeg_dir:$task_ffprobe_dir:$PATH"
exec "$task_node" node_modules/hyperframes/dist/cli.js "$@"
