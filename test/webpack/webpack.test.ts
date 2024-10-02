import { promisify } from "node:util";
import { Console } from "node:console";
import { Writable } from "node:stream";

import { expect, test, onTestFinished } from "vitest";
import { fs, vol } from "memfs";

import webpack from "webpack";
import merge from "webpack-merge";
import * as esModuleLexer from "es-module-lexer";
import GlobEntryPlugin from "../../src/webpack";

const mockConsole = new Console(new Writable());

const config: webpack.Configuration = {
	context: "/app",
	entry: {},
	output: {
		clean: true,
		path: "/dist",
		publicPath: "/",
		module: true,
		// enabledChunkLoadingTypes: ["import"],
		// chunkLoading: "import",
	},
	plugins: [GlobEntryPlugin({ patterns: "*.entry.js" })],
	infrastructureLogging: {
		console: mockConsole,
	},
	cache: false,
	experiments: {
		outputModule: true,
	},
};

interface Setup extends webpack.Configuration {
	files?: Record<string, string>;
}
function setup({ files, ...extendConfig }: Setup = {}) {
	vol.fromJSON(
		files ?? {
			"a.entry.js": "console.log('a'); export default 'a';",
			"b.entry.js": "console.log('b'); export default 'b';",
		},
		"/app",
	);
	const extendedConfig = merge(config, extendConfig);

	const compiler = webpack(extendedConfig);
	compiler.inputFileSystem = fs as any;
	compiler.outputFileSystem = fs as any;

	onTestFinished(() => {
		vol.reset();
		return new Promise((resolve) => compiler.close(() => resolve()));
	});

	const run = promisify(compiler.run.bind(compiler));

	return run;
}

function checkStats(stats?: webpack.Stats): asserts stats {
	expect(stats).toBeDefined();
	if (stats?.hasErrors()) {
		const { errors } = stats.toJson({
			all: false,
			errors: true,
			errorDetails: true,
			errorStack: true,
		});
		expect.soft(errors).toEqual([]);
	}
}

test("doesn't crash", async () => {
	const run = setup();
	const stats = await run();
	checkStats(stats);
});

test("includes correct entrypoints", async () => {
	const run = setup();
	const stats = await run();
	checkStats(stats);

	const { entrypoints } = stats.toJson({ all: false, entrypoints: true });
	expect(Object.keys(entrypoints!).toSorted()).toEqual([
		"a.entry.js",
		"b.entry.js",
	]);
});

test("emits correct assets", async () => {
	const run = setup();
	const stats = await run();
	checkStats(stats);

	const { assets } = stats.toJson({
		all: false,
		assets: true,
	});
	expect(assets?.map((asset) => asset.name).toSorted()).toEqual([
		"a.entry.js.mjs",
		"b.entry.js.mjs",
		"importmap.json",
	]);
});

test("emits correct import map", async () => {
	const run = setup();
	const stats = await run();
	checkStats(stats);

	const importmap = JSON.parse(
		(await fs.promises.readFile("/dist/importmap.json")).toString("utf-8"),
	);
	expect(importmap).toStrictEqual({
		imports: {
			"a.entry.js": "/a.entry.js.mjs",
			"b.entry.js": "/b.entry.js.mjs",
		},
	});
});

test("emitted files preserve exports", async () => {
	const run = setup();

	const stats = await run(); // ?.toJson();
	checkStats(stats);

	const { assets, entrypoints } = stats.toJson({
		all: false,
		assets: true,
		entrypoints: true,
	});
	const entryForA = entrypoints?.["a.entry.js"];
	expect(entryForA?.assets).toHaveProperty("length", 1);

	const assetForA = assets?.find(
		(asset) => asset.name === entryForA!.assets![0].name,
	);
	expect(assetForA).toBeDefined();

	const distA = (
		await fs.promises.readFile(`/dist/${assetForA!.name}`)
	).toString("utf-8");

	await esModuleLexer.init;
	const [, exports, , hasModuleSyntax] = esModuleLexer.parse(
		distA,
		assetForA!.name,
	);

	// the format could change; just ensure it's actually ESM and has a default export
	expect
		.soft(distA)
		.toMatchInlineSnapshot(
			`"var e={d:(o,r)=>{for(var a in r)e.o(r,a)&&!e.o(o,a)&&Object.defineProperty(o,a,{enumerable:!0,get:r[a]})},o:(e,o)=>Object.prototype.hasOwnProperty.call(e,o)},o={};e.d(o,{A:()=>r}),console.log("a");const r="a";var a=o.A;export{a as default};"`,
		);
	expect(hasModuleSyntax).toBe(true);
	expect(exports[0]).toHaveProperty("n", "default"); // n=name
	expect(distA).toMatch(/console\.log\(['"]a['"]\)/);
});
