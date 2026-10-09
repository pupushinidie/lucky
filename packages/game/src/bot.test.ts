import { describe, expect, it } from "vitest";
import { botCommand } from "./bot.js";
import { applyCommand, createGame, legalActions, redactGameForViewer } from "./engine.js";
import type { GameState } from "./types.js";

function newGame(count: number, seed: number): GameState {
  return createGame(Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` })), seed);
}

/** p1 先手、棋盘按 cells 摆好的局面。 */
function position(cells: Record<number, number>, table: number[] = []): GameState {
  const game = newGame(2, 1);
  game.currentPlayer = 0;
  game.stage = "choose";
  game.players[0]!.board = Array.from({ length: 16 }, (_, cell) => cells[cell] ?? null);
  game.players[0]!.score = Object.keys(cells).length;
  game.table = table;
  return game;
}

describe("人机", () => {
  it("没轮到它时不行动", () => {
    const game = newGame(2, 3);
    const idle = game.players.find((_, index) => index !== game.currentPlayer)!;
    expect(botCommand(game, idle.id)).toBeNull();
  });

  it("全由人机打的 200 局都正常打完，每一步都是合法动作，只用自己看得到的东西", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      let game = newGame(2 + (seed % 3), seed);
      let steps = 0;
      while (game.phase === "playing") {
        steps += 1;
        expect(steps).toBeLessThan(2000);
        const playerId = game.players[game.currentPlayer]!.id;
        const command = botCommand(redactGameForViewer(game, playerId), playerId)!;
        expect(legalActions(game, playerId)).toContainEqual(command);
        game = applyCommand(game, playerId, command);
      }
      expect(game.finalResult?.winners.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("桌面上有正好补空格的明牌就拿", () => {
    // 对角线 3、8、13、18；第一行第二格（cell 1）该放 4–7 之间的数
    const game = position({ 0: 3, 5: 8, 10: 13, 15: 18 }, [5]);
    expect(botCommand(game, "p1")).toEqual({ type: "TAKE", index: 0 });
  });

  it("放牌时不把格子堵死：10 放在中间，不放在 1 号格（那会让左上角只能放 1–9 里更挤的数）", () => {
    const game = position({ 0: 3, 5: 8, 10: 13, 15: 18 });
    game.stage = "place";
    game.hand = { value: 10, from: "pot" };
    const command = botCommand(game, "p1");
    expect(command?.type).toBe("PLACE");
    // 10 夹在 8 和 13 之间：放在 6 或 9 号格（第二行第三列 / 第三行第二列）
    expect([6, 9]).toContain((command as { cell: number }).cell);
  });

});
