#!/usr/bin/env bash
# Keep one comment on the pull request listing the changes no test caught, and
# delete it once every one is caught. Each language's mutation job writes its
# lived.txt (one "file:line  status: change" row per change) and tally.txt
# ("3 of 10" caught) to a directory; this merges the directories it's given.
# A directory with no results counts as nothing to mutate.
# Usage: scripts/mutants-comment.sh DIR...
# Needs GH_TOKEN, GITHUB_REPOSITORY, PR and RUN; FORK=true only summarizes.
set -euo pipefail
(($#)) || { echo 'Usage: scripts/mutants-comment.sh DIR...' >&2; exit 2; }
marker='<!-- mutants -->'
lived=$(for dir in "$@"; do cat "$dir/lived.txt" 2>/dev/null || true; done)
tally=$(for dir in "$@"; do cat "$dir/tally.txt" 2>/dev/null || true; done |
  awk '{ caught += $1; total += $3 } END { print caught + 0 " of " total + 0 }')
body="$marker
**Mutation testing:** $tally changes caught by a test.

\`\`\`
$lived
\`\`\`

Each one is a change to the code no test noticed. Not a blocker: real gaps get their own PR. [Full report]($RUN)"
# Keep complete lines and balance the fence before linking the artifact.
if (( $(LC_ALL=C printf '%s' "$body" | wc -c) > 60000 )); then
  body=$(LC_ALL=C awk 'BEGIN { size = 0; fenced = 0 } {
    if (size + length($0) + 1 > 58000) exit
    print; size += length($0) + 1
    if ($0 ~ /^```/) fenced = !fenced
  } END { if (fenced) print "```" }' <<< "$body")
  body+=$'\n\n'"Report trimmed. [Full report artifact]($RUN#artifacts)"
fi
[[ -z $lived ]] || printf '%s\n' "$body" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
[[ ${FORK:-false} != true ]] || exit 0
old=$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$PR/comments" \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\"))) | .id" | head -n 1)
if [[ -z $lived ]]; then
  if [[ -n $old ]]; then gh api -X DELETE "repos/$GITHUB_REPOSITORY/issues/comments/$old"; fi
elif [[ -n $old ]]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$old" -f body="$body" >/dev/null
else
  gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" -f body="$body" >/dev/null
fi
