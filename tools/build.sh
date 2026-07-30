#!/bin/bash
set -euo pipefail

# Run from the repo root regardless of where this is invoked from.
cd "$(dirname "$0")/.."

ESBUILD="npx --no-install esbuild"

# The IIFE builds need --global-name, otherwise the bundle evaluates and
# exposes nothing to the page.
$ESBUILD src/PanomNom.js --bundle --format=iife --global-name=PANOMNOM --outfile=build/PanomNom.js
$ESBUILD src/PanomNom.js --bundle --minify --format=iife --global-name=PANOMNOM --outfile=build/PanomNom.min.js
$ESBUILD src/PanomNom.js --bundle --format=esm --outfile=build/PanomNom.module.js
$ESBUILD src/PanomNom.js --bundle --minify --format=esm --outfile=build/PanomNom.module.min.js
