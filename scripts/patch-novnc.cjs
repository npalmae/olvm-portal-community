// Patch noVNC to work with Next.js bundler
const fs = require("fs");
const path = require("path");

const novncDir = path.join(__dirname, "..", "node_modules", "@novnc", "novnc");

if (!fs.existsSync(novncDir)) {
  console.log("[patch-novnc] @novnc/novnc not found, skipping");
  process.exit(0);
}

// Patch package.json to not use "type": "module"
const pkgPath = path.join(novncDir, "package.json");
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (pkg.type === "module") {
    delete pkg.type;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log("[patch-novnc] Removed 'type: module' from package.json");
  }
}

console.log("[patch-novnc] Done");
