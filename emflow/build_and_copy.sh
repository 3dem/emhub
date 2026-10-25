#!/bin/bash
# Build the emflow bundle and copy it into EMhub's static libs:
#   dist/emflow.js  -> $EMHUB_LIBS/js/emflow.js
#   dist/emflow.css -> $EMHUB_LIBS/css/emflow.css
#
# EMHUB_LIBS defaults to the EMhub checkout next to this repo
# (emhub-otf/emhub/emhub/static/libs); override it if needed:
#   EMHUB_LIBS=/path/to/emhub/emhub/static/libs ./build_and_copy.sh

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
EMHUB_LIBS="${EMHUB_LIBS:-$HERE/../emhub/emhub/static/libs}"

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
[ -d node_modules ] || run_cmd npm install
run_cmd npm run build

run_cmd cp dist/emflow.js "$EMHUB_LIBS/js/"
run_cmd cp dist/emflow.css "$EMHUB_LIBS/css/"
