#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: install what the
# typechecks, the build and the tests need. Does nothing on a local machine.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# As CI installs, without install scripts. npm install rather than npm ci, so
# a cached node_modules is reused; --no-save, so a different npm version does
# not rewrite package-lock.json.
npm install --ignore-scripts --no-audit --no-fund --no-save

# build:test has no prebuild hook: make the generated demo assets, as
# npm run build does.
node scripts/generate-sample.mjs
