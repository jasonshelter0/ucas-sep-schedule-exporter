#!/usr/bin/env node

/**
 * Ensures tsify no longer relies on the deprecated util._extend helper.
 * The stock package reintroduces util._extend every npm install, so we
 * rewrite the require when needed.
 */

const fs = require("fs")
const path = require("path")

const filePath = path.join(__dirname, "..", "node_modules", "tsify", "lib", "Tsifier.js")
const legacyLine = "var extend   = require('util')._extend;"
const replacement = [
    "var extend   = Object.assign || function (target) {",
    "\tif (!target) { target = {}; }",
    "\tfor (var i = 1; i < arguments.length; i++) {",
    "\t\tvar source = arguments[i];",
    "\t\tif (!source) { continue; }",
    "\t\tvar keys = Object.keys(source);",
    "\t\tfor (var j = 0; j < keys.length; j++) {",
    "\t\t\tvar key = keys[j];",
    "\t\t\ttarget[key] = source[key];",
    "\t\t}",
    "\t}",
    "\treturn target;",
    "};",
].join("\n")

function main() {
    if (!fs.existsSync(filePath)) {
        console.warn("[tsify patch] skipped: file not found at", filePath)
        return
    }

    const source = fs.readFileSync(filePath, "utf8")
    if (source.includes(replacement)) {
        console.log("[tsify patch] already applied")
        return
    }
    if (!source.includes(legacyLine)) {
        console.warn("[tsify patch] no legacy util._extend usage detected")
        return
    }

    const updated = source.replace(legacyLine, replacement)
    fs.writeFileSync(filePath, updated, "utf8")
    console.log("[tsify patch] util._extend usage replaced with Object.assign fallback")
}

main()
