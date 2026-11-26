// 使い方: node example.js [width=41] [height=41] [parallel=5] [seed=random] [format=text|ids]
//   text : 迷路を "##" (壁) と "  " (通路) で出力
//   ids  : マップデータ (0=壁, 1～=プロセス番号) を空白区切りで出力 (各言語版の突き合わせ用)
import { HiveCarving, randomSeed } from "./hive-carving.js";

const args = process.argv.slice(2);
const width = Number(args[0] ?? 41);
const height = Number(args[1] ?? 41);
const parallel = Number(args[2] ?? 5);
const seed = args[3] === undefined || args[3] === "random" ? randomSeed() : Number(args[3]);
const format = args[4] ?? "text";

const maze = new HiveCarving(width, height, parallel, seed).run();

const lines = [];
for (let y = 0; y < maze.height; y++) {
	const row = [];
	for (let x = 0; x < maze.width; x++) {
		row.push(format === "ids" ? String(maze.cell(x, y)) : maze.isWall(x, y) ? "##" : "  ");
	}
	lines.push(row.join(format === "ids" ? " " : ""));
}
if (format !== "ids") {
	lines.push(`size=${maze.width}x${maze.height} parallel=${maze.parallel} seed=${maze.seed} rounds=${maze.rounds}`);
}
console.log(lines.join("\n"));
