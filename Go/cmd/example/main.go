// 使い方: go run ./cmd/example [width=41] [height=41] [parallel=5] [seed=random] [format=text|ids]
//
//	text : 迷路を "##" (壁) と "  " (通路) で出力
//	ids  : マップデータ (0=壁, 1～=プロセス番号) を空白区切りで出力 (各言語版の突き合わせ用)
package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	hivecarving "github.com/WoodenNut27/Hive-Carving-Algorithm/Go"
)

func main() {
	args := os.Args[1:]
	intArg := func(i, def int) int {
		if i >= len(args) {
			return def
		}
		v, err := strconv.Atoi(args[i])
		if err != nil {
			fmt.Fprintln(os.Stderr, "invalid number:", args[i])
			os.Exit(1)
		}
		return v
	}

	width := intArg(0, 41)
	height := intArg(1, 41)
	parallel := intArg(2, 5)
	seed := hivecarving.RandomSeed()
	if len(args) > 3 && args[3] != "random" {
		v, err := strconv.ParseUint(args[3], 10, 32)
		if err != nil {
			fmt.Fprintln(os.Stderr, "invalid seed:", args[3])
			os.Exit(1)
		}
		seed = uint32(v)
	}
	format := "text"
	if len(args) > 4 {
		format = args[4]
	}

	maze, err := hivecarving.Generate(width, height, parallel, seed)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}

	var sb strings.Builder
	for y := 0; y < maze.Height(); y++ {
		for x := 0; x < maze.Width(); x++ {
			if format == "ids" {
				if x > 0 {
					sb.WriteByte(' ')
				}
				sb.WriteString(strconv.Itoa(maze.Cell(x, y)))
			} else if maze.IsWall(x, y) {
				sb.WriteString("##")
			} else {
				sb.WriteString("  ")
			}
		}
		sb.WriteByte('\n')
	}
	if format != "ids" {
		fmt.Fprintf(&sb, "size=%dx%d parallel=%d seed=%d rounds=%d\n",
			maze.Width(), maze.Height(), maze.Parallel(), maze.Seed(), maze.Rounds())
	}
	os.Stdout.WriteString(sb.String())
}
