#!/bin/bash
# Build the emflow UMD bundle (global EMFlow, React included, see the 'lib'
# section of vite.config.ts) and copy it into EMhub's static libs:
#   dist/emflow.js  -> $EMHUB_LIBS/js/emflow.js
#   dist/emflow.css -> $EMHUB_LIBS/css/emflow.css
#
# emflow lives at the root of the EMhub repository, so EMHUB_LIBS defaults to
# <emhub repo>/emhub/static/libs; override it if needed:
#   EMHUB_LIBS=/path/to/emhub/emhub/static/libs ./build_and_copy.sh

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
EMHUB_LIBS="${EMHUB_LIBS:-$HERE/../emhub/static/libs}"

BOLD='\033[1m'
NORMAL='\033[0m'

# Echo the command and arguments in bold and then execute it
run_cmd() {
  echo -e "- ${BOLD} $@ ${NORMAL}"
  "$@"
}

if [ ! -d "$EMHUB_LIBS" ]; then
  echo "EMhub libs folder not found: $EMHUB_LIBS (set EMHUB_LIBS)" >&2
  exit 1
fi

cd "$HERE"
[ -d node_modules ] || run_cmd npm ci
# vite build does not type check
run_cmd npm run typecheck
run_cmd npm run build

# The UMD wrapper defines the EMFlow global in the first bytes of the bundle
if ! head -c 500 dist/emflow.js | grep -q 'EMFlow'; then
  echo "dist/emflow.js is not the UMD bundle (no EMFlow global)" >&2
  exit 1
fi

run_cmd cp dist/emflow.js "$EMHUB_LIBS/js/"
run_cmd cp dist/emflow.css "$EMHUB_LIBS/css/"
