#!/bin/sh

uglifyjs ../src/PanomNom.js -m -c sequences -c dead_code -c conditionals -c booleans -c unused -c if_return -c join_vars -c drop_console > ../build/PanomNom.min.js