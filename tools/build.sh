#!/bin/bash

esbuild ../src/PanomNom.js --bundle --format=iife --outfile=../build/PanomNom.js
esbuild ../src/PanomNom.js --bundle --minify --format=iife --outfile=../build/PanomNom.min.js
esbuild ../src/PanomNom.js --bundle --format=esm --outfile=../build/PanomNom.module.js
esbuild ../src/PanomNom.js --bundle --minify --format=esm --outfile=../build/PanomNom.module.min.js