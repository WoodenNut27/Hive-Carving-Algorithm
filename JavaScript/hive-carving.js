//==========================================================//
//		ハイヴ・カービング法 (Hive-Carving Algorithm)		//
//						JavaScript 版						//
//==========================================================//
//
//	穴掘り法を複数並列で動かし、別プロセスの通路とぶつかった所で
//	壁を 1 枚だけ開けて「意図的にループ」を作る迷路生成アルゴリズム。
//	右手法 (左手法) で解けない迷路を作るのが目的。
//
//	original : HSP3/Hive-Carving Algorithm.hsp (v1.0.0)
//	license  : NYSL
//	author   : 木製ナット (WoodenNut)  https://www.woodennut.com/
//
//	Copyright (c) 2025 WoodenNut

/** 方向 0=左・1=上・2=右・3=下 (時計回り) */
const DX = [-1, 0, 1, 0];
const DY = [0, -1, 0, 1];

/**
 * 全言語版で共通の擬似乱数 (Mulberry32)。
 * 同じシードなら、どの言語版でも同じ迷路になる。
 */
export class Mulberry32 {
	/** @param {number} seed 32bit 符号なし整数 */
	constructor(seed) {
		this.state = seed >>> 0;
	}

	/** @returns {number} 0 ～ 2^32-1 */
	nextUint32() {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
		return (t ^ (t >>> 14)) >>> 0;
	}

	/** HSP の rnd(n) 相当。 @returns {number} 0 ～ n-1 */
	nextInt(n) {
		return this.nextUint32() % n;
	}
}

/** シード未指定時に使うランダムなシード */
export function randomSeed() {
	return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/**
 * ハイヴ・カービング法による迷路生成器。
 *
 * マップは width × height のセル。値が 0 なら壁、1 ～ parallel なら
 * その番号の穴掘りプロセスが掘った通路。
 * 奇数座標 (x, y がともに奇数) のマスが「部屋」、その間のマスが「壁」になる。
 */
export class HiveCarving {
	/**
	 * @param {number} [width=41]   マップサイズX (3 以上の奇数)
	 * @param {number} [height=41]  マップサイズY (3 以上の奇数)
	 * @param {number} [parallel=5] 穴掘りを並列で行う数 (1 以上。部屋の数を超える分は切り詰め)
	 * @param {number} [seed]       乱数シード (32bit 符号なし整数。省略時はランダム)
	 */
	constructor(width = 41, height = 41, parallel = 5, seed = randomSeed()) {
		if (!Number.isInteger(width) || width < 3 || width % 2 === 0) {
			throw new RangeError("width must be an odd integer >= 3");
		}
		if (!Number.isInteger(height) || height < 3 || height % 2 === 0) {
			throw new RangeError("height must be an odd integer >= 3");
		}
		if (!Number.isInteger(parallel) || parallel < 1) {
			throw new RangeError("parallel must be an integer >= 1");
		}

		/** マップサイズX */
		this.width = width;
		/** マップサイズY */
		this.height = height;
		/** 使用した乱数シード */
		this.seed = seed >>> 0;
		/** マップデータ (0=壁, 1～parallel=掘ったプロセスの番号)。インデックスは y * width + x */
		this.cells = new Int32Array(width * height);
		/** 部屋の総数 (dug がこれに達したら全領域の穴掘りが完了) */
		this.total = ((width - 1) / 2) * ((height - 1) / 2);
		/** 実際の並列数 (部屋の数を超える指定は切り詰める) */
		this.parallel = Math.min(parallel, this.total);
		/** 穴を掘った回数 (全プロセスの合計。スタート位置を含む) */
		this.dug = 0;
		/** メインループを回した回数 */
		this.rounds = 0;
		/** 迷路生成が完了したか */
		this.finished = false;

		this._rng = new Mulberry32(this.seed);
		this._posX = new Int32Array(this.parallel);		// 並列穴掘りの現在位置X
		this._posY = new Int32Array(this.parallel);		// 並列穴掘りの現在位置Y
		this._stacks = Array.from({ length: this.parallel }, () => []);	// 掘った方向の記憶
		this._links = new Set();						// 直接繋がったプロセスの組

		this._placeStarts();
	}

	/** 穴掘りスタート位置を、部屋の中から重複なしでランダムに決めて掘る */
	_placeStarts() {
		const cellW = (this.width - 1) / 2;
		const pool = new Int32Array(this.total);
		for (let i = 0; i < this.total; i++) pool[i] = i;

		for (let i = 0; i < this.parallel; i++) {
			const j = i + this._rng.nextInt(this.total - i);
			const room = pool[j];
			pool[j] = pool[i];
			pool[i] = room;

			const x = (room % cellW) * 2 + 1;
			const y = Math.floor(room / cellW) * 2 + 1;
			this._posX[i] = x;
			this._posY[i] = y;
			this.cells[y * this.width + x] = i + 1;
			this.dug++;
		}
	}

	/** プロセス a, b が未接続なら接続済みにして true を返す */
	_link(a, b) {
		const key = a < b ? a * this.parallel + b : b * this.parallel + a;
		if (this._links.has(key)) return false;
		this._links.add(key);
		return true;
	}

	/**
	 * メインループを 1 回だけ進める (全プロセスが 1 マスずつ動く)。
	 * @returns {boolean} 迷路生成が完了したら true
	 */
	step() {
		if (this.finished) return true;

		const W = this.width;
		const H = this.height;
		const cells = this.cells;

		//並列数の数だけ穴掘り法を実行
		for (let i = 0; i < this.parallel; i++) {
			const id = i + 1;
			const x = this._posX[i];
			const y = this._posY[i];

			//穴掘りの方向をランダムに決め、時計回りに 4 方向を調べる
			let dir = this._rng.nextInt(4);
			let found = -1;
			for (let k = 0; k < 4; k++) {
				const nx = x + DX[dir] * 2;
				const ny = y + DY[dir] * 2;

				//マップ範囲内だったら
				if (nx > 0 && ny > 0 && nx < W && ny < H) {
					const target = cells[ny * W + nx];
					if (target === 0) {
						//壁だったら、この方向に穴掘り
						found = dir;
						break;
					}
					if (target !== id && this._link(i, target - 1)) {
						//他の穴掘りプロセスに未接続だったら、間の壁を開けて接続
						cells[(y + DY[dir]) * W + (x + DX[dir])] = id;
					}
				}
				dir = (dir + 1) & 3;
			}

			if (found >= 0) {
				//穴掘りを実行して、掘った方向をスタックに記憶
				cells[(y + DY[found]) * W + (x + DX[found])] = id;
				const nx = x + DX[found] * 2;
				const ny = y + DY[found] * 2;
				cells[ny * W + nx] = id;
				this._stacks[i].push(found);
				this._posX[i] = nx;
				this._posY[i] = ny;
				this.dug++;
			} else if (this._stacks[i].length > 0) {
				//全方向掘れなかったら、スタックから取り出して 1 マス戻る
				const back = this._stacks[i].pop();
				this._posX[i] = x - DX[back] * 2;
				this._posY[i] = y - DY[back] * 2;
			}
			//スタックもない場合は、その場にとどまる
		}

		this.rounds++;
		if (this.dug >= this.total) this.finished = true;
		return this.finished;
	}

	/** 迷路生成が完了するまで step() を繰り返す。 @returns {this} */
	run() {
		while (!this.step());
		return this;
	}

	/** (x, y) のマップデータ。0=壁, 1～parallel=掘ったプロセスの番号 */
	cell(x, y) {
		return this.cells[y * this.width + x];
	}

	/** (x, y) が壁か */
	isWall(x, y) {
		return this.cells[y * this.width + x] === 0;
	}
}

/**
 * 迷路を最後まで生成して返す。
 * @param {number} [width=41]
 * @param {number} [height=41]
 * @param {number} [parallel=5]
 * @param {number} [seed]
 * @returns {HiveCarving}
 */
export function generate(width = 41, height = 41, parallel = 5, seed = randomSeed()) {
	return new HiveCarving(width, height, parallel, seed).run();
}
