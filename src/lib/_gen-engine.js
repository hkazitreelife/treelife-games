
const fs = require("fs");
const code = fs.readFileSync("_gen-engine.js", "utf8");
// Extract the engine code between markers
const start = code.indexOf("/*  Pixel Soccer");
const end = code.indexOf("module.exports") + code.substring(code.indexOf("module.exports")).indexOf("};") + 2;
fs.writeFileSync("src/lib/pixel-soccer-engine.js", code.substring(start, end));
console.log("done");
