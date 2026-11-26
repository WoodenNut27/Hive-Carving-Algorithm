//==========================================================//
//		ハイヴ・カービング法 (Hive-Carving Algorithm)		//
//						Java 版 (Java 8+)					//
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
//
//	パッケージに入れる場合は先頭に package 文を追加してください。

import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.concurrent.ThreadLocalRandom;

/**
 * ハイヴ・カービング法による迷路生成器。
 * <p>
 * マップは width × height のセル。値が 0 なら壁、1 ～ parallel なら
 * その番号の穴掘りプロセスが掘った通路。
 * 奇数座標 (x, y がともに奇数) のマスが「部屋」、その間のマスが「壁」になる。
 */
public final class HiveCarving {

	/**
	 * 全言語版で共通の擬似乱数 (Mulberry32)。
	 * 同じシードなら、どの言語版でも同じ迷路になる。
	 */
	public static final class Mulberry32 {
		private int state;

		/** @param seed 32bit 符号なし整数 (0 ～ 4294967295) */
		public Mulberry32(long seed) {
			state = (int) seed;
		}

		/** @return 0 ～ 2^32-1 */
		public long nextUint32() {
			state += 0x6D2B79F5;
			int t = state;
			t = (t ^ (t >>> 15)) * (t | 1);
			t = (t + (t ^ (t >>> 7)) * (t | 61)) ^ t;
			return (t ^ (t >>> 14)) & 0xFFFFFFFFL;
		}

		/** @return 0 ～ n-1 (HSP の rnd(n) 相当) */
		public int nextInt(int n) {
			return (int) (nextUint32() % n);
		}
	}

	//方向 0=左・1=上・2=右・3=下 (時計回り)
	private static final int[] DX = {-1, 0, 1, 0};
	private static final int[] DY = {0, -1, 0, 1};

	private final int width;
	private final int height;
	private final int parallel;
	private final long seed;
	private final int total;
	private int dug;
	private int rounds;
	private boolean finished;

	private final Mulberry32 rng;
	private final int[] cells;							//マップデータ
	private final int[] posX;							//並列穴掘りの現在位置X
	private final int[] posY;							//並列穴掘りの現在位置Y
	private final ArrayDeque<Integer>[] stacks;			//並列穴掘りの掘った方向の記憶
	private final HashSet<Long> links = new HashSet<>();	//直接繋がったプロセスの組

	/**
	 * @param width    マップサイズX (3 以上の奇数)
	 * @param height   マップサイズY (3 以上の奇数)
	 * @param parallel 穴掘りを並列で行う数 (1 以上。部屋の数を超える分は切り詰め)
	 * @param seed     乱数シード (32bit 符号なし整数。0 ～ 4294967295)
	 */
	@SuppressWarnings("unchecked")
	public HiveCarving(int width, int height, int parallel, long seed) {
		if (width < 3 || width % 2 == 0) throw new IllegalArgumentException("width must be an odd integer >= 3");
		if (height < 3 || height % 2 == 0) throw new IllegalArgumentException("height must be an odd integer >= 3");
		if (parallel < 1) throw new IllegalArgumentException("parallel must be >= 1");

		this.width = width;
		this.height = height;
		this.seed = seed & 0xFFFFFFFFL;
		this.total = ((width - 1) / 2) * ((height - 1) / 2);
		this.parallel = Math.min(parallel, total);

		rng = new Mulberry32(this.seed);
		cells = new int[width * height];
		posX = new int[this.parallel];
		posY = new int[this.parallel];
		stacks = new ArrayDeque[this.parallel];
		for (int i = 0; i < this.parallel; i++) stacks[i] = new ArrayDeque<>();

		placeStarts();
	}

	/** シードをランダムにして生成器を作る */
	public HiveCarving(int width, int height, int parallel) {
		this(width, height, parallel, randomSeed());
	}

	/** 41 × 41・並列数 5・ランダムシードで生成器を作る */
	public HiveCarving() {
		this(41, 41, 5);
	}

	/** シード未指定時に使うランダムなシード */
	public static long randomSeed() {
		return ThreadLocalRandom.current().nextInt() & 0xFFFFFFFFL;
	}

	/** 迷路を最後まで生成して返す */
	public static HiveCarving generate(int width, int height, int parallel, long seed) {
		return new HiveCarving(width, height, parallel, seed).run();
	}

	/** 迷路を最後まで生成して返す (ランダムシード) */
	public static HiveCarving generate(int width, int height, int parallel) {
		return new HiveCarving(width, height, parallel).run();
	}

	//穴掘りスタート位置を、部屋の中から重複なしでランダムに決めて掘る
	private void placeStarts() {
		int cellW = (width - 1) / 2;
		int[] pool = new int[total];
		for (int i = 0; i < total; i++) pool[i] = i;

		for (int i = 0; i < parallel; i++) {
			int j = i + rng.nextInt(total - i);
			int room = pool[j];
			pool[j] = pool[i];
			pool[i] = room;

			int x = (room % cellW) * 2 + 1;
			int y = (room / cellW) * 2 + 1;
			posX[i] = x;
			posY[i] = y;
			cells[y * width + x] = i + 1;
			dug++;
		}
	}

	//プロセス a, b が未接続なら接続済みにして true を返す
	private boolean link(int a, int b) {
		long key = a < b ? (long) a * parallel + b : (long) b * parallel + a;
		return links.add(key);
	}

	/**
	 * メインループを 1 回だけ進める (全プロセスが 1 マスずつ動く)。
	 * @return 迷路生成が完了したら true
	 */
	public boolean step() {
		if (finished) return true;

		//並列数の数だけ穴掘り法を実行
		for (int i = 0; i < parallel; i++) {
			int id = i + 1;
			int x = posX[i];
			int y = posY[i];

			//穴掘りの方向をランダムに決め、時計回りに 4 方向を調べる
			int dir = rng.nextInt(4);
			int found = -1;
			for (int k = 0; k < 4; k++) {
				int nx = x + DX[dir] * 2;
				int ny = y + DY[dir] * 2;

				//マップ範囲内だったら
				if (nx > 0 && ny > 0 && nx < width && ny < height) {
					int target = cells[ny * width + nx];
					if (target == 0) {
						//壁だったら、この方向に穴掘り
						found = dir;
						break;
					}
					if (target != id && link(i, target - 1)) {
						//他の穴掘りプロセスに未接続だったら、間の壁を開けて接続
						cells[(y + DY[dir]) * width + (x + DX[dir])] = id;
					}
				}
				dir = (dir + 1) & 3;
			}

			if (found >= 0) {
				//穴掘りを実行して、掘った方向をスタックに記憶
				int nx = x + DX[found] * 2;
				int ny = y + DY[found] * 2;
				cells[(y + DY[found]) * width + (x + DX[found])] = id;
				cells[ny * width + nx] = id;
				stacks[i].push(found);
				posX[i] = nx;
				posY[i] = ny;
				dug++;
			} else if (!stacks[i].isEmpty()) {
				//全方向掘れなかったら、スタックから取り出して 1 マス戻る
				int back = stacks[i].pop();
				posX[i] = x - DX[back] * 2;
				posY[i] = y - DY[back] * 2;
			}
			//スタックもない場合は、その場にとどまる
		}

		rounds++;
		if (dug >= total) finished = true;
		return finished;
	}

	/** 迷路生成が完了するまで step() を繰り返す */
	public HiveCarving run() {
		while (!step()) {
			// 完了まで繰り返す
		}
		return this;
	}

	/** (x, y) のマップデータ。0=壁, 1～parallel=掘ったプロセスの番号 */
	public int getCell(int x, int y) {
		return cells[y * width + x];
	}

	/** (x, y) が壁か */
	public boolean isWall(int x, int y) {
		return cells[y * width + x] == 0;
	}

	/** マップデータのコピー。インデックスは y * width + x */
	public int[] getCells() {
		return cells.clone();
	}

	/** マップサイズX */
	public int getWidth() { return width; }
	/** マップサイズY */
	public int getHeight() { return height; }
	/** 実際の並列数 (部屋の数を超える指定は切り詰める) */
	public int getParallel() { return parallel; }
	/** 使用した乱数シード */
	public long getSeed() { return seed; }
	/** 部屋の総数 */
	public int getTotal() { return total; }
	/** 穴を掘った回数 (全プロセスの合計。スタート位置を含む) */
	public int getDug() { return dug; }
	/** メインループを回した回数 */
	public int getRounds() { return rounds; }
	/** 迷路生成が完了したか */
	public boolean isFinished() { return finished; }
}
