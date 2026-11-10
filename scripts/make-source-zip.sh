#!/usr/bin/env bash
# Builds a clean source archive for upload. Tracked files only, from HEAD.
# Never includes node_modules, .env files, .git, artifacts, dist, or tsbuildinfo.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "pack:source: the working tree has uncommitted changes. The archive is built from HEAD and will not include them." >&2
fi

head_sha="$(git rev-parse HEAD)"
tree_sha="$(git rev-parse 'HEAD^{tree}')"
short="$(git rev-parse --short HEAD)"
mkdir -p dist
out="dist/two-key-source-${short}.zip"
rm -f "$out"

required=(LICENSE README.md package.json package-lock.json app lib convex docs scripts public)
for path in "${required[@]}"; do
  if ! git cat-file -e "HEAD:${path}" 2>/dev/null; then
    echo "pack:source: ${path} is not committed at HEAD." >&2
    exit 1
  fi
done

# Tracked files minus anything that must never ship.
mapfile -t files < <(git ls-tree -r --name-only HEAD | grep -Ev '(^|/)node_modules/|(^|/)\.env($|\.)|^artifacts/|^dist/|\.tsbuildinfo$|^\.next/' ; git ls-tree -r --name-only HEAD | grep -E '(^|/)\.env\.example$' || true)
mapfile -t files < <(printf '%s\n' "${files[@]}" | sort -u)

git archive --format=zip --prefix=two-key/ -o "$out" HEAD -- "${files[@]}"

if unzip -l "$out" | grep -E 'two-key/(\.env($|\.[^e])|node_modules/|artifacts/|\.git/)' >/dev/null; then
  echo "pack:source: refusing archive, it contains an excluded path." >&2
  rm -f "$out"
  exit 1
fi

count="$(unzip -Z1 "$out" | grep -vc '/$')"
sum="$(sha256sum "$out" | cut -d' ' -f1)"
echo "archive: $out"
echo "files: $count"
echo "head: $head_sha"
echo "tree: $tree_sha"
echo "sha256: $sum"
echo "after unpack: cd two-key && npm ci && npm run demo   (Node >= 20.9, tested on Node 22)"
