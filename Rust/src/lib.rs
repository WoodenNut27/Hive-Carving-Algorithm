//==========================================================//
//		ハイヴ・カービング法 (Hive-Carving Algorithm)		//
//						Rust 版								//
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

//! ハイヴ・カービング法 (Hive-Carving Algorithm) による迷路生成。
//!
//! ```
//! let maze = hive_carving::generate(41, 41, 5, 12345).unwrap();
//! assert!(maze.is_wall(0, 0));
//! ```

use std::collections::HashSet;
use std::fmt;

/// 方向 0=左・1=上・2=右・3=下 (時計回り)
const DX: [isize; 4] = [-1, 0, 1, 0];
const DY: [isize; 4] = [0, -1, 0, 1];

/// 全言語版で共通の擬似乱数 (Mulberry32)。
/// 同じシードなら、どの言語版でも同じ迷路になる。
#[derive(Clone, Debug)]
pub struct Mulberry32 {
    pub state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    /// 0 ～ 2^32-1
    pub fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x6D2B_79F5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61)) ^ t;
        t ^ (t >> 14)
    }

    /// 0 ～ n-1 (HSP の rnd(n) 相当)
    pub fn next_int(&mut self, n: u32) -> u32 {
        self.next_u32() % n
    }
}

/// シード未指定時に使うランダムなシード (標準ライブラリのみで生成)
pub fn random_seed() -> u32 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let mut hasher = RandomState::new().build_hasher();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    hasher.write_u128(nanos);
    hasher.finish() as u32
}

/// 引数エラー
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// width / height が 3 以上の奇数でない
    InvalidSize,
    /// parallel が 0
    InvalidParallel,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::InvalidSize => write!(f, "width and height must be odd integers >= 3"),
            Error::InvalidParallel => write!(f, "parallel must be >= 1"),
        }
    }
}

impl std::error::Error for Error {}

/// ハイヴ・カービング法による迷路生成器。
///
/// マップは width × height のセル。値が 0 なら壁、1 ～ parallel なら
/// その番号の穴掘りプロセスが掘った通路。
/// 奇数座標 (x, y がともに奇数) のマスが「部屋」、その間のマスが「壁」になる。
#[derive(Clone, Debug)]
pub struct HiveCarving {
    width: usize,
    height: usize,
    parallel: usize,
    seed: u32,
    total: usize,
    dug: usize,
    rounds: usize,
    finished: bool,
    rng: Mulberry32,
    /// マップデータ
    cells: Vec<u32>,
    /// 並列穴掘りの現在位置 (x, y)
    pos: Vec<(usize, usize)>,
    /// 並列穴掘りの掘った方向の記憶
    stacks: Vec<Vec<u8>>,
    /// 直接繋がったプロセスの組
    links: HashSet<u64>,
}

impl HiveCarving {
    /// - `width`    マップサイズX (3 以上の奇数)
    /// - `height`   マップサイズY (3 以上の奇数)
    /// - `parallel` 穴掘りを並列で行う数 (1 以上。部屋の数を超える分は切り詰め)
    /// - `seed`     乱数シード
    pub fn new(width: usize, height: usize, parallel: usize, seed: u32) -> Result<Self, Error> {
        if width < 3 || width % 2 != 1 || height < 3 || height % 2 != 1 {
            return Err(Error::InvalidSize);
        }
        if parallel < 1 {
            return Err(Error::InvalidParallel);
        }

        let total = ((width - 1) / 2) * ((height - 1) / 2);
        let parallel = parallel.min(total);
        let mut maze = Self {
            width,
            height,
            parallel,
            seed,
            total,
            dug: 0,
            rounds: 0,
            finished: false,
            rng: Mulberry32::new(seed),
            cells: vec![0; width * height],
            pos: vec![(0, 0); parallel],
            stacks: vec![Vec::new(); parallel],
            links: HashSet::new(),
        };
        maze.place_starts();
        Ok(maze)
    }

    /// 穴掘りスタート位置を、部屋の中から重複なしでランダムに決めて掘る
    fn place_starts(&mut self) {
        let cell_w = (self.width - 1) / 2;
        let mut pool: Vec<usize> = (0..self.total).collect();

        for i in 0..self.parallel {
            let j = i + self.rng.next_int((self.total - i) as u32) as usize;
            pool.swap(i, j);
            let room = pool[i];

            let x = (room % cell_w) * 2 + 1;
            let y = (room / cell_w) * 2 + 1;
            self.pos[i] = (x, y);
            self.cells[y * self.width + x] = (i + 1) as u32;
            self.dug += 1;
        }
    }

    /// プロセス a, b が未接続なら接続済みにして true を返す
    fn link(&mut self, a: usize, b: usize) -> bool {
        let (lo, hi) = if a < b { (a, b) } else { (b, a) };
        self.links
            .insert(lo as u64 * self.parallel as u64 + hi as u64)
    }

    /// メインループを 1 回だけ進める (全プロセスが 1 マスずつ動く)。
    /// 迷路生成が完了したら true を返す。
    pub fn step(&mut self) -> bool {
        if self.finished {
            return true;
        }

        let w = self.width as isize;
        let h = self.height as isize;
        let idx = |x: isize, y: isize| (y * w + x) as usize;

        // 並列数の数だけ穴掘り法を実行
        for i in 0..self.parallel {
            let id = (i + 1) as u32;
            let x = self.pos[i].0 as isize;
            let y = self.pos[i].1 as isize;

            // 穴掘りの方向をランダムに決め、時計回りに 4 方向を調べる
            let mut dir = self.rng.next_int(4) as usize;
            let mut found: Option<usize> = None;
            for _ in 0..4 {
                let nx = x + DX[dir] * 2;
                let ny = y + DY[dir] * 2;

                // マップ範囲内だったら
                if nx > 0 && ny > 0 && nx < w && ny < h {
                    let target = self.cells[idx(nx, ny)];
                    if target == 0 {
                        // 壁だったら、この方向に穴掘り
                        found = Some(dir);
                        break;
                    }
                    if target != id && self.link(i, (target - 1) as usize) {
                        // 他の穴掘りプロセスに未接続だったら、間の壁を開けて接続
                        self.cells[idx(x + DX[dir], y + DY[dir])] = id;
                    }
                }
                dir = (dir + 1) & 3;
            }

            if let Some(d) = found {
                // 穴掘りを実行して、掘った方向をスタックに記憶
                let nx = x + DX[d] * 2;
                let ny = y + DY[d] * 2;
                self.cells[idx(x + DX[d], y + DY[d])] = id;
                self.cells[idx(nx, ny)] = id;
                self.stacks[i].push(d as u8);
                self.pos[i] = (nx as usize, ny as usize);
                self.dug += 1;
            } else if let Some(back) = self.stacks[i].pop() {
                // 全方向掘れなかったら、スタックから取り出して 1 マス戻る
                let back = back as usize;
                self.pos[i] = ((x - DX[back] * 2) as usize, (y - DY[back] * 2) as usize);
            }
            // スタックもない場合は、その場にとどまる
        }

        self.rounds += 1;
        if self.dug >= self.total {
            self.finished = true;
        }
        self.finished
    }

    /// 迷路生成が完了するまで step() を繰り返す
    pub fn run(&mut self) -> &mut Self {
        while !self.step() {}
        self
    }

    /// (x, y) のマップデータ。0=壁, 1～parallel=掘ったプロセスの番号
    pub fn cell(&self, x: usize, y: usize) -> u32 {
        self.cells[y * self.width + x]
    }

    /// (x, y) が壁か
    pub fn is_wall(&self, x: usize, y: usize) -> bool {
        self.cell(x, y) == 0
    }

    /// マップデータ全体。インデックスは y * width + x
    pub fn cells(&self) -> &[u32] {
        &self.cells
    }

    /// マップサイズX
    pub fn width(&self) -> usize {
        self.width
    }
    /// マップサイズY
    pub fn height(&self) -> usize {
        self.height
    }
    /// 実際の並列数 (部屋の数を超える指定は切り詰める)
    pub fn parallel(&self) -> usize {
        self.parallel
    }
    /// 使用した乱数シード
    pub fn seed(&self) -> u32 {
        self.seed
    }
    /// 部屋の総数
    pub fn total(&self) -> usize {
        self.total
    }
    /// 穴を掘った回数 (全プロセスの合計。スタート位置を含む)
    pub fn dug(&self) -> usize {
        self.dug
    }
    /// メインループを回した回数
    pub fn rounds(&self) -> usize {
        self.rounds
    }
    /// 迷路生成が完了したか
    pub fn finished(&self) -> bool {
        self.finished
    }
}

/// 迷路を最後まで生成して返す
pub fn generate(
    width: usize,
    height: usize,
    parallel: usize,
    seed: u32,
) -> Result<HiveCarving, Error> {
    let mut maze = HiveCarving::new(width, height, parallel, seed)?;
    maze.run();
    Ok(maze)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// JavaScript 版 (HSP3 オリジナルと一致確認済み) と同じ結果になるか
    #[test]
    fn matches_reference_11x7() {
        let maze = generate(11, 7, 3, 1).unwrap();
        let expected: [u32; 77] = [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //
            0, 2, 0, 1, 1, 1, 0, 3, 3, 3, 0, //
            0, 2, 0, 1, 0, 1, 0, 3, 0, 0, 0, //
            0, 2, 0, 1, 0, 1, 3, 3, 3, 3, 0, //
            0, 2, 0, 1, 0, 0, 0, 3, 0, 0, 0, //
            0, 2, 2, 2, 2, 2, 3, 3, 3, 3, 0, //
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //
        ];
        assert_eq!(maze.cells(), &expected[..]);
    }

    #[test]
    fn rejects_invalid_arguments() {
        assert_eq!(
            HiveCarving::new(4, 5, 1, 0).unwrap_err(),
            Error::InvalidSize
        );
        assert_eq!(
            HiveCarving::new(5, 1, 1, 0).unwrap_err(),
            Error::InvalidSize
        );
        assert_eq!(
            HiveCarving::new(5, 5, 0, 0).unwrap_err(),
            Error::InvalidParallel
        );
    }

    #[test]
    fn clamps_parallel_to_room_count() {
        let maze = generate(5, 5, 100, 0).unwrap();
        assert_eq!(maze.parallel(), 4);
    }
}
