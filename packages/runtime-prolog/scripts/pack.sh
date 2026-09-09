#!/usr/bin/env sh
set -eu
mkdir -p dist
# Ship source so each supported SWI-Prolog version compiles its own bytecode.
tar --exclude='*.qlf' -czf dist/copilotkit_runtime-0.1.0.tgz pack.pl LICENSE README.md prolog examples/server.pl
pack_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/cpki-prolog-pack.XXXXXX")
export CPK_PROLOG_PACK_TEST_DIR="$pack_test_dir"
trap 'rm -rf -- "$pack_test_dir"' EXIT
swipl --on-error=status --on-warning=status -q -g "use_module(library(prolog_pack)),getenv('CPK_PROLOG_PACK_TEST_DIR',Directory),pack_install('dist/copilotkit_runtime-0.1.0.tgz',[package_directory(Directory),interactive(false)]),halt"
swipl --on-error=status --on-warning=status -q -g "getenv('CPK_PROLOG_PACK_TEST_DIR',Directory),attach_packs(Directory),use_module(library(copilotkit_runtime)),load_files('examples/server.pl',[silent(true)]),halt"
