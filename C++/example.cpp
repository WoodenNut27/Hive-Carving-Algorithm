// 使い方: example [width=41] [height=41] [parallel=5] [seed=random] [format=text|ids]
//   text : 迷路を "##" (壁) と "  " (通路) で出力
//   ids  : マップデータ (0=壁, 1～=プロセス番号) を空白区切りで出力 (各言語版の突き合わせ用)
//
// ビルド例:
//   g++ -std=c++17 -O2 -o example example.cpp
//   cl /std:c++17 /O2 /EHsc /utf-8 example.cpp
#include <cstdlib>
#include <iostream>
#include <string>

#include "hive_carving.hpp"

int main(int argc, char** argv) {
	const int width = argc > 1 ? std::atoi(argv[1]) : 41;
	const int height = argc > 2 ? std::atoi(argv[2]) : 41;
	const int parallel = argc > 3 ? std::atoi(argv[3]) : 5;
	const std::uint32_t seed = argc > 4 && std::string(argv[4]) != "random"
		? static_cast<std::uint32_t>(std::stoul(argv[4]))
		: woodennut::random_seed();
	const std::string format = argc > 5 ? argv[5] : "text";

	try {
		const auto maze = woodennut::generate(width, height, parallel, seed);

		std::string out;
		for (int y = 0; y < maze.height(); y++) {
			for (int x = 0; x < maze.width(); x++) {
				if (format == "ids") {
					if (x > 0) out += ' ';
					out += std::to_string(maze.cell(x, y));
				} else {
					out += maze.is_wall(x, y) ? "##" : "  ";
				}
			}
			out += '\n';
		}
		if (format != "ids") {
			out += "size=" + std::to_string(maze.width()) + "x" + std::to_string(maze.height()) +
				" parallel=" + std::to_string(maze.parallel()) + " seed=" + std::to_string(maze.seed()) +
				" rounds=" + std::to_string(maze.rounds()) + "\n";
		}
		std::cout << out;
	} catch (const std::exception& e) {
		std::cerr << "error: " << e.what() << "\n";
		return 1;
	}
	return 0;
}
