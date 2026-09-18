import { readFile } from "node:fs/promises";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const base = new URL("../src", import.meta.url).pathname;
const source = await readFile(`${base}/styles.css`, "utf8");
const compiler = await compile(source.replace(/@import url\([^)]*\);/g, ""), {
  base,
  onDependency() {},
});
const scanner = new Scanner({
  sources: [{ base, pattern: "**/*.{ts,tsx}", negated: false }],
});
process.stdout.write(compiler.build(scanner.scan()));
