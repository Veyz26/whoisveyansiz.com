#!/bin/sh
# Commits the built site in out/ to the `deploy` branch, which Hostinger's Git deployment
# (hPanel → Advanced → Git) copies into public_html. Hostinger runs no build step, so the
# branch holds exactly the files to serve, dotfiles (.htaccess) included.
# History is kept (one commit per deploy), so a normal `git pull` on the server always works.
#
# Usage: scripts/publish-deploy-branch.sh <remote-url> [branch]   (run from the repo root, after npm run build)
set -eu
remote="$1"
branch="${2:-deploy}"
src="$(pwd)/out"
[ -f "$src/index.html" ] || { echo "publish: no build in out/ (run npm run build first)" >&2; exit 1; }
sha="$(git rev-parse --short HEAD)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q -b "$branch"
git remote add origin "$remote"
if git fetch -q --depth 1 origin "$branch" 2>/dev/null; then
  git reset -q --soft FETCH_HEAD        # continue the branch; the next add -A records deletions too
fi
cp -a "$src/." .
git add -A
if git diff --cached --quiet; then
  echo "publish: $branch already matches this build"
  exit 0
fi
git -c user.name="${GIT_AUTHOR_NAME:-deploy-bot}" -c user.email="${GIT_AUTHOR_EMAIL:-deploy-bot@users.noreply.github.com}" \
  commit -q -m "Deploy $sha"
git push -q origin "$branch"
echo "publish: pushed build of $sha to $branch"
