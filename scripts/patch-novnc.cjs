const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "node_modules",
  "@novnc",
  "novnc",
  "lib",
  "util",
  "browser.js",
);

if (!fs.existsSync(target)) {
  console.log(`[patch-novnc] skipped: ${target} not found`);
  process.exit(0);
}

const source = fs.readFileSync(target, "utf8");
const needle =
  "exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();";

if (!source.includes(needle)) {
  console.log("[patch-novnc] skipped: target line not found");
  process.exit(0);
}

const replacement = [
  "exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = false;",
  "_checkWebCodecsH264DecodeSupport().then(function (value) {",
  "  exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = value;",
  "}).catch(function () {",
  "  exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = false;",
  "});",
].join("\n");

fs.writeFileSync(target, source.replace(needle, replacement), "utf8");
console.log("[patch-novnc] patched browser.js");
