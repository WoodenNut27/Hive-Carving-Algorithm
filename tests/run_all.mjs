// 全言語版の突き合わせテスト
//
// 各言語版の example を同じ条件 (サイズ・並列数・シード) で "ids" 形式で実行し、
// 出力 (マップデータ) が完全に一致するかを確かめる。
// 基準は HSP3 のオリジナル (tests/hsp3_reference.hsp)。HSP3 が無い環境では JavaScript 版。
// ツールチェーンが見つからない言語は SKIP する。
//
// 使い方: node tests/run_all.mjs
//
// 環境変数 (任意):
//   HSP3_ROOT  HSP3 のインストール先 (既定 C:\hsp37)
//   JAVA_HOME  JDK のインストール先 (PATH に javac が無いとき)
//   PYTHON     Python インタープリタのパス (PATH に無いとき)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(tmpdir(), "hive-carving-tests");
const WIN = process.platform === "win32";
const EXE = WIN ? ".exe" : "";

// [width, height, parallel, seed]
const CASES = [
	[3, 3, 1, 0],
	[3, 3, 4, 9],		// 並列数 > 部屋の数
	[5, 5, 4, 2],
	[7, 5, 9, 3],
	[41, 41, 1, 7],		// 並列数 1 (= 普通の穴掘り法)
	[41, 41, 5, 1],
	[41, 41, 5, 12345],
	[41, 41, 30, 99],
	[21, 61, 8, 2024],
	[61, 21, 8, 2025],
	[99, 51, 3, 42],
	[15, 15, 200, 5],
	[81, 81, 50, 777],
	[101, 101, 20, 31337],
	[201, 201, 12, 4000000000],	// 2^31 以上のシード
];

function run(cmd, args, options = {}) {
	const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
	return { ok: r.status === 0 && !r.error, out: (r.stdout ?? "").replace(/\r\n/g, "\n"), err: (r.stderr ?? "") + (r.error ? String(r.error) : "") };
}

function which(cmd) {
	const r = spawnSync(WIN ? "where" : "which", [cmd], { encoding: "utf8" });
	if (r.status !== 0) return null;
	return r.stdout.split(/\r?\n/).find((line) => line.trim()) ?? null;
}

function fail(message) {
	return { skip: message };
}

// ---------------------------------------------------------------- 各言語の準備

function setupHsp3() {
	const root = process.env.HSP3_ROOT ?? "C:\\hsp37";
	const hspcmp = join(root, "hspcmp.exe");
	const hsp3cl = join(root, "hsp3cl.exe");
	if (!WIN || !existsSync(hspcmp) || !existsSync(hsp3cl)) return fail(`hspcmp / hsp3cl not found in ${root}`);

	const dir = join(BUILD, "hsp3");
	mkdirSync(dir, { recursive: true });
	const ax = join(dir, "hsp3_reference.ax");
	// ソースは UTF-8 なので -i を付けてコンパイルする
	const r = run(hspcmp, ["-i", `--compath=${join(root, "common")}\\`, `-o${ax}`, join(ROOT, "tests", "hsp3_reference.hsp")]);
	if (!r.ok || !existsSync(ax)) return fail(`compile failed: ${r.out}${r.err}`);
	return { run: (a) => [hsp3cl, [ax, ...a.map(String)]] };
}

function setupJavaScript() {
	return { run: (a) => [process.execPath, [join(ROOT, "JavaScript", "example.js"), ...a.map(String), "ids"]] };
}

function setupCSharp() {
	if (!which("dotnet")) return fail("dotnet not found");
	const out = join(BUILD, "csharp");
	const r = run("dotnet", ["build", join(ROOT, "C#", "Example"), "-c", "Release", "-o", out, "-nologo", "-v", "q", "--disable-build-servers"]);
	if (!r.ok) return fail(`build failed: ${r.out}${r.err}`);
	return { run: (a) => ["dotnet", [join(out, "Example.dll"), ...a.map(String), "ids"]] };
}

function setupCpp() {
	const dir = join(BUILD, "cpp");
	mkdirSync(dir, { recursive: true });
	const exe = join(dir, "example" + EXE);
	const src = join(ROOT, "C++", "example.cpp");

	for (const cxx of ["g++", "clang++"]) {
		if (!which(cxx)) continue;
		const r = run(cxx, ["-std=c++17", "-O2", "-Wall", "-Wextra", "-o", exe, src]);
		if (!r.ok) return fail(`${cxx} build failed: ${r.err}`);
		return { run: (a) => [exe, [...a.map(String), "ids"]] };
	}

	// MSVC: PATH に cl が無ければ vswhere で vcvars64.bat を探す
	const clArgs = `cl /nologo /std:c++17 /O2 /EHsc /W4 /Fe:"${exe}" /Fo:"${dir}\\\\" "${src}"`;
	let command = null;
	if (WIN && which("cl")) {
		command = clArgs;
	} else if (WIN) {
		const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
		if (existsSync(vswhere)) {
			const r = run(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"]);
			const vcvars = join(r.out.trim(), "VC", "Auxiliary", "Build", "vcvars64.bat");
			if (r.ok && existsSync(vcvars)) command = `call "${vcvars}" >nul && ${clArgs}`;
		}
	}
	if (!command) return fail("no C++ compiler found (g++ / clang++ / MSVC)");

	const r = run("cmd.exe", ["/d", "/s", "/c", `"${command}"`], { windowsVerbatimArguments: true });
	if (!r.ok || !existsSync(exe)) return fail(`MSVC build failed: ${r.out}${r.err}`);
	return { run: (a) => [exe, [...a.map(String), "ids"]] };
}

function setupJava() {
	const home = process.env.JAVA_HOME;
	const javac = home && existsSync(join(home, "bin", "javac" + EXE)) ? join(home, "bin", "javac" + EXE) : which("javac");
	const java = home && existsSync(join(home, "bin", "java" + EXE)) ? join(home, "bin", "java" + EXE) : which("java");
	if (!javac || !java) return fail("javac / java not found (set JAVA_HOME)");

	const out = join(BUILD, "java");
	const src = join(ROOT, "Java");
	const r = run(javac, ["-encoding", "UTF-8", "-d", out, join(src, "HiveCarving.java"), join(src, "Example.java")]);
	if (!r.ok) return fail(`javac failed: ${r.err}`);
	return { run: (a) => [java, ["-cp", out, "Example", ...a.map(String), "ids"]] };
}

function setupPython() {
	const candidates = WIN ? ["py", "python", "python3"] : ["python3", "python"];
	if (process.env.PYTHON) candidates.unshift(process.env.PYTHON);
	for (const py of candidates) {
		if (py !== process.env.PYTHON && !which(py)) continue;
		// Windows の「ストアを開くだけの python.exe」を除外するため、実際に動かして確かめる
		if (!run(py, ["--version"]).ok) continue;
		return { run: (a) => [py, [join(ROOT, "Python", "example.py"), ...a.map(String), "ids"]] };
	}
	return fail("python not found");
}

function setupRust() {
	if (!which("cargo")) return fail("cargo not found");
	const target = join(BUILD, "rust");
	const r = run("cargo", ["build", "--quiet", "--release", "--example", "example", "--manifest-path", join(ROOT, "Rust", "Cargo.toml"), "--target-dir", target]);
	if (!r.ok) return fail(`cargo build failed: ${r.err}`);
	const exe = join(target, "release", "examples", "example" + EXE);
	return { run: (a) => [exe, [...a.map(String), "ids"]] };
}

function setupGo() {
	if (!which("go")) return fail("go not found");
	const exe = join(BUILD, "go", "example" + EXE);
	const r = run("go", ["build", "-o", exe, "./cmd/example"], { cwd: join(ROOT, "Go") });
	if (!r.ok) return fail(`go build failed: ${r.err}`);
	return { run: (a) => [exe, [...a.map(String), "ids"]] };
}

const IMPLS = [
	["HSP3 (original)", setupHsp3],
	["JavaScript", setupJavaScript],
	["C#", setupCSharp],
	["C++", setupCpp],
	["Java", setupJava],
	["Python", setupPython],
	["Rust", setupRust],
	["Go", setupGo],
];

// ---------------------------------------------------------------- 実行

rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });

const ready = [];
for (const [name, setup] of IMPLS) {
	process.stdout.write(`setup ${name} ... `);
	const impl = setup();
	if (impl.skip) {
		console.log(`SKIP (${impl.skip.trim().split("\n")[0]})`);
	} else {
		console.log("ok");
		ready.push({ name, ...impl, pass: 0, fails: [] });
	}
}
console.log();

const reference = ready[0];
console.log(`reference: ${reference.name}\n`);

for (const c of CASES) {
	const label = `${c[0]}x${c[1]} parallel=${c[2]} seed=${c[3]}`;
	const outputs = ready.map((impl) => {
		const [cmd, args] = impl.run(c);
		return run(cmd, args);
	});
	const expected = outputs[0];
	if (!expected.ok || expected.out.trim().split("\n").length !== c[1]) {
		console.log(`ERROR ${label}: reference failed\n${expected.err}`);
		process.exitCode = 1;
		continue;
	}
	const marks = ready.map((impl, i) => {
		const r = outputs[i];
		const same = r.ok && r.out.trimEnd() === expected.out.trimEnd();
		if (same) impl.pass++;
		else impl.fails.push(`${label}${r.ok ? "" : `: ${r.err.trim().split("\n")[0]}`}`);
		return `${impl.name}:${same ? "OK" : "NG"}`;
	});
	console.log(`${label.padEnd(36)} ${marks.join("  ")}`);
}

console.log();
for (const impl of ready) {
	console.log(`${impl.name.padEnd(16)} ${impl.pass}/${CASES.length} passed`);
	for (const f of impl.fails) console.log(`  NG: ${f}`);
	if (impl.fails.length) process.exitCode = 1;
}
