# 使い方: python example.py [width=41] [height=41] [parallel=5] [seed=random] [format=text|ids]
#   text : 迷路を "##" (壁) と "  " (通路) で出力
#   ids  : マップデータ (0=壁, 1～=プロセス番号) を空白区切りで出力 (各言語版の突き合わせ用)
import sys

from hive_carving import generate


def main(argv):
    width = int(argv[0]) if len(argv) > 0 else 41
    height = int(argv[1]) if len(argv) > 1 else 41
    parallel = int(argv[2]) if len(argv) > 2 else 5
    seed = int(argv[3]) if len(argv) > 3 and argv[3] != "random" else None
    fmt = argv[4] if len(argv) > 4 else "text"

    maze = generate(width, height, parallel, seed)

    lines = []
    for row in maze.rows():
        if fmt == "ids":
            lines.append(" ".join(str(v) for v in row))
        else:
            lines.append("".join("##" if v == 0 else "  " for v in row))
    if fmt != "ids":
        lines.append(f"size={maze.width}x{maze.height} parallel={maze.parallel} seed={maze.seed} rounds={maze.rounds}")
    sys.stdout.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
