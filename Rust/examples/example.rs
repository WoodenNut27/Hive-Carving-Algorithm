// 使い方: cargo run --release --example example -- [width=41] [height=41] [parallel=5] [seed=random] [format=text|ids]
//   text : 迷路を "##" (壁) と "  " (通路) で出力
//   ids  : マップデータ (0=壁, 1～=プロセス番号) を空白区切りで出力 (各言語版の突き合わせ用)
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize, default: usize| {
        args.get(i)
            .map_or(default, |s| s.parse().expect("invalid number"))
    };

    let width = arg(0, 41);
    let height = arg(1, 41);
    let parallel = arg(2, 5);
    let seed = match args.get(3).map(String::as_str) {
        None | Some("random") => hive_carving::random_seed(),
        Some(s) => s.parse().expect("invalid seed"),
    };
    let format = args.get(4).map_or("text", String::as_str);

    let maze = match hive_carving::generate(width, height, parallel, seed) {
        Ok(maze) => maze,
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    };

    let mut out = String::new();
    for y in 0..maze.height() {
        for x in 0..maze.width() {
            if format == "ids" {
                if x > 0 {
                    out.push(' ');
                }
                out.push_str(&maze.cell(x, y).to_string());
            } else {
                out.push_str(if maze.is_wall(x, y) { "##" } else { "  " });
            }
        }
        out.push('\n');
    }
    if format != "ids" {
        out.push_str(&format!(
            "size={}x{} parallel={} seed={} rounds={}\n",
            maze.width(),
            maze.height(),
            maze.parallel(),
            maze.seed(),
            maze.rounds()
        ));
    }
    std::io::stdout().write_all(out.as_bytes()).unwrap();
}
