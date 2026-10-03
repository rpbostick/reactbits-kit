#!/usr/bin/env bash
# Puts a React Bits checkout at the kit's pinned commit in .upstream/ (git-ignored)
# for the tests, which read upstream files from it instead of the network.
# Only src/ts-default and the top-level files are checked out: the rest of the
# repository has test files of its own that `node --test` would otherwise run.
set -euo pipefail
cd "$(dirname "$0")/.."

commit=$(node --input-type=module -e "import { PINNED_COMMIT } from './src/upstream.ts'; console.log(PINNED_COMMIT)")

if [ ! -d .upstream/.git ]; then
  git clone --filter=blob:none --no-checkout https://github.com/DavidHDev/react-bits .upstream
fi
git -C .upstream sparse-checkout set src/ts-default
if ! git -C .upstream cat-file -e "${commit}^{commit}" 2>/dev/null; then
  git -C .upstream fetch origin
fi
git -C .upstream checkout --quiet --detach "$commit"
echo "React Bits at $commit in .upstream/"
