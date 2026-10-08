import { CELLS, DIAGONAL, MAX_NUMBER, canPlace, filledCount, legalCells } from "./board.js";
import { createRng } from "./rng.js";
import type { Config, GameCommand, GameEvent, GameState, Player } from "./types.js";

export function defaultConfig(_playerCount: number, overrides: Partial<Config> = {}): Config {
  return { minPlayers: 2, maxPlayers: 4, stepTimeoutSec: 45, ...overrides };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

function currentPlayerId(state: GameState): string {
  return state.players[state.currentPlayer]?.id ?? "";
}

function currentPlayer(state: GameState): Player {
  const player = state.players[state.currentPlayer];
  if (!player) throw new Error("找不到当前玩家。");
  return player;
}

/** 桌面上这张明牌能不能拿：拿了必须放上棋盘，所以要有地方放。 */
function canTake(state: GameState, player: Player, index: number): boolean {
  const value = state.table[index];
  return value !== undefined && legalCells(player.board, value).length > 0;
}

/** 回合结束：有人填满就结束；牌池抽光就按棋盘上牌数定胜负；否则轮到下一位。 */
function endTurn(state: GameState, events: GameEvent[]): void {
  delete state.hand;
  const full = state.players.filter((player) => player.score === CELLS);
  if (full.length > 0) {
    finish(state, events, full.map((player) => player.id), "full");
    return;
  }
  if (state.potCount === 0) {
    const most = Math.max(...state.players.map((player) => player.score));
    finish(state, events, state.players.filter((player) => player.score === most).map((player) => player.id), "potEmpty");
    return;
  }
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  state.turn += 1;
  state.step = 0;
  state.stage = "choose";
  events.push({ type: "TurnStarted", player: currentPlayerId(state) });
}

function finish(state: GameState, events: GameEvent[], winners: string[], reason: "full" | "potEmpty"): void {
  state.phase = "finished";
  state.finalResult = { winner: winners[0]!, winners, reason };
  events.push({ type: "GameEnded", winners, reason });
}

function runCommand(state: GameState, playerId: string, command: GameCommand): { state: GameState; events: GameEvent[] } {
  if (state.phase !== "playing") throw new Error("对局已经结束。");
  if (playerId !== currentPlayerId(state)) throw new Error("还没轮到你。");
  const next = structuredClone(state);
  const player = currentPlayer(next);
  const events: GameEvent[] = [];

  switch (command.type) {
    case "DRAW": {
      if (next.stage !== "choose") throw new Error("手里已经有一张牌了。");
      const value = next.pot?.pop();
      if (value === undefined) throw new Error("牌池已经空了。");
      next.potCount -= 1;
      next.hand = { value, from: "pot" };
      next.stage = "place";
      events.push({ type: "Drew", player: playerId });
      break;
    }
    case "TAKE": {
      if (next.stage !== "choose") throw new Error("手里已经有一张牌了。");
      if (!Number.isInteger(command.index) || !canTake(next, player, command.index)) throw new Error("这张明牌拿不了：棋盘上没有能放它的位置。");
      const [value] = next.table.splice(command.index, 1);
      next.hand = { value: value!, from: "table" };
      next.stage = "place";
      events.push({ type: "Took", player: playerId, value: value! });
      break;
    }
    case "PLACE": {
      const value = next.hand?.value;
      if (next.stage !== "place" || value === null || value === undefined) throw new Error("手里没有牌。");
      if (!canPlace(player.board, command.cell, value)) throw new Error("放在这里不行：每一行从左到右、每一列从上到下都要越来越大。");
      const replaced = player.board[command.cell];
      player.board[command.cell] = value;
      if (replaced !== null && replaced !== undefined) next.table.push(replaced);
      player.score = filledCount(player.board);
      next.lastPlaced = { player: playerId, cell: command.cell };
      events.push({ type: "Placed", player: playerId, value, cell: command.cell, ...(replaced !== null && replaced !== undefined ? { replaced } : {}) });
      endTurn(next, events);
      break;
    }
    case "DISCARD": {
      const value = next.hand?.value;
      if (next.stage !== "place" || value === null || value === undefined) throw new Error("手里没有牌。");
      if (next.hand?.from !== "pot") throw new Error("从桌面拿的明牌必须放上棋盘。");
      next.table.push(value);
      events.push({ type: "Discarded", player: playerId, value });
      endTurn(next, events);
      break;
    }
    default:
      throw new Error("未知操作。");
  }

  if (next.phase === "playing" && next.stage === "place") next.step += 1;
  next.version += 1;
  next.events = events;
  next.log = [...(state.log ?? []), { player: playerId, command }];
  return { state: next, events };
}

export function apply(state: GameState, playerId: string, command: GameCommand): { state: GameState; events: GameEvent[] } {
  return runCommand(state, playerId, command);
}

export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  return runCommand(state, playerId, command).state;
}

/** 当前玩家此刻能做的所有操作。 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase !== "playing" || playerId !== currentPlayerId(state)) return [];
  const player = currentPlayer(state);
  if (state.stage === "choose") {
    const actions: GameCommand[] = state.potCount > 0 ? [{ type: "DRAW" }] : [];
    state.table.forEach((_value, index) => {
      if (canTake(state, player, index)) actions.push({ type: "TAKE", index });
    });
    return actions;
  }
  const value = state.hand?.value;
  if (value === null || value === undefined) return [];
  const actions: GameCommand[] = legalCells(player.board, value).map((cell) => ({ type: "PLACE", cell }));
  if (state.hand?.from === "pot") actions.push({ type: "DISCARD" });
  return actions;
}

/**
 * 超时自动处理：还没选就从牌池抽一张直接弃掉（牌池空了就只能拿明牌，放到第一个能放的位置）；
 * 手里是抽来的牌就弃掉；手里是拿来的明牌就放到第一个能放的位置（优先空格）。
 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "finished") return state;
  const playerId = currentPlayerId(state);
  const stage = state.stage;
  const events: GameEvent[] = [];
  let current = state;
  const step = (command: GameCommand) => {
    const result = runCommand(current, playerId, command);
    events.push(...result.events);
    current = result.state;
  };
  if (current.stage === "choose") {
    const take = legalActions(current, playerId).find((action) => action.type === "TAKE");
    if (current.potCount > 0) step({ type: "DRAW" });
    else if (take) step(take);
  }
  if (current.phase === "playing" && current.stage === "place") {
    if (current.hand?.from === "pot") step({ type: "DISCARD" });
    else {
      const board = currentPlayer(current).board;
      const cells = legalCells(board, current.hand!.value!);
      step({ type: "PLACE", cell: cells.find((cell) => board[cell] === null) ?? cells[0]! });
    }
  }
  if (current === state) {
    // 牌池空了、桌面上也没有能拿的牌：直接结束这一回合。
    current = structuredClone(state);
    endTurn(current, events);
    current.version += 1;
  }
  current.events = [{ type: "TurnTimedOut", player: playerId, stage }, ...events];
  current.log = [...(current.log ?? []), { player: playerId, command: { type: "TIMEOUT" } }];
  return current;
}

/** 发给某位玩家看的状态：去掉牌池顺序和种子；别人从牌池抽的牌看不到数字。 */
export function redactGameForViewer(state: GameState, viewerId: string): GameState {
  const { pot: _pot, seed: _seed, log: _log, ...rest } = state;
  if (rest.hand?.from === "pot" && currentPlayerId(state) !== viewerId) rest.hand = { value: null, from: "pot" };
  return rest;
}

export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  overrides: Partial<Config> = {},
): GameState {
  const config = defaultConfig(players.length, overrides);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  const rng = createRng(seed);
  // 牌池：1–20 每个数字的份数 = 玩家人数（规则 2.2）。
  const tiles: number[] = [];
  for (let copy = 0; copy < players.length; copy += 1) for (let value = 1; value <= MAX_NUMBER; value += 1) tiles.push(value);
  const pot = rng.shuffle(tiles);
  const state: GameState = {
    config,
    phase: "playing",
    players: players.map((player, index) => {
      // 简易开局：盲抽 4 张，从小到大放在对角线上（规则 2.3）。
      const start = [pot.pop()!, pot.pop()!, pot.pop()!, pot.pop()!].sort((a, b) => a - b);
      const board: (number | null)[] = new Array<number | null>(CELLS).fill(null);
      DIAGONAL.forEach((cell, k) => { board[cell] = start[k]!; });
      return { id: player.id, name: player.name, color: index, score: 4, board };
    }),
    currentPlayer: rng.int(players.length),
    turn: 1,
    step: 0,
    stage: "choose",
    potCount: pot.length,
    table: [],
    events: [],
    version: 0,
    pot,
    seed,
  };
  state.events = [{ type: "TurnStarted", player: currentPlayerId(state) }];
  return state;
}
