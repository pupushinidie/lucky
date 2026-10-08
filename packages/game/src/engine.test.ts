import { describe, expect, it } from "vitest";
import { CELLS, DIAGONAL, canPlace, legalCells } from "./board.js";
import { applyCommand, createGame, legalActions, redactGameForViewer, timeoutTurn } from "./engine.js";
import { createRng } from "./rng.js";
import type { GameState } from "./types.js";

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `玩家${i}` }));
const who = (state: GameState) => state.players[state.currentPlayer]!.id;
const emptyBoard = () => new Array<number | null>(CELLS).fill(null);

/** 棋盘合法：每行从左到右、每列从上到下严格递增。 */
function boardValid(board: readonly (number | null)[]): boolean {
  return board.every((value, cell) => value === null || canPlace(board, cell, value));
}

describe("摆放规则", () => {
  it("同行左小右大、同列上小下大，不能相等", () => {
    const board = emptyBoard();
    board[5] = 10; // 第 2 行第 2 列
    expect(canPlace(board, 4, 9)).toBe(true); // 左边要更小
    expect(canPlace(board, 4, 10)).toBe(false);
    expect(canPlace(board, 6, 11)).toBe(true); // 右边要更大
    expect(canPlace(board, 6, 10)).toBe(false);
    expect(canPlace(board, 1, 3)).toBe(true); // 上边要更小
    expect(canPlace(board, 9, 3)).toBe(false); // 下边要更大
    expect(canPlace(board, 0, 15)).toBe(true); // 不同行也不同列，不受限制
  });
  it("顶替时不和被顶替的那张比", () => {
    const board = emptyBoard();
    board[0] = 5;
    board[1] = 8;
    expect(canPlace(board, 1, 6)).toBe(true);
    expect(canPlace(board, 1, 5)).toBe(false);
    expect(legalCells(board, 20)).not.toContain(0);
  });
});

describe("开局", () => {
  it.each([2, 3, 4])("%i 人：每个数字 %i 份，对角线 4 张从小到大", (n) => {
    const state = createGame(players(n), 7);
    expect(state.potCount).toBe(20 * n - 4 * n);
    for (const player of state.players) {
      const diagonal = DIAGONAL.map((cell) => player.board[cell]!);
      expect([...diagonal].sort((a, b) => a - b)).toEqual(diagonal);
      expect(player.score).toBe(4);
    }
    const counts = new Map<number, number>();
    for (const value of [...state.pot!, ...state.players.flatMap((p) => p.board.filter((v): v is number => v !== null))]) counts.set(value, (counts.get(value) ?? 0) + 1);
    expect([...counts.values()].every((count) => count === n)).toBe(true);
  });
});

describe("回合", () => {
  it("抽牌后可以弃到桌面，下一位可以拿这张明牌，但拿了必须放", () => {
    let state = createGame(players(2), 1);
    const first = who(state);
    state = applyCommand(state, first, { type: "DRAW" });
    const drawn = state.hand!.value!;
    expect(redactGameForViewer(state, "nobody").hand?.value).toBeNull();
    state = applyCommand(state, first, { type: "DISCARD" });
    expect(state.table).toEqual([drawn]);
    const second = who(state);
    expect(second).not.toBe(first);
    const take = legalActions(state, second).find((a) => a.type === "TAKE");
    if (take) {
      state = applyCommand(state, second, take);
      expect(() => applyCommand(state, second, { type: "DISCARD" })).toThrow();
      expect(legalActions(state, second).every((a) => a.type === "PLACE")).toBe(true);
    }
  });
  it("顶替下来的牌放到桌面", () => {
    let state = createGame(players(2), 3);
    const id = who(state);
    state = applyCommand(state, id, { type: "DRAW" });
    const value = state.hand!.value!;
    const me = state.players[state.currentPlayer]!;
    const swap = legalCells(me.board, value).find((cell) => me.board[cell] !== null);
    if (swap === undefined) return;
    const old = me.board[swap]!;
    state = applyCommand(state, id, { type: "PLACE", cell: swap });
    expect(state.table).toContain(old);
  });
  it("不合法的位置会被拒绝，不是自己回合不能动", () => {
    const state = createGame(players(2), 5);
    const other = state.players.find((p) => p.id !== who(state))!.id;
    expect(() => applyCommand(state, other, { type: "DRAW" })).toThrow();
    const drawn = applyCommand(state, who(state), { type: "DRAW" });
    const illegal = Array.from({ length: CELLS }, (_, c) => c).find((c) => !canPlace(drawn.players[drawn.currentPlayer]!.board, c, drawn.hand!.value!));
    if (illegal !== undefined) expect(() => applyCommand(drawn, who(drawn), { type: "PLACE", cell: illegal })).toThrow();
  });
  it("填满 16 格立刻获胜", () => {
    let state = createGame(players(2), 9);
    const id = who(state);
    const me = state.players[state.currentPlayer]!;
    me.board = Array.from({ length: CELLS }, (_, c) => Math.floor(c / 4) + (c % 4) + 1);
    me.board[15] = null;
    me.score = 15;
    state.pot!.push(20);
    state.potCount += 1;
    state = applyCommand(state, id, { type: "DRAW" });
    state = applyCommand(state, id, { type: "PLACE", cell: 15 });
    expect(state.phase).toBe("finished");
    expect(state.finalResult).toMatchObject({ winner: id, winners: [id], reason: "full" });
  });
  it("超时：没选就抽一张弃掉，换下一位", () => {
    const state = createGame(players(3), 11);
    const after = timeoutTurn(state);
    expect(after.table).toHaveLength(1);
    expect(after.potCount).toBe(state.potCount - 1);
    expect(who(after)).not.toBe(who(state));
    expect(after.events[0]).toMatchObject({ type: "TurnTimedOut", player: who(state) });
  });
});

describe("随机对局", () => {
  it("400 局：棋盘始终合法、牌数守恒、一定能结束", () => {
    let ended = { full: 0, potEmpty: 0 };
    for (let seed = 1; seed <= 400; seed += 1) {
      const n = 2 + (seed % 3);
      const rng = createRng(seed * 31);
      let state = createGame(players(n), seed);
      for (let guard = 0; state.phase === "playing"; guard += 1) {
        if (guard > 2000) throw new Error(`第 ${seed} 局没结束`);
        if (rng.int(20) === 0) { state = timeoutTurn(state); continue; }
        const actions = legalActions(state, who(state));
        // 偏向放牌，少弃牌，否则对局太长
        const places = actions.filter((a) => a.type === "PLACE" && state.players[state.currentPlayer]!.board[a.cell] === null);
        const pick = places.length > 0 && rng.int(4) > 0 ? places : actions;
        state = applyCommand(state, who(state), rng.pick(pick));
      }
      const onBoards = state.players.reduce((sum, p) => sum + p.score, 0);
      if (onBoards + state.table.length + state.potCount !== 20 * n) throw new Error(`第 ${seed} 局牌数不对`);
      if (!state.players.every((p) => boardValid(p.board))) throw new Error(`第 ${seed} 局棋盘不合法`);
      ended[state.finalResult!.reason] += 1;
    }
    expect(ended.full + ended.potEmpty).toBe(400);
  }, 60_000);
});
