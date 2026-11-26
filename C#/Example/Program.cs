// 使い方: dotnet run --project "C#/Example" -- [width=41] [height=41] [parallel=5] [seed=random] [format=text|ids]
//   text : 迷路を "##" (壁) と "  " (通路) で出力
//   ids  : マップデータ (0=壁, 1～=プロセス番号) を空白区切りで出力 (各言語版の突き合わせ用)
using System;
using System.Text;
using WoodenNut;

int width = args.Length > 0 ? int.Parse(args[0]) : 41;
int height = args.Length > 1 ? int.Parse(args[1]) : 41;
int parallel = args.Length > 2 ? int.Parse(args[2]) : 5;
uint? seed = args.Length > 3 && args[3] != "random" ? uint.Parse(args[3]) : (uint?)null;
string format = args.Length > 4 ? args[4] : "text";

var maze = HiveCarving.Generate(width, height, parallel, seed);

var sb = new StringBuilder();
for (int y = 0; y < maze.Height; y++)
{
	for (int x = 0; x < maze.Width; x++)
	{
		if (format == "ids")
		{
			if (x > 0) sb.Append(' ');
			sb.Append(maze.GetCell(x, y));
		}
		else
		{
			sb.Append(maze.IsWall(x, y) ? "##" : "  ");
		}
	}
	sb.Append('\n');
}
if (format != "ids")
{
	sb.Append($"size={maze.Width}x{maze.Height} parallel={maze.Parallel} seed={maze.Seed} rounds={maze.Rounds}\n");
}
Console.Out.Write(sb.ToString());
