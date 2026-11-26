/** 全言語版で共通の擬似乱数 (Mulberry32) */
export declare class Mulberry32 {
	state: number;
	constructor(seed: number);
	/** 0 ～ 2^32-1 */
	nextUint32(): number;
	/** 0 ～ n-1 (HSP の rnd(n) 相当) */
	nextInt(n: number): number;
}

/** シード未指定時に使うランダムなシード */
export declare function randomSeed(): number;

/** ハイヴ・カービング法による迷路生成器 */
export declare class HiveCarving {
	/** マップサイズX */
	readonly width: number;
	/** マップサイズY */
	readonly height: number;
	/** 使用した乱数シード */
	readonly seed: number;
	/** マップデータ (0=壁, 1～parallel=掘ったプロセスの番号)。インデックスは y * width + x */
	readonly cells: Int32Array;
	/** 部屋の総数 */
	readonly total: number;
	/** 実際の並列数 */
	readonly parallel: number;
	/** 穴を掘った回数 (全プロセスの合計。スタート位置を含む) */
	readonly dug: number;
	/** メインループを回した回数 */
	readonly rounds: number;
	/** 迷路生成が完了したか */
	readonly finished: boolean;

	/**
	 * @param width    マップサイズX (3 以上の奇数, 既定 41)
	 * @param height   マップサイズY (3 以上の奇数, 既定 41)
	 * @param parallel 穴掘りを並列で行う数 (1 以上, 既定 5)
	 * @param seed     乱数シード (省略時はランダム)
	 */
	constructor(width?: number, height?: number, parallel?: number, seed?: number);
	/** メインループを 1 回進める。完了したら true */
	step(): boolean;
	/** 完了まで step() を繰り返す */
	run(): this;
	/** (x, y) のマップデータ */
	cell(x: number, y: number): number;
	/** (x, y) が壁か */
	isWall(x: number, y: number): boolean;
}

/** 迷路を最後まで生成して返す */
export declare function generate(width?: number, height?: number, parallel?: number, seed?: number): HiveCarving;
