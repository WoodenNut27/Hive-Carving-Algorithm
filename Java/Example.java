// 使い方: java Example [width=41] [height=41] [parallel=5] [seed=random] [format=text|ids]
//   text : 迷路を "##" (壁) と "  " (通路) で出力
//   ids  : マップデータ (0=壁, 1～=プロセス番号) を空白区切りで出力 (各言語版の突き合わせ用)
//
// ビルド例:
//   javac -d out HiveCarving.java Example.java
//   java -cp out Example 41 41 5
public final class Example {
	public static void main(String[] args) {
		int width = args.length > 0 ? Integer.parseInt(args[0]) : 41;
		int height = args.length > 1 ? Integer.parseInt(args[1]) : 41;
		int parallel = args.length > 2 ? Integer.parseInt(args[2]) : 5;
		long seed = args.length > 3 && !args[3].equals("random") ? Long.parseLong(args[3]) : HiveCarving.randomSeed();
		String format = args.length > 4 ? args[4] : "text";

		HiveCarving maze = HiveCarving.generate(width, height, parallel, seed);

		StringBuilder sb = new StringBuilder();
		for (int y = 0; y < maze.getHeight(); y++) {
			for (int x = 0; x < maze.getWidth(); x++) {
				if (format.equals("ids")) {
					if (x > 0) sb.append(' ');
					sb.append(maze.getCell(x, y));
				} else {
					sb.append(maze.isWall(x, y) ? "##" : "  ");
				}
			}
			sb.append('\n');
		}
		if (!format.equals("ids")) {
			sb.append("size=").append(maze.getWidth()).append('x').append(maze.getHeight())
				.append(" parallel=").append(maze.getParallel())
				.append(" seed=").append(maze.getSeed())
				.append(" rounds=").append(maze.getRounds()).append('\n');
		}
		System.out.print(sb);
	}
}
