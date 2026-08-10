#!/usr/bin/env sh
set -eu

find .github/workflows -type f \( -name '*.yml' -o -name '*.yaml' \) -exec awk '
  /uses:[[:space:]]+[^[:space:]#]+@/ {
    reference = $0
    sub(/^.*uses:[[:space:]]+[^[:space:]#]+@/, "", reference)
    sub(/[[:space:]#].*$/, "", reference)
    if (reference !~ /^[0-9a-f]{40}$/) {
      print FILENAME ":" FNR ": GitHub Action must use a full 40-character commit SHA: " reference > "/dev/stderr"
      violations = 1
    }
  }
  END { if (violations) exit 1 }
' {} +

echo 'GitHub Action references are pinned to immutable commit SHAs.'
