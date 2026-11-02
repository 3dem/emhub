#!/bin/bash
# Toggle git tracking of the emflow bundle files in EMhub's static libs:
#   emhub/static/libs/js/emflow.js
#   emhub/static/libs/css/emflow.css
#
# Usage:
#   ./track.sh on|true|1    -> git update-index --no-assume-unchanged
#   ./track.sh off|false|0  -> git update-index --assume-unchanged

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"

BOLD='\033[1m'
NORMAL='\033[0m'

# Echo the command and arguments in bold and then execute it
run_cmd() {
  echo -e "- ${BOLD} $@ ${NORMAL}"
  "$@"
}

usage() {
  echo "Usage: $0 on|off|true|false|1|0"
  exit 1
}

[ $# -eq 1 ] || usage

case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
  on|true|1)   FLAG=--no-assume-unchanged ;;
  off|false|0) FLAG=--assume-unchanged ;;
  *)           usage ;;
esac

cd "$HERE/../"

run_cmd git update-index $FLAG emhub/static/libs/css/emflow.css emhub/static/libs/js/emflow.js
