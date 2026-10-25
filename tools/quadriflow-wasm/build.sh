#!/usr/bin/env bash
# Builds QuadriFlow to WebAssembly for Bozzetto Web's quad remesh.
# Needs: Emscripten (emsdk activated), git, and the Eigen 3 and Boost
# headers (EIGEN_INCLUDE and BOOST_INCLUDE, default /usr/include/eigen3 and
# /usr/include). Writes public/quadriflow/quadriflow.{mjs,wasm}.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
commit=810b7a0
work="${QF_WORK:-$here/.work}"
src="$work/quadriflow"
eigen="${EIGEN_INCLUDE:-/usr/include/eigen3}"
boost="${BOOST_INCLUDE:-/usr/include}"
out="$repo/public/quadriflow"

if [ ! -d "$src/.git" ]; then
  git clone -q https://github.com/hjwdzh/QuadriFlow "$src"
fi
git -C "$src" checkout -q "$commit"

lemon="$src/3rd/lemon-1.3.1"
mkdir -p "$work/gen/lemon"
# lemon's config header, as its CMake would write it with nothing optional.
printf '#define LEMON_VERSION "1.3.1"\n#define LEMON_HAVE_LONG_LONG 1\n' > "$work/gen/lemon/config.h"

srcs=(adjacent-matrix dedge hierarchy loader localsat merge-vertex optimizer parametrizer
      parametrizer-flip parametrizer-int parametrizer-mesh parametrizer-scale parametrizer-sing subdivide)
files=("$here/qf_wasm.cpp" "$lemon/lemon/base.cc")
for s in "${srcs[@]}"; do files+=("$src/src/$s.cpp"); done

mkdir -p "${QF_OUT:-$out}"
em++ -O3 -std=c++14 -DNDEBUG -DEIGEN_MPL2_ONLY -DEIGEN_DONT_PARALLELIZE \
  -I"$src/src" -I"$src/3rd/pcg32" -I"$src/3rd/pss" -I"$lemon" -I"$work/gen" \
  -isystem "$eigen" -isystem "$boost" \
  -Wno-deprecated-declarations -Wno-unused-result \
  "${files[@]}" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=QuadriFlow -sENVIRONMENT="${QF_ENV:-worker}" \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=8MB -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_FUNCTIONS=_qf_run -sEXPORTED_RUNTIME_METHODS=ccall,FS \
  -fexceptions \
  -o "${QF_OUT:-$out}/quadriflow.mjs"
ls -l "${QF_OUT:-$out}"
