import { CELLS, MAX_NUMBER, SIZE, legalCells, type Board } from "./board.js";
import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/**
 * 人机（「普通」难度）：只用自己看得到的东西（别人从牌池抽的牌它也看不到）。
 *
 * 棋盘价值 = 已放的牌 × FILLED + 每个空格的「还能放什么」：
 * 空格左右（上下）最近的已放牌给出这一格的取值范围（中间隔着几个空格就要留出几个数），
 * 范围里还没露面的牌（牌池里的 + 桌面上的）越多越好；范围为空的空格是死格，扣分。
 * 牌池里有什么可以从公开信息算出来：每个数字共有「人数」份，减去所有棋盘上和桌面上的。
 *
 * 放牌：挑放完以后棋盘价值最高的格子（抽来的牌也可以弃掉，即保持现状）。
 * 选牌：拿每张能拿的明牌各算一次最好的放法；盲抽按牌池里每个数字的概率算期望；取最大的。
 *
 * 防止死循环：拿明牌去「顶替」（不是填空格）时，新牌必须比旧牌更接近这一格的理想数字。
 * 每位人机棋盘上「离理想数字的总距离」只减不增，人机之间就不会一直互相换牌、谁也不抽牌池。
 */

const FILLED = 10;
const DEAD = -8;
/** 一个空格「还能放的牌」数到这么多就算很宽松了。 */
const ROOM_CAP = 8;
const ROOM_WEIGHT = 4;
/** 牌池快空时（按牌数决胜负）更看重多放一张。 */
const ENDGAME_POT = 6;

/** 每个数字还剩几张没露面：每个数字共 players.length 份，减去棋盘上和桌面上的（自己手里那张也算露面）。 */
function unseenCounts(state: GameState): number[] {
  const counts = new Array<number>(MAX_NUMBER + 1).fill(state.players.length);
  counts[0] = 0;
  for (const player of state.players) for (const value of player.board) if (value !== null) counts[value]! -= 1;
  for (const value of state.table) counts[value]! -= 1;
  if (state.hand?.value) counts[state.hand.value]! -= 1;
  return counts;
}

/** 这个空格的取值范围 [lo, hi]：同行同列最近的已放牌之间，要给中间的空格留位置。 */
function cellRange(board: Board, cell: number): [number, number] {
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  // 左边 / 上边没有已放牌时，前面的空格也要各占一个更小的数（右边 / 下边同理）
  let lo = 1 + Math.max(row, col);
  let hi = MAX_NUMBER - (SIZE - 1 - Math.min(row, col));
  for (let c = col - 1; c >= 0; c -= 1) {
    const value = board[row * SIZE + c];
    if (value !== null && value !== undefined) { lo = Math.max(lo, value + (col - c)); break; }
  }
  for (let c = col + 1; c < SIZE; c += 1) {
    const value = board[row * SIZE + c];
    if (value !== null && value !== undefined) { hi = Math.min(hi, value - (c - col)); break; }
  }
  for (let r = row - 1; r >= 0; r -= 1) {
    const value = board[r * SIZE + col];
    if (value !== null && value !== undefined) { lo = Math.max(lo, value + (row - r)); break; }
  }
  for (let r = row + 1; r < SIZE; r += 1) {
    const value = board[r * SIZE + col];
    if (value !== null && value !== undefined) { hi = Math.min(hi, value - (r - row)); break; }
  }
  return [lo, hi];
}

/** available[v]：数字 v 还有几张可能拿到（没露面的 + 桌面上的）。 */
function boardValue(board: Board, available: readonly number[], endgame: boolean): number {
  let score = 0;
  for (let cell = 0; cell < CELLS; cell += 1) {
    if (board[cell] !== null) {
      score += endgame ? FILLED * 2 : FILLED;
      continue;
    }
    const [lo, hi] = cellRange(board, cell);
    let room = 0;
    for (let value = lo; value <= hi; value += 1) room += available[value] ?? 0;
    score += room === 0 ? DEAD : ROOM_WEIGHT * Math.min(room, ROOM_CAP) / ROOM_CAP;
  }
  return score;
}

/** 这一格理想的数字：从左上的 1 均匀涨到右下的 20。 */
function ideal(cell: number): number {
  return 1 + ((Math.floor(cell / SIZE) + (cell % SIZE)) * (MAX_NUMBER - 1)) / (2 * (SIZE - 1));
}

/** 顶替是不是让这一格更接近理想数字（至少近半个数）。 */
function improvesSwap(board: Board, cell: number, value: number): boolean {
  const old = board[cell];
  return old === null || old === undefined || Math.abs(value - ideal(cell)) < Math.abs(old - ideal(cell)) - 0.5;
}

/** 把 value 放到最好的格子：返回格子和放完的棋盘价值。fromTable：拿的明牌，顶替要满足 improvesSwap。 */
function bestPlacement(board: Board, value: number, available: readonly number[], endgame: boolean, fromTable = false): { cell: number; score: number } | null {
  let best: { cell: number; score: number } | null = null;
  for (const cell of legalCells(board, value)) {
    if (fromTable && !improvesSwap(board, cell, value)) continue;
    const next = [...board];
    next[cell] = value;
    const score = boardValue(next, available, endgame);
    if (!best || score > best.score) best = { cell, score };
  }
  return best;
}

/** 轮到 playerId 时人机的下一步；没轮到它返回 null。 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  const actions = legalActions(state, playerId);
  if (actions.length === 0) return null;
  const player = state.players[state.currentPlayer]!;
  const unseen = unseenCounts(state);
  const available = unseen.map((count, value) => count + state.table.filter((tile) => tile === value).length);
  const endgame = state.potCount <= ENDGAME_POT;
  const current = boardValue(player.board, available, endgame);

  if (state.stage === "place") {
    const value = state.hand!.value!;
    const fromTable = state.hand!.from === "table";
    const best = bestPlacement(player.board, value, available, endgame, fromTable) ?? bestPlacement(player.board, value, available, endgame);
    const canDiscard = actions.some((action) => action.type === "DISCARD");
    if (best && (!canDiscard || best.score > current)) return { type: "PLACE", cell: best.cell };
    return canDiscard ? { type: "DISCARD" } : actions[0]!;
  }

  // 选牌：明牌逐张算，盲抽算期望
  let choice: { command: GameCommand; score: number } | null = null;
  for (const action of actions) {
    if (action.type !== "TAKE") continue;
    const best = bestPlacement(player.board, state.table[action.index]!, available, endgame, true);
    if (best && (!choice || best.score > choice.score)) choice = { command: action, score: best.score };
  }
  if (state.potCount > 0) {
    let expected = 0;
    let total = 0;
    for (let value = 1; value <= MAX_NUMBER; value += 1) {
      const count = unseen[value]!;
      if (count <= 0) continue;
      const best = bestPlacement(player.board, value, available, endgame);
      expected += count * Math.max(current, best?.score ?? current);
      total += count;
    }
    if (total > 0 && (!choice || expected / total > choice.score)) choice = { command: { type: "DRAW" }, score: expected / total };
  }
  return choice?.command ?? actions[0]!;
}
