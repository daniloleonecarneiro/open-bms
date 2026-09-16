#!/bin/bash
# Regression tests for the failure paths of verify-web-push-install.sh.
#
# Usage: scripts/verify-web-push-install.test.sh
# Exit: 0 all cases passed, 1 otherwise. No network access: every case must stop
# before the first request.

set -uo pipefail

SCRIPT="$(dirname "$0")/verify-web-push-install.sh"
SITE="http://127.0.0.1:9"
FALHAS=0

# run <expected-exit> <expected-stderr-substring> [env assignments...] -- <args...>
run() {
  local esperado="$1" mensagem="$2"
  shift 2
  local envs=()
  while [[ "$1" != "--" ]]; do
    envs+=("$1")
    shift
  done
  shift

  local saida codigo
  saida="$(env "${envs[@]}" timeout 5 bash "$SCRIPT" "$@" 2>&1 >/dev/null)"
  codigo=$?

  local caso="$* ${envs[*]}"
  if [[ "$codigo" -eq 124 ]]; then
    echo "falha: [$caso] não terminou em 5s"
    FALHAS=$((FALHAS + 1))
  elif [[ "$codigo" -ne "$esperado" ]]; then
    echo "falha: [$caso] exit $codigo, esperado $esperado"
    FALHAS=$((FALHAS + 1))
  elif [[ "$saida" != *"$mensagem"* ]]; then
    echo "falha: [$caso] stderr sem \"$mensagem\": $saida"
    FALHAS=$((FALHAS + 1))
  else
    echo "ok:    [$caso]"
  fi
}

run 2 "--account exige um valor" -- "$SITE" --account
run 2 "--page exige um valor" -- "$SITE" --page
run 2 "--account exige um valor" -- "$SITE" --account ""
run 2 "--account exige um valor" -- "$SITE" --account --page "$SITE/noticias"
run 2 "--page exige um valor" -- "$SITE" --account 2 --page
run 1 "diretório temporário" TMPDIR=/nonexistent/verify-web-push -- "$SITE"

echo
if [[ "$FALHAS" -eq 0 ]]; then
  echo "tudo certo."
  exit 0
fi
echo "$FALHAS caso(s) falharam."
exit 1
