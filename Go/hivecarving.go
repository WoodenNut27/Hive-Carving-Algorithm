//==========================================================//
//		ハイヴ・カービング法 (Hive-Carving Algorithm)		//
//						Go 版								//
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

// Package hivecarving はハイヴ・カービング法 (Hive-Carving Algorithm) による迷路生成を行う。
package hivecarving

import (
	"errors"
	"math/rand"
)

// 方向 0=左・1=上・2=右・3=下 (時計回り)
var (
	dx = [4]int{-1, 0, 1, 0}
	dy = [4]int{0, -1, 0, 1}
)

// Mulberry32 は全言語版で共通の擬似乱数。
// 同じシードなら、どの言語版でも同じ迷路になる。
type Mulberry32 struct {
	State uint32
}

// NewMulberry32 はシードを指定して乱数を作る。
func NewMulberry32(seed uint32) *Mulberry32 {
	return &Mulberry32{State: seed}
}

// Uint32 は 0 ～ 2^32-1 を返す。
func (r *Mulberry32) Uint32() uint32 {
	r.State += 0x6D2B79F5
	t := r.State
	t = (t ^ (t >> 15)) * (t | 1)
	t = (t + (t^(t>>7))*(t|61)) ^ t
	return t ^ (t >> 14)
}

// Intn は 0 ～ n-1 を返す (HSP の rnd(n) 相当)。
func (r *Mulberry32) Intn(n int) int {
	return int(r.Uint32() % uint32(n))
}

// RandomSeed はシード未指定時に使うランダムなシードを返す。
func RandomSeed() uint32 {
	return rand.Uint32()
}

// 引数エラー
var (
	ErrInvalidSize     = errors.New("hivecarving: width and height must be odd integers >= 3")
	ErrInvalidParallel = errors.New("hivecarving: parallel must be >= 1")
)

// Generator はハイヴ・カービング法による迷路生成器。
//
// マップは Width × Height のセル。値が 0 なら壁、1 ～ Parallel なら
// その番号の穴掘りプロセスが掘った通路。
// 奇数座標 (x, y がともに奇数) のマスが「部屋」、その間のマスが「壁」になる。
type Generator struct {
	width    int
	height   int
	parallel int
	seed     uint32
	total    int
	dug      int
	rounds   int
	finished bool

	rng    *Mulberry32
	cells  []int32             // マップデータ
	posX   []int               // 並列穴掘りの現在位置X
	posY   []int               // 並列穴掘りの現在位置Y
	stacks [][]uint8           // 並列穴掘りの掘った方向の記憶
	links  map[uint64]struct{} // 直接繋がったプロセスの組
}

// New は迷路生成器を作る。
//
//	width    マップサイズX (3 以上の奇数)
//	height   マップサイズY (3 以上の奇数)
//	parallel 穴掘りを並列で行う数 (1 以上。部屋の数を超える分は切り詰め)
//	seed     乱数シード
func New(width, height, parallel int, seed uint32) (*Generator, error) {
	if width < 3 || width%2 == 0 || height < 3 || height%2 == 0 {
		return nil, ErrInvalidSize
	}
	if parallel < 1 {
		return nil, ErrInvalidParallel
	}

	total := ((width - 1) / 2) * ((height - 1) / 2)
	if parallel > total {
		parallel = total
	}
	g := &Generator{
		width:    width,
		height:   height,
		parallel: parallel,
		seed:     seed,
		total:    total,
		rng:      NewMulberry32(seed),
		cells:    make([]int32, width*height),
		posX:     make([]int, parallel),
		posY:     make([]int, parallel),
		stacks:   make([][]uint8, parallel),
		links:    make(map[uint64]struct{}),
	}
	g.placeStarts()
	return g, nil
}

// Generate は迷路を最後まで生成して返す。
func Generate(width, height, parallel int, seed uint32) (*Generator, error) {
	g, err := New(width, height, parallel, seed)
	if err != nil {
		return nil, err
	}
	return g.Run(), nil
}

// placeStarts は穴掘りスタート位置を、部屋の中から重複なしでランダムに決めて掘る。
func (g *Generator) placeStarts() {
	cellW := (g.width - 1) / 2
	pool := make([]int, g.total)
	for i := range pool {
		pool[i] = i
	}

	for i := 0; i < g.parallel; i++ {
		j := i + g.rng.Intn(g.total-i)
		pool[i], pool[j] = pool[j], pool[i]
		room := pool[i]

		x := (room%cellW)*2 + 1
		y := (room/cellW)*2 + 1
		g.posX[i] = x
		g.posY[i] = y
		g.cells[y*g.width+x] = int32(i + 1)
		g.dug++
	}
}

// link はプロセス a, b が未接続なら接続済みにして true を返す。
func (g *Generator) link(a, b int) bool {
	if a > b {
		a, b = b, a
	}
	key := uint64(a)*uint64(g.parallel) + uint64(b)
	if _, ok := g.links[key]; ok {
		return false
	}
	g.links[key] = struct{}{}
	return true
}

// Step はメインループを 1 回だけ進める (全プロセスが 1 マスずつ動く)。
// 迷路生成が完了したら true を返す。
func (g *Generator) Step() bool {
	if g.finished {
		return true
	}

	w := g.width
	h := g.height
	cells := g.cells

	// 並列数の数だけ穴掘り法を実行
	for i := 0; i < g.parallel; i++ {
		id := int32(i + 1)
		x := g.posX[i]
		y := g.posY[i]

		// 穴掘りの方向をランダムに決め、時計回りに 4 方向を調べる
		dir := g.rng.Intn(4)
		found := -1
		for k := 0; k < 4; k++ {
			nx := x + dx[dir]*2
			ny := y + dy[dir]*2

			// マップ範囲内だったら
			if nx > 0 && ny > 0 && nx < w && ny < h {
				target := cells[ny*w+nx]
				if target == 0 {
					// 壁だったら、この方向に穴掘り
					found = dir
					break
				}
				if target != id && g.link(i, int(target-1)) {
					// 他の穴掘りプロセスに未接続だったら、間の壁を開けて接続
					cells[(y+dy[dir])*w+(x+dx[dir])] = id
				}
			}
			dir = (dir + 1) & 3
		}

		if found >= 0 {
			// 穴掘りを実行して、掘った方向をスタックに記憶
			nx := x + dx[found]*2
			ny := y + dy[found]*2
			cells[(y+dy[found])*w+(x+dx[found])] = id
			cells[ny*w+nx] = id
			g.stacks[i] = append(g.stacks[i], uint8(found))
			g.posX[i] = nx
			g.posY[i] = ny
			g.dug++
		} else if n := len(g.stacks[i]); n > 0 {
			// 全方向掘れなかったら、スタックから取り出して 1 マス戻る
			back := int(g.stacks[i][n-1])
			g.stacks[i] = g.stacks[i][:n-1]
			g.posX[i] = x - dx[back]*2
			g.posY[i] = y - dy[back]*2
		}
		// スタックもない場合は、その場にとどまる
	}

	g.rounds++
	if g.dug >= g.total {
		g.finished = true
	}
	return g.finished
}

// Run は迷路生成が完了するまで Step を繰り返す。
func (g *Generator) Run() *Generator {
	for !g.Step() {
	}
	return g
}

// Cell は (x, y) のマップデータを返す。0=壁, 1～Parallel=掘ったプロセスの番号。
func (g *Generator) Cell(x, y int) int { return int(g.cells[y*g.width+x]) }

// IsWall は (x, y) が壁かを返す。
func (g *Generator) IsWall(x, y int) bool { return g.cells[y*g.width+x] == 0 }

// Cells はマップデータ全体を返す (内部配列そのもの)。インデックスは y*Width + x。
func (g *Generator) Cells() []int32 { return g.cells }

// Width はマップサイズX。
func (g *Generator) Width() int { return g.width }

// Height はマップサイズY。
func (g *Generator) Height() int { return g.height }

// Parallel は実際の並列数 (部屋の数を超える指定は切り詰める)。
func (g *Generator) Parallel() int { return g.parallel }

// Seed は使用した乱数シード。
func (g *Generator) Seed() uint32 { return g.seed }

// Total は部屋の総数。
func (g *Generator) Total() int { return g.total }

// Dug は穴を掘った回数 (全プロセスの合計。スタート位置を含む)。
func (g *Generator) Dug() int { return g.dug }

// Rounds はメインループを回した回数。
func (g *Generator) Rounds() int { return g.rounds }

// Finished は迷路生成が完了したかを返す。
func (g *Generator) Finished() bool { return g.finished }
