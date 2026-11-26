//==========================================================//
//		ハイヴ・カービング法 (Hive-Carving Algorithm)		//
//						C# 版								//
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
//	このファイル 1 つで動く (Unity など C# 7.3 以降の環境でも可)。

using System;
using System.Collections.Generic;

namespace WoodenNut
{
	/// <summary>
	/// 全言語版で共通の擬似乱数 (Mulberry32)。
	/// 同じシードなら、どの言語版でも同じ迷路になる。
	/// </summary>
	public sealed class Mulberry32
	{
		/// <summary>内部状態</summary>
		public uint State;

		public Mulberry32(uint seed)
		{
			State = seed;
		}

		/// <summary>0 ～ 2^32-1</summary>
		public uint NextUInt32()
		{
			unchecked
			{
				State += 0x6D2B79F5u;
				uint t = State;
				t = (t ^ (t >> 15)) * (t | 1u);
				t = (t + (t ^ (t >> 7)) * (t | 61u)) ^ t;
				return t ^ (t >> 14);
			}
		}

		/// <summary>0 ～ n-1 (HSP の rnd(n) 相当)</summary>
		public int NextInt(int n)
		{
			return (int)(NextUInt32() % (uint)n);
		}
	}

	/// <summary>
	/// ハイヴ・カービング法による迷路生成器。
	/// <para>
	/// マップは Width × Height のセル。値が 0 なら壁、1 ～ Parallel なら
	/// その番号の穴掘りプロセスが掘った通路。
	/// 奇数座標 (x, y がともに奇数) のマスが「部屋」、その間のマスが「壁」になる。
	/// </para>
	/// </summary>
	public sealed class HiveCarving
	{
		//方向 0=左・1=上・2=右・3=下 (時計回り)
		static readonly int[] DX = { -1, 0, 1, 0 };
		static readonly int[] DY = { 0, -1, 0, 1 };

		readonly Mulberry32 rng;
		readonly int[] cells;					//マップデータ
		readonly int[] posX;					//並列穴掘りの現在位置X
		readonly int[] posY;					//並列穴掘りの現在位置Y
		readonly Stack<int>[] stacks;			//並列穴掘りの掘った方向の記憶
		readonly HashSet<long> links = new HashSet<long>();	//直接繋がったプロセスの組

		/// <summary>マップサイズX</summary>
		public int Width { get; private set; }
		/// <summary>マップサイズY</summary>
		public int Height { get; private set; }
		/// <summary>実際の並列数 (部屋の数を超える指定は切り詰める)</summary>
		public int Parallel { get; private set; }
		/// <summary>使用した乱数シード</summary>
		public uint Seed { get; private set; }
		/// <summary>部屋の総数 (Dug がこれに達したら全領域の穴掘りが完了)</summary>
		public int Total { get; private set; }
		/// <summary>穴を掘った回数 (全プロセスの合計。スタート位置を含む)</summary>
		public int Dug { get; private set; }
		/// <summary>メインループを回した回数</summary>
		public int Rounds { get; private set; }
		/// <summary>迷路生成が完了したか</summary>
		public bool Finished { get; private set; }

		/// <summary>マップデータ (0=壁, 1～Parallel=掘ったプロセスの番号)。インデックスは y * Width + x</summary>
		public IReadOnlyList<int> Cells { get { return cells; } }

		/// <param name="width">マップサイズX (3 以上の奇数)</param>
		/// <param name="height">マップサイズY (3 以上の奇数)</param>
		/// <param name="parallel">穴掘りを並列で行う数 (1 以上)</param>
		/// <param name="seed">乱数シード (null ならランダム)</param>
		public HiveCarving(int width = 41, int height = 41, int parallel = 5, uint? seed = null)
		{
			if (width < 3 || width % 2 == 0) throw new ArgumentOutOfRangeException("width", "width must be an odd integer >= 3");
			if (height < 3 || height % 2 == 0) throw new ArgumentOutOfRangeException("height", "height must be an odd integer >= 3");
			if (parallel < 1) throw new ArgumentOutOfRangeException("parallel", "parallel must be >= 1");

			Width = width;
			Height = height;
			Seed = seed.HasValue ? seed.Value : RandomSeed();
			Total = ((width - 1) / 2) * ((height - 1) / 2);
			Parallel = Math.Min(parallel, Total);

			rng = new Mulberry32(Seed);
			cells = new int[width * height];
			posX = new int[Parallel];
			posY = new int[Parallel];
			stacks = new Stack<int>[Parallel];
			for (int i = 0; i < Parallel; i++) stacks[i] = new Stack<int>();

			PlaceStarts();
		}

		/// <summary>シード未指定時に使うランダムなシード</summary>
		public static uint RandomSeed()
		{
			return unchecked((uint)Guid.NewGuid().GetHashCode());
		}

		/// <summary>迷路を最後まで生成して返す</summary>
		public static HiveCarving Generate(int width = 41, int height = 41, int parallel = 5, uint? seed = null)
		{
			var maze = new HiveCarving(width, height, parallel, seed);
			maze.Run();
			return maze;
		}

		//穴掘りスタート位置を、部屋の中から重複なしでランダムに決めて掘る
		void PlaceStarts()
		{
			int cellW = (Width - 1) / 2;
			var pool = new int[Total];
			for (int i = 0; i < Total; i++) pool[i] = i;

			for (int i = 0; i < Parallel; i++)
			{
				int j = i + rng.NextInt(Total - i);
				int room = pool[j];
				pool[j] = pool[i];
				pool[i] = room;

				int x = (room % cellW) * 2 + 1;
				int y = (room / cellW) * 2 + 1;
				posX[i] = x;
				posY[i] = y;
				cells[y * Width + x] = i + 1;
				Dug++;
			}
		}

		//プロセス a, b が未接続なら接続済みにして true を返す
		bool Link(int a, int b)
		{
			long key = a < b ? (long)a * Parallel + b : (long)b * Parallel + a;
			return links.Add(key);
		}

		/// <summary>メインループを 1 回だけ進める (全プロセスが 1 マスずつ動く)</summary>
		/// <returns>迷路生成が完了したら true</returns>
		public bool Step()
		{
			if (Finished) return true;

			int w = Width;
			int h = Height;

			//並列数の数だけ穴掘り法を実行
			for (int i = 0; i < Parallel; i++)
			{
				int id = i + 1;
				int x = posX[i];
				int y = posY[i];

				//穴掘りの方向をランダムに決め、時計回りに 4 方向を調べる
				int dir = rng.NextInt(4);
				int found = -1;
				for (int k = 0; k < 4; k++)
				{
					int nx = x + DX[dir] * 2;
					int ny = y + DY[dir] * 2;

					//マップ範囲内だったら
					if (nx > 0 && ny > 0 && nx < w && ny < h)
					{
						int target = cells[ny * w + nx];
						if (target == 0)
						{
							//壁だったら、この方向に穴掘り
							found = dir;
							break;
						}
						if (target != id && Link(i, target - 1))
						{
							//他の穴掘りプロセスに未接続だったら、間の壁を開けて接続
							cells[(y + DY[dir]) * w + (x + DX[dir])] = id;
						}
					}
					dir = (dir + 1) & 3;
				}

				if (found >= 0)
				{
					//穴掘りを実行して、掘った方向をスタックに記憶
					int nx = x + DX[found] * 2;
					int ny = y + DY[found] * 2;
					cells[(y + DY[found]) * w + (x + DX[found])] = id;
					cells[ny * w + nx] = id;
					stacks[i].Push(found);
					posX[i] = nx;
					posY[i] = ny;
					Dug++;
				}
				else if (stacks[i].Count > 0)
				{
					//全方向掘れなかったら、スタックから取り出して 1 マス戻る
					int back = stacks[i].Pop();
					posX[i] = x - DX[back] * 2;
					posY[i] = y - DY[back] * 2;
				}
				//スタックもない場合は、その場にとどまる
			}

			Rounds++;
			if (Dug >= Total) Finished = true;
			return Finished;
		}

		/// <summary>迷路生成が完了するまで Step() を繰り返す</summary>
		public void Run()
		{
			while (!Step()) { }
		}

		/// <summary>(x, y) のマップデータ。0=壁, 1～Parallel=掘ったプロセスの番号</summary>
		public int GetCell(int x, int y)
		{
			return cells[y * Width + x];
		}

		/// <summary>(x, y) が壁か</summary>
		public bool IsWall(int x, int y)
		{
			return cells[y * Width + x] == 0;
		}
	}
}
