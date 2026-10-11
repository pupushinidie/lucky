import { describe, expect, it } from "vitest";
import { CELLS, MAX_NUMBER, canPlace, legalCells } from "./board.js";
import { botCommand } from "./bot.js";
import { apply, legalActions, redactGameForViewer } from "./engine.js";
import {
  anchorVisible,
  cellOpen,
  createPracticeGame,
  createTutorialGame,
  LATE_TABLE,
  sameCommand,
  TUTORIAL_RIVAL,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialApply,
} from "./tutorial.js";
import type { GameState } from "./types.js";

const actorOf = (game: GameState) => game.players[game.currentPlayer]!.id;

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length): GameState {
  let game = createTutorialGame("小蒲");
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = tutorialApply(game, TUTORIAL_SELF, step.expect);
    if (step.kind === "watch") for (const move of step.moves) game = tutorialApply(game, actorOf(game), move);
  }
  return game;
}

const stepIndex = (id: string) => {
  const at = TUTORIAL_STEPS.findIndex((step) => step.id === id);
  if (at < 0) throw new Error(`没有步骤 ${id}`);
  return at;
};
const before = (id: string) => playScript(stepIndex(id));
const after = (id: string) => playScript(stepIndex(id) + 1);
const self = (game: GameState) => game.players.find((player) => player.id === TUTORIAL_SELF)!;
const rival = (game: GameState) => game.players.find((player) => player.id === TUTORIAL_RIVAL)!;

/** 两人局 40 张牌：棋盘 + 桌面 + 牌池 + 手里，每个数字正好 2 张。 */
function expectConserved(game: GameState) {
  const counts = new Array<number>(MAX_NUMBER + 1).fill(0);
  for (const player of game.players) for (const value of player.board) if (value !== null) counts[value]! += 1;
  for (const value of [...game.table, ...(game.pot ?? [])]) counts[value]! += 1;
  if (game.hand?.value) counts[game.hand.value]! += 1;
  expect(counts.slice(1)).toEqual(new Array(MAX_NUMBER).fill(2));
  expect(game.potCount).toBe(game.pot?.length);
}

/** 棋盘每一行、每一列都严格递增。 */
function expectBoardValid(board: readonly (number | null)[]) {
  for (let cell = 0; cell < CELLS; cell += 1) {
    const value = board[cell];
    if (value !== null && value !== undefined) expect(canPlace(board, cell, value), `第 ${cell} 格的 ${value} 不合法`).toBe(true);
  }
}

describe("新手教程剧本", () => {
  it("从头走到尾：每一步要你做的都合法、轮到的是对的人，高亮的东西在界面上看得见，牌数守恒", () => {
    let game = createTutorialGame("小蒲");
    expectConserved(game);
    for (const step of TUTORIAL_STEPS) {
      if (step.anchor && step.kind !== "watch") {
        expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」高亮的 ${step.anchor} 看不见`).toBe(true);
      }
      if (step.kind === "do") {
        expect(actorOf(game), `「${step.id}」不是轮到你`).toBe(TUTORIAL_SELF);
        expect(legalActions(game, TUTORIAL_SELF).some((command) => sameCommand(command, step.expect)), `「${step.id}」这一步不合法`).toBe(true);
        game = tutorialApply(game, TUTORIAL_SELF, step.expect);
      }
      if (step.kind === "watch") {
        if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」开始时 ${step.anchor} 看不见`).toBe(true);
        for (const move of step.moves) {
          if (move.type !== "FAST_FORWARD") {
            expect(actorOf(game), `「${step.id}」里该咕噜一号走`).toBe(TUTORIAL_RIVAL);
            expect(legalActions(game, TUTORIAL_RIVAL).some((command) => sameCommand(command, move)), `「${step.id}」里对手的 ${JSON.stringify(move)} 不合法`).toBe(true);
          }
          const version = game.version;
          game = tutorialApply(game, actorOf(game), move);
          expect(game.version).toBeGreaterThan(version);
        }
        if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」走完时 ${step.anchor} 看不见`).toBe(true);
      }
      expectConserved(game);
      for (const player of game.players) expectBoardValid(player.board);
    }
    expect(game.phase).toBe("finished");
  });

  it("开局：对角线从小到大，你先手；抽到 5、闪着的空格就是能放的格子", () => {
    const start = createTutorialGame("小蒲");
    expect(actorOf(start)).toBe(TUTORIAL_SELF);
    expect([0, 5, 10, 15].map((cell) => self(start).board[cell])).toEqual([3, 8, 12, 17]);
    expect([0, 5, 10, 15].map((cell) => rival(start).board[cell])).toEqual([2, 6, 11, 18]);
    expect(self(start).score).toBe(4);
    const drawn = after("draw");
    expect(drawn.hand).toEqual({ value: 5, from: "pot" });
    expect(legalCells(self(drawn).board, 5)).toContain(1);
    expect(self(after("place5")).board[1]).toBe(5);
  });

  it("对手的回合：抽到的牌你看不到；19 放不进它的空格，弃到桌面", () => {
    const drew = after("rival-draw");
    expect(drew.hand?.value).toBe(19);
    expect(redactGameForViewer(drew, TUTORIAL_SELF).hand).toEqual({ value: null, from: "pot" });
    const board = rival(drew).board;
    expect(board.some((value, cell) => value === null && canPlace(board, cell, 19))).toBe(false);
    expect(after("rival-discard").table).toEqual([19]);
  });

  it("拿明牌换牌：19 放不进你的空格只能换牌，换下的 17 被咕噜一号拿走", () => {
    const took = after("take19");
    expect(took.hand).toEqual({ value: 19, from: "table" });
    // 拿来的明牌不能弃
    expect(legalActions(took, TUTORIAL_SELF).some((command) => command.type === "DISCARD")).toBe(false);
    const board = self(took).board;
    expect(legalCells(board, 19).every((cell) => board[cell] !== null)).toBe(true);
    const swapped = after("swap");
    expect(self(swapped).board[15]).toBe(19);
    expect(self(swapped).score).toBe(5);
    expect(swapped.table).toEqual([17]);
    const taken = after("rival-take");
    expect(rival(taken).board[11]).toBe(17);
    expect(taken.table).toEqual([]);
    expect(actorOf(taken)).toBe(TUTORIAL_SELF);
  });

  it("快进后的残局：牌池剩 3 张，你那一格堵死、另一格只能放 6–8；咕噜一号两格都堵死", () => {
    const late = after("skip");
    expect(late.potCount).toBe(3);
    expect(late.table).toEqual([...LATE_TABLE]);
    expect(self(late).score).toBe(14);
    expect(rival(late).score).toBe(14);
    expect(cellOpen(self(late).board, 13)).toBe(false);
    expect(cellOpen(self(late).board, 2)).toBe(true);
    // 咕噜一号的两个空格：之后出现的牌（桌面、牌池）一张都放不进去
    const rivalBoard = rival(late).board;
    const rivalEmpty = rivalBoard.map((value, cell) => (value === null ? cell : -1)).filter((cell) => cell >= 0);
    for (const value of [...late.table, ...late.pot!]) {
      for (const cell of rivalEmpty) expect(canPlace(rivalBoard, cell, value), `${value} 能放进咕噜一号的 ${cell}`).toBe(false);
    }
    // 7 填进第 1 行以后，你剩下的那格也放不进任何之后出现的牌
    const placed = after("place7");
    expect(self(placed).score).toBe(15);
    const rest = [...placed.table, ...placed.pot!];
    expect(rest.some((value) => canPlace(self(placed).board, 13, value))).toBe(false);
  });

  it("结局：牌池抽光，15 比 14，你赢（按牌数）", () => {
    const end = before("end");
    expect(end.phase).toBe("finished");
    expect(end.potCount).toBe(0);
    expect(end.finalResult).toMatchObject({ winners: [TUTORIAL_SELF], reason: "potEmpty" });
    expect(self(end).score).toBe(15);
    expect(rival(end).score).toBe(14);
  });

  it("剧本本身：步骤 id 不重复，最后一步是唯一的收尾，说明文字不空，课程不超过 9 个", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) expect(step.say.trim().length).toBeGreaterThan(0);
    expect(TUTORIAL_STEPS.filter((step) => step.lesson).length).toBeLessThanOrEqual(9);
  });

  it("剧本走完接练习局：两边都交给人机，120 局都能正常打完", () => {
    const stuck: string[] = [];
    for (let seed = 1; seed <= 120; seed += 1) {
      let game = createPracticeGame("小蒲", seed);
      let moves = 0;
      while (game.phase === "playing" && moves < 3000) {
        const actor = actorOf(game);
        const command = botCommand(redactGameForViewer(game, actor), actor);
        if (!command) break;
        game = apply(game, actor, command).state;
        moves += 1;
      }
      if (game.phase !== "finished" || !game.finalResult) stuck.push(`第 ${seed} 局（${moves} 步）`);
    }
    expect(stuck).toEqual([]);
  }, 60_000);
});
