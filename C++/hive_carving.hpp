//==========================================================//
//		ハイヴ・カービング法 (Hive-Carving Algorithm)		//
//					C++ 版 (C++17, ヘッダオンリー)			//
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

#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <random>
#include <stdexcept>
#include <unordered_set>
#include <vector>

namespace woodennut {

/// 全言語版で共通の擬似乱数 (Mulberry32)。
/// 同じシードなら、どの言語版でも同じ迷路になる。
class Mulberry32 {
public:
	explicit Mulberry32(std::uint32_t seed) : state_(seed) {}

	/// 0 ～ 2^32-1
	std::uint32_t next_u32() {
		state_ += 0x6D2B79F5u;
		std::uint32_t t = state_;
		t = (t ^ (t >> 15)) * (t | 1u);
		t = (t + (t ^ (t >> 7)) * (t | 61u)) ^ t;
		return t ^ (t >> 14);
	}

	/// 0 ～ n-1 (HSP の rnd(n) 相当)
	int next_int(int n) {
		return static_cast<int>(next_u32() % static_cast<std::uint32_t>(n));
	}

	std::uint32_t state() const { return state_; }

private:
	std::uint32_t state_;
};

/// シード未指定時に使うランダムなシード
inline std::uint32_t random_seed() {
	return static_cast<std::uint32_t>(std::random_device{}());
}

/// ハイヴ・カービング法による迷路生成器。
///
/// マップは width × height のセル。値が 0 なら壁、1 ～ parallel なら
/// その番号の穴掘りプロセスが掘った通路。
/// 奇数座標 (x, y がともに奇数) のマスが「部屋」、その間のマスが「壁」になる。
class HiveCarving {
public:
	/// @param width    マップサイズX (3 以上の奇数)
	/// @param height   マップサイズY (3 以上の奇数)
	/// @param parallel 穴掘りを並列で行う数 (1 以上。部屋の数を超える分は切り詰め)
	/// @param seed     乱数シード
	HiveCarving(int width = 41, int height = 41, int parallel = 5, std::uint32_t seed = random_seed())
		: width_(width), height_(height), seed_(seed), rng_(seed) {
		if (width < 3 || width % 2 == 0) throw std::invalid_argument("width must be an odd integer >= 3");
		if (height < 3 || height % 2 == 0) throw std::invalid_argument("height must be an odd integer >= 3");
		if (parallel < 1) throw std::invalid_argument("parallel must be >= 1");

		total_ = ((width - 1) / 2) * ((height - 1) / 2);
		parallel_ = std::min(parallel, total_);

		cells_.assign(static_cast<std::size_t>(width) * static_cast<std::size_t>(height), 0);
		pos_x_.assign(parallel_, 0);
		pos_y_.assign(parallel_, 0);
		stacks_.assign(parallel_, {});

		place_starts();
	}

	/// メインループを 1 回だけ進める (全プロセスが 1 マスずつ動く)。
	/// @return 迷路生成が完了したら true
	bool step() {
		if (finished_) return true;

		//並列数の数だけ穴掘り法を実行
		for (int i = 0; i < parallel_; i++) {
			const std::int32_t id = i + 1;
			const int x = pos_x_[i];
			const int y = pos_y_[i];

			//穴掘りの方向をランダムに決め、時計回りに 4 方向を調べる
			int dir = rng_.next_int(4);
			int found = -1;
			for (int k = 0; k < 4; k++) {
				const int nx = x + DX[dir] * 2;
				const int ny = y + DY[dir] * 2;

				//マップ範囲内だったら
				if (nx > 0 && ny > 0 && nx < width_ && ny < height_) {
					const std::int32_t target = at(nx, ny);
					if (target == 0) {
						//壁だったら、この方向に穴掘り
						found = dir;
						break;
					}
					if (target != id && link(i, target - 1)) {
						//他の穴掘りプロセスに未接続だったら、間の壁を開けて接続
						at(x + DX[dir], y + DY[dir]) = id;
					}
				}
				dir = (dir + 1) & 3;
			}

			if (found >= 0) {
				//穴掘りを実行して、掘った方向をスタックに記憶
				const int nx = x + DX[found] * 2;
				const int ny = y + DY[found] * 2;
				at(x + DX[found], y + DY[found]) = id;
				at(nx, ny) = id;
				stacks_[i].push_back(static_cast<std::uint8_t>(found));
				pos_x_[i] = nx;
				pos_y_[i] = ny;
				dug_++;
			} else if (!stacks_[i].empty()) {
				//全方向掘れなかったら、スタックから取り出して 1 マス戻る
				const int back = stacks_[i].back();
				stacks_[i].pop_back();
				pos_x_[i] = x - DX[back] * 2;
				pos_y_[i] = y - DY[back] * 2;
			}
			//スタックもない場合は、その場にとどまる
		}

		rounds_++;
		if (dug_ >= total_) finished_ = true;
		return finished_;
	}

	/// 迷路生成が完了するまで step() を繰り返す
	HiveCarving& run() {
		while (!step()) {}
		return *this;
	}

	/// (x, y) のマップデータ。0=壁, 1～parallel=掘ったプロセスの番号
	std::int32_t cell(int x, int y) const { return cells_[index(x, y)]; }
	/// (x, y) が壁か
	bool is_wall(int x, int y) const { return cell(x, y) == 0; }
	/// マップデータ全体。インデックスは y * width + x
	const std::vector<std::int32_t>& cells() const { return cells_; }

	int width() const { return width_; }			///< マップサイズX
	int height() const { return height_; }			///< マップサイズY
	int parallel() const { return parallel_; }		///< 実際の並列数
	std::uint32_t seed() const { return seed_; }	///< 使用した乱数シード
	int total() const { return total_; }			///< 部屋の総数
	int dug() const { return dug_; }				///< 穴を掘った回数 (スタート位置を含む)
	int rounds() const { return rounds_; }			///< メインループを回した回数
	bool finished() const { return finished_; }		///< 迷路生成が完了したか

private:
	//方向 0=左・1=上・2=右・3=下 (時計回り)
	static constexpr int DX[4] = {-1, 0, 1, 0};
	static constexpr int DY[4] = {0, -1, 0, 1};

	std::size_t index(int x, int y) const {
		return static_cast<std::size_t>(y) * static_cast<std::size_t>(width_) + static_cast<std::size_t>(x);
	}
	std::int32_t& at(int x, int y) { return cells_[index(x, y)]; }

	//穴掘りスタート位置を、部屋の中から重複なしでランダムに決めて掘る
	void place_starts() {
		const int cell_w = (width_ - 1) / 2;
		std::vector<int> pool(total_);
		for (int i = 0; i < total_; i++) pool[i] = i;

		for (int i = 0; i < parallel_; i++) {
			const int j = i + rng_.next_int(total_ - i);
			std::swap(pool[i], pool[j]);
			const int room = pool[i];

			const int x = (room % cell_w) * 2 + 1;
			const int y = (room / cell_w) * 2 + 1;
			pos_x_[i] = x;
			pos_y_[i] = y;
			at(x, y) = i + 1;
			dug_++;
		}
	}

	//プロセス a, b が未接続なら接続済みにして true を返す
	bool link(int a, int b) {
		const std::uint64_t lo = static_cast<std::uint64_t>(std::min(a, b));
		const std::uint64_t hi = static_cast<std::uint64_t>(std::max(a, b));
		return links_.insert(lo * static_cast<std::uint64_t>(parallel_) + hi).second;
	}

	int width_;
	int height_;
	int parallel_ = 0;
	int total_ = 0;
	int dug_ = 0;
	int rounds_ = 0;
	bool finished_ = false;
	std::uint32_t seed_;
	Mulberry32 rng_;
	std::vector<std::int32_t> cells_;					//マップデータ
	std::vector<int> pos_x_;							//並列穴掘りの現在位置X
	std::vector<int> pos_y_;							//並列穴掘りの現在位置Y
	std::vector<std::vector<std::uint8_t>> stacks_;		//並列穴掘りの掘った方向の記憶
	std::unordered_set<std::uint64_t> links_;			//直接繋がったプロセスの組
};

/// 迷路を最後まで生成して返す
inline HiveCarving generate(int width = 41, int height = 41, int parallel = 5, std::uint32_t seed = random_seed()) {
	HiveCarving maze(width, height, parallel, seed);
	maze.run();
	return maze;
}

}  // namespace woodennut
