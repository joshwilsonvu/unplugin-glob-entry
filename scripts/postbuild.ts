import { basename, dirname, resolve } from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { globby } from "globby";

// fix cjs exports
const files = await globby("*.cjs", {
	ignore: ["chunk-*"],
	absolute: true,
	cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../dist"),
});
for (const file of files) {
	console.log(` POST  Fix ${basename(file)}`);
	let code = await fs.readFile(file, "utf8");
	code = code.replace("exports.default =", "module.exports =");
	code += "exports.default = module.exports;";
	await fs.writeFile(file, code);
}
