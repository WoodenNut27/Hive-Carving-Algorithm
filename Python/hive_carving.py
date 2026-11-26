#==========================================================#
#		ハイヴ・カービング法 (Hive-Carving Algorithm)		#
#					Python 版 (Python 3.8+)					#
#==========================================================#
#
#	穴掘り法を複数並列で動かし、別プロセスの通路とぶつかった所で
#	壁を 1 枚だけ開けて「意図的にループ」を作る迷路生成アルゴリズム。
#	右手法 (左手法) で解けない迷路を作るのが目的。
#
#	original : HSP3/Hive-Carving Algorithm.hsp (v1.0.0)
#	license  : NYSL
#	author   : 木製ナット (WoodenNut)  https://www.woodennut.com/
#
#	Copyright (c) 2025 WoodenNut

"""ハイヴ・カービング法 (Hive-Carving Algorithm) による迷路生成。"""

import secrets
from typing import List, Optional

__all__ = ["Mulberry32", "HiveCarving", "generate", "random_seed"]

_MASK32 = 0xFFFFFFFF

# 方向 0=左・1=上・2=右・3=下 (時計回り)
_DX = (-1, 0, 1, 0)
_DY = (0, -1, 0, 1)


class Mulberry32:
    """全言語版で共通の擬似乱数 (Mulberry32)。同じシードなら、どの言語版でも同じ迷路になる。"""

    __slots__ = ("state",)

    def __init__(self, seed: int) -> None:
        self.state = seed & _MASK32

    def next_uint32(self) -> int:
        """0 ～ 2^32-1"""
        self.state = (self.state + 0x6D2B79F5) & _MASK32
        t = self.state
        t = ((t ^ (t >> 15)) * (t | 1)) & _MASK32
        t = ((t + (((t ^ (t >> 7)) * (t | 61)) & _MASK32)) & _MASK32) ^ t
        return t ^ (t >> 14)

    def next_int(self, n: int) -> int:
        """0 ～ n-1 (HSP の rnd(n) 相当)"""
        return self.next_uint32() % n


def random_seed() -> int:
    """シード未指定時に使うランダムなシード"""
    return secrets.randbits(32)


class HiveCarving:
    """ハイヴ・カービング法による迷路生成器。

    マップは width × height のセル。値が 0 なら壁、1 ～ parallel なら
    その番号の穴掘りプロセスが掘った通路。
    奇数座標 (x, y がともに奇数) のマスが「部屋」、その間のマスが「壁」になる。

    Attributes:
        width:    マップサイズX
        height:   マップサイズY
        parallel: 実際の並列数 (部屋の数を超える指定は切り詰める)
        seed:     使用した乱数シード
        total:    部屋の総数 (dug がこれに達したら全領域の穴掘りが完了)
        dug:      穴を掘った回数 (全プロセスの合計。スタート位置を含む)
        rounds:   メインループを回した回数
        finished: 迷路生成が完了したか
        cells:    マップデータ (0=壁, 1～parallel=掘ったプロセスの番号)。インデックスは y * width + x
    """

    def __init__(self, width: int = 41, height: int = 41, parallel: int = 5, seed: Optional[int] = None) -> None:
        """
        Args:
            width:    マップサイズX (3 以上の奇数)
            height:   マップサイズY (3 以上の奇数)
            parallel: 穴掘りを並列で行う数 (1 以上)
            seed:     乱数シード (32bit 符号なし整数。None ならランダム)
        """
        if not isinstance(width, int) or width < 3 or width % 2 == 0:
            raise ValueError("width must be an odd integer >= 3")
        if not isinstance(height, int) or height < 3 or height % 2 == 0:
            raise ValueError("height must be an odd integer >= 3")
        if not isinstance(parallel, int) or parallel < 1:
            raise ValueError("parallel must be an integer >= 1")

        self.width = width
        self.height = height
        self.seed = (random_seed() if seed is None else seed) & _MASK32
        self.total = ((width - 1) // 2) * ((height - 1) // 2)
        self.parallel = min(parallel, self.total)
        self.dug = 0
        self.rounds = 0
        self.finished = False
        self.cells: List[int] = [0] * (width * height)

        self._rng = Mulberry32(self.seed)
        self._pos_x = [0] * self.parallel  # 並列穴掘りの現在位置X
        self._pos_y = [0] * self.parallel  # 並列穴掘りの現在位置Y
        self._stacks: List[List[int]] = [[] for _ in range(self.parallel)]  # 掘った方向の記憶
        self._links = set()  # 直接繋がったプロセスの組

        self._place_starts()

    def _place_starts(self) -> None:
        """穴掘りスタート位置を、部屋の中から重複なしでランダムに決めて掘る"""
        cell_w = (self.width - 1) // 2
        pool = list(range(self.total))

        for i in range(self.parallel):
            j = i + self._rng.next_int(self.total - i)
            pool[i], pool[j] = pool[j], pool[i]
            room = pool[i]

            x = (room % cell_w) * 2 + 1
            y = (room // cell_w) * 2 + 1
            self._pos_x[i] = x
            self._pos_y[i] = y
            self.cells[y * self.width + x] = i + 1
            self.dug += 1

    def _link(self, a: int, b: int) -> bool:
        """プロセス a, b が未接続なら接続済みにして True を返す"""
        key = a * self.parallel + b if a < b else b * self.parallel + a
        if key in self._links:
            return False
        self._links.add(key)
        return True

    def step(self) -> bool:
        """メインループを 1 回だけ進める (全プロセスが 1 マスずつ動く)。迷路生成が完了したら True。"""
        if self.finished:
            return True

        w = self.width
        h = self.height
        cells = self.cells
        rng = self._rng

        # 並列数の数だけ穴掘り法を実行
        for i in range(self.parallel):
            pid = i + 1
            x = self._pos_x[i]
            y = self._pos_y[i]

            # 穴掘りの方向をランダムに決め、時計回りに 4 方向を調べる
            d = rng.next_int(4)
            found = -1
            for _ in range(4):
                nx = x + _DX[d] * 2
                ny = y + _DY[d] * 2

                # マップ範囲内だったら
                if 0 < nx < w and 0 < ny < h:
                    target = cells[ny * w + nx]
                    if target == 0:
                        # 壁だったら、この方向に穴掘り
                        found = d
                        break
                    if target != pid and self._link(i, target - 1):
                        # 他の穴掘りプロセスに未接続だったら、間の壁を開けて接続
                        cells[(y + _DY[d]) * w + (x + _DX[d])] = pid
                d = (d + 1) & 3

            if found >= 0:
                # 穴掘りを実行して、掘った方向をスタックに記憶
                nx = x + _DX[found] * 2
                ny = y + _DY[found] * 2
                cells[(y + _DY[found]) * w + (x + _DX[found])] = pid
                cells[ny * w + nx] = pid
                self._stacks[i].append(found)
                self._pos_x[i] = nx
                self._pos_y[i] = ny
                self.dug += 1
            elif self._stacks[i]:
                # 全方向掘れなかったら、スタックから取り出して 1 マス戻る
                back = self._stacks[i].pop()
                self._pos_x[i] = x - _DX[back] * 2
                self._pos_y[i] = y - _DY[back] * 2
            # スタックもない場合は、その場にとどまる

        self.rounds += 1
        if self.dug >= self.total:
            self.finished = True
        return self.finished

    def run(self) -> "HiveCarving":
        """迷路生成が完了するまで step() を繰り返す"""
        while not self.step():
            pass
        return self

    def cell(self, x: int, y: int) -> int:
        """(x, y) のマップデータ。0=壁, 1～parallel=掘ったプロセスの番号"""
        return self.cells[y * self.width + x]

    def is_wall(self, x: int, y: int) -> bool:
        """(x, y) が壁か"""
        return self.cells[y * self.width + x] == 0

    def rows(self) -> List[List[int]]:
        """マップデータを [y][x] の 2 次元リストで返す"""
        w = self.width
        return [self.cells[y * w:(y + 1) * w] for y in range(self.height)]


def generate(width: int = 41, height: int = 41, parallel: int = 5, seed: Optional[int] = None) -> HiveCarving:
    """迷路を最後まで生成して返す"""
    return HiveCarving(width, height, parallel, seed).run()
