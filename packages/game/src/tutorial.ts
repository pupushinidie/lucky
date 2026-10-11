/**
 * 新手教程的剧本（幸运数字）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器。规则引擎本身不用随机数（牌池在开局时就洗好了），
 * 所以剧本只要把牌池摆成想要的顺序（pop 从末尾取），抽到哪张、对手怎么走就都是定的。
 *
 * 剧本分两段：
 * 1. 开局（对角线 4 张）：你抽 5 放进空格；咕噜一号抽到 19 放不进空格、弃到桌面；
 *    你拿 19 换掉右下角的 17；咕噜一号拿走你换下的 17。
 * 2. 「快进」到后半段（FAST_FORWARD 换成一个摆好的残局，牌池剩 3 张）：你一格被堵死，
 *    拿 7 填上另一格到 15 格；咕噜一号两格都堵死停在 14 格；你抽一张弃掉，咕噜一号抽走最后一张，
 *    牌池抽光，15:14 你赢。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tutorial="…"）、
 * 等玩家做什么（do 步骤的 expect）。改了规则或界面，tutorial.test.ts 会检查剧本还能不能从头走到尾。
 */
import { CELLS, DIAGONAL, MAX_NUMBER, canPlace, filledCount } from "./board.js";
import { apply, createGame } from "./engine.js";
import { createRng } from "./rng.js";
import type { GameCommand, GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

/** 剧本里的一步：真正的游戏命令，或者「快进到后半段」（只在剧本里有）。 */
export type TutorialMove = GameCommand | { readonly type: "FAST_FORWARD" };

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px）。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值。
   * 固定的有 my-board、pot、hand、discard、table、final、hint；
   * 自己棋盘的格子是 cell:<0–15>（按行数），桌面明牌是 take:<数字>，别人的棋盘是 board:<玩家 id>。
   */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand })
  /** 对手按剧本自动走这几步（或者快进），牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly TutorialMove[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_RIVAL = "p2";
export const TUTORIAL_RIVAL_NAME = "咕噜一号";

/** 开局对角线（从小到大，左上到右下）。 */
const SELF_START = [3, 8, 12, 17] as const;
const RIVAL_START = [2, 6, 11, 18] as const;
/** 开局牌池最后几张（最先被抽到的在最后）：你抽 5，咕噜一号抽 19。 */
const OPENING_DRAWS = [5, 19] as const;

/**
 * 后半段的残局（第 25 手，轮到你）。
 * 你 14 格：第 4 行「13 □ 14」中间那格被堵死，第 1 行第 3 列只能放 6–8（桌面上有 7）。
 * 咕噜一号 14 格：第 1 行第 2 列只能放 3 或 4（两份都已经在棋盘上了），第 4 行「14 □ 15」被堵死。
 */
const LATE_SELF: readonly (number | null)[] = [
  3, 5, null, 9,
  4, 8, 10, 13,
  7, 11, 12, 15,
  13, null, 14, 19,
];
const LATE_RIVAL: readonly (number | null)[] = [
  2, null, 5, 10,
  3, 6, 9, 12,
  4, 8, 11, 17,
  14, null, 15, 18,
];
/** 后半段桌面上的明牌（弃下的先后）。 */
export const LATE_TABLE: readonly number[] = [16, 2, 19, 17, 1, 20, 7, 18, 16];
/** 后半段牌池剩下的 3 张（pop 从末尾取）：咕噜一号抽 6，你抽 1，咕噜一号抽最后一张 20。 */
const LATE_POT: readonly number[] = [20, 1, 6];
export const LATE_TURN = 25;

const takeIndex = (value: number) => LATE_TABLE.indexOf(value);

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    kind: "info", id: "goal", lesson: "目标", anchor: "my-board",
    say: "这是你的棋盘，4×4 一共 16 格。",
    note: "把数字牌一张张摆上去，先摆满 16 格的人获胜。",
  },
  {
    kind: "info", id: "order", lesson: "从小到大", anchor: "my-board",
    say: "每一行从左到右、每一列从上到下，数字都要越来越大。",
    note: "所以同一行、同一列里不会出现相同的数字。",
  },
  {
    kind: "info", id: "diagonal", lesson: "开局对角", anchor: "my-board",
    say: "开局时每人盲抽 4 张，从小到大摆在对角线上。",
    note: "你的是 3、8、12、17：左上最小，右下最大。这一步是自动的，剩下 12 格要你自己填。",
  },
  {
    kind: "do", id: "draw", lesson: "抽牌放牌", anchor: "pot", expect: { type: "DRAW" },
    say: "轮到你了：点「牌池」，盲抽一张。",
    note: "每回合二选一：从牌池抽一张，或者拿桌面上的明牌。现在桌面上还没有牌。",
  },
  {
    kind: "info", id: "lit", anchor: "my-board", face: "think",
    say: "抽到 5。闪着的空格都能放。",
    note: "放进去以后这一行、这一列仍然从小到大，那一格才会亮。带框的牌也能被换掉，等会儿讲。",
  },
  {
    kind: "do", id: "place5", anchor: "cell:1", expect: { type: "PLACE", cell: 1 },
    say: "把 5 放在 3 的右边。",
    note: "左边是 3，下面是 8：3 < 5 < 8，横竖都对。",
  },
  {
    kind: "watch", id: "rival-draw", lesson: "对手的回合", anchor: "hand",
    say: "轮到咕噜一号了，它从牌池抽了一张。",
    moves: [{ type: "DRAW" }],
  },
  {
    kind: "info", id: "hidden", anchor: "hand",
    say: "别人抽到的牌，你看不到是几。",
    note: "要等它放上棋盘或者弃掉，大家才看得到。",
  },
  {
    kind: "watch", id: "rival-discard", anchor: "table",
    say: "看它怎么处理这张……",
    moves: [{ type: "DISCARD" }],
  },
  {
    kind: "info", id: "table", anchor: "table",
    say: "它抽到 19，放不进空格，弃到了桌面上。",
    note: "弃掉的牌面朝上放在桌面，谁都能拿。",
  },
  {
    kind: "do", id: "take19", lesson: "拿明牌换牌", anchor: "take:19", expect: { type: "TAKE", index: 0 },
    say: "这回合不抽牌，拿桌面上的 19。",
    note: "拿明牌不用碰运气，但拿了就必须放上棋盘，不能再弃。放不进你棋盘的明牌会变暗，拿不了。",
  },
  {
    kind: "info", id: "swap-why", anchor: "my-board", face: "think",
    say: "19 放不进空格，但可以「换牌」。",
    note: "把它放到有牌的格子上，顶替原来那张，换下的牌放到桌面。右下角越大，第 4 行、第 4 列能放的数就越多。",
  },
  {
    kind: "do", id: "swap", anchor: "cell:15", expect: { type: "PLACE", cell: 15 },
    say: "点右下角的 17，换成 19。",
  },
  {
    kind: "info", id: "swapped", anchor: "take:17",
    say: "换下的 17 到了桌面上。",
    note: "换牌不会多一格，但能给后面的牌腾出空间。",
  },
  {
    kind: "watch", id: "rival-take", anchor: "board:p2",
    say: "又轮到咕噜一号了。",
    moves: [{ type: "TAKE", index: 0 }, { type: "PLACE", cell: 11 }],
  },
  {
    kind: "info", id: "gift", anchor: "board:p2", face: "surprised",
    say: "咕噜一号拿走了你换下的 17！",
    note: "你弃掉、换下的牌都可能帮到别人，出手前想想对手缺不缺这张。",
  },
  {
    kind: "watch", id: "skip",
    say: "后面每回合都是这样。我们快进到这局的后半段……",
    moves: [{ type: "FAST_FORWARD" }],
  },
  {
    kind: "info", id: "late-pot", lesson: "牌池抽光", anchor: "pot", face: "think",
    say: "现在牌池只剩 3 张了。",
    note: "牌池抽光的那个回合结束就结算：棋盘上牌多的人赢，一样多就并列获胜。",
  },
  {
    kind: "info", id: "dead", anchor: "cell:13", face: "surprised",
    say: "这一格被堵死了：左边 13，右边 14，中间放不进任何数。",
    note: "放牌时给空格留点余地，别让同一行（列）里隔着空格的两张只差 1。",
  },
  {
    kind: "do", id: "take7", anchor: "take:7", expect: { type: "TAKE", index: takeIndex(7) },
    say: "拿桌面上的 7，填第 1 行的空格。",
    note: "第 1 行那格夹在 5 和 9 中间、上面没牌、下面是 10，只能放 6、7、8。",
  },
  {
    kind: "do", id: "place7", anchor: "cell:2", expect: { type: "PLACE", cell: 2 },
    say: "把 7 放进 5 和 9 中间。",
  },
  {
    kind: "watch", id: "rival-late", anchor: "board:p2",
    say: "咕噜一号的回合。",
    moves: [{ type: "DRAW" }, { type: "DISCARD" }],
  },
  {
    kind: "info", id: "rival-stuck", anchor: "board:p2", face: "think",
    say: "咕噜一号的两个空格也放不进牌了，它停在 14 格。",
    note: "你已经 15 格，领先一格。",
  },
  {
    kind: "do", id: "draw-late", anchor: "pot", expect: { type: "DRAW" },
    say: "你领先，就让牌池快点抽光：点「牌池」抽一张。",
  },
  {
    kind: "do", id: "discard", anchor: "discard", expect: { type: "DISCARD" },
    say: "抽到 1，没地方放：点「弃牌」。",
    note: "从牌池抽的牌可以弃到桌面；从桌面拿的明牌不行。",
  },
  {
    kind: "watch", id: "rival-last", anchor: "pot",
    say: "咕噜一号抽走了牌池里最后一张……",
    moves: [{ type: "DRAW" }, { type: "DISCARD" }],
  },
  {
    kind: "info", id: "end", lesson: "结束和胜负", anchor: "final", face: "happy",
    say: "牌池抽光，游戏结束：你 15 格比它多，你赢了！",
    note: "要是有人先摆满 16 格，当场就赢，不用等牌池抽光。",
  },
  {
    kind: "info", id: "timer", lesson: "限时和托管", anchor: "final",
    say: "真实对局里，每一步限时 45 秒。",
    note: "超时会自动抽一张弃掉（拿了明牌就自动放下）；连续超时 2 次转成人机托管，点「取消托管」就能收回。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了！",
    note: "接下来和咕噜一号从头打一局练习。拿不准的时候点「提示」（键盘 H），我告诉你我会怎么走。",
  },
];

/** 两位玩家的局面骨架：名字、座位色。 */
function players(selfName: string, selfBoard: readonly (number | null)[], rivalBoard: readonly (number | null)[]): GameState["players"] {
  return [
    { id: TUTORIAL_SELF, name: selfName, color: 0, score: filledCount(selfBoard), board: [...selfBoard] },
    { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME, color: 1, score: filledCount(rivalBoard), board: [...rivalBoard] },
  ];
}

/** 两人局全套牌（1–20 各 2 张）减去 used，剩下的从小到大。 */
function remainingTiles(used: readonly number[]): number[] {
  const counts = new Array<number>(MAX_NUMBER + 1).fill(2);
  counts[0] = 0;
  for (const value of used) {
    counts[value]! -= 1;
    if (counts[value]! < 0) throw new Error(`教程局面里 ${value} 用了超过 2 张`);
  }
  const rest: number[] = [];
  counts.forEach((count, value) => { for (let k = 0; k < count; k += 1) rest.push(value); });
  return rest;
}

/** 教程开局：你先手，对角线已经摆好，牌池末尾按剧本摆。 */
export function createTutorialGame(selfName: string, seed = 20261011): GameState {
  const game = createGame([{ id: TUTORIAL_SELF, name: selfName }, { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME }], seed);
  const selfBoard = new Array<number | null>(CELLS).fill(null);
  const rivalBoard = new Array<number | null>(CELLS).fill(null);
  DIAGONAL.forEach((cell, k) => { selfBoard[cell] = SELF_START[k]!; rivalBoard[cell] = RIVAL_START[k]!; });
  const rest = remainingTiles([...SELF_START, ...RIVAL_START, ...OPENING_DRAWS]);
  game.players = players(selfName, selfBoard, rivalBoard);
  game.pot = [...createRng(seed).shuffle(rest), ...[...OPENING_DRAWS].reverse()];
  game.potCount = game.pot.length;
  game.currentPlayer = 0;
  game.events = [{ type: "TurnStarted", player: TUTORIAL_SELF }];
  return game;
}

/** 「快进」以后的残局，接着前面那局的名字和版本号。 */
export function createLateGame(previous: GameState): GameState {
  const selfName = previous.players.find((player) => player.id === TUTORIAL_SELF)?.name ?? "你";
  const used = [...LATE_SELF, ...LATE_RIVAL].filter((value): value is number => value !== null);
  const rest = remainingTiles(used);
  for (const value of [...LATE_TABLE, ...LATE_POT]) rest.splice(rest.indexOf(value), 1);
  if (rest.length !== 0) throw new Error("教程残局的牌数对不上");
  const game: GameState = {
    config: previous.config,
    phase: "playing",
    players: players(selfName, LATE_SELF, LATE_RIVAL),
    currentPlayer: 0,
    turn: LATE_TURN,
    step: 0,
    stage: "choose",
    potCount: LATE_POT.length,
    table: [...LATE_TABLE],
    events: [{ type: "TurnStarted", player: TUTORIAL_SELF }],
    version: previous.version + 1,
    pot: [...LATE_POT],
    ...(previous.seed !== undefined ? { seed: previous.seed } : {}),
  };
  return game;
}

/** 剧本里走一步：快进换成残局，其余交给规则引擎（不合法就抛错）。 */
export function tutorialApply(state: GameState, playerId: string, move: TutorialMove): GameState {
  if (move.type === "FAST_FORWARD") return createLateGame(state);
  return apply(state, playerId, move).state;
}

/** 练习局：随机牌池、随机先手。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame([{ id: TUTORIAL_SELF, name: selfName }, { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME }], seed);
}

/** 两条命令是不是同一步。 */
export function sameCommand(a: TutorialMove, b: TutorialMove): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "TAKE" && b.type === "TAKE") return a.index === b.index;
  if (a.type === "PLACE" && b.type === "PLACE") return a.cell === b.cell;
  return true;
}

/** 这一格还有没有数字放得进去（不看牌还剩几张）；false 就是堵死了。 */
export function cellOpen(board: readonly (number | null)[], cell: number): boolean {
  if (board[cell] !== null) return true;
  for (let value = 1; value <= MAX_NUMBER; value += 1) if (canPlace(board, cell, value)) return true;
  return false;
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard 的显示条件）。
 * viewer 是看界面的人（教程里就是你）。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
  const myTurn = state.phase === "playing" && state.players[state.currentPlayer]?.id === viewer;
  if (anchor === "my-board" || anchor === "pot" || anchor === "hand" || anchor === "table") return true;
  if (anchor === "final") return state.phase === "finished";
  if (anchor === "discard") return myTurn && state.stage === "place" && state.hand?.from === "pot";
  if (anchor.startsWith("cell:")) {
    const cell = Number(anchor.slice("cell:".length));
    return Number.isInteger(cell) && cell >= 0 && cell < CELLS;
  }
  if (anchor.startsWith("take:")) return state.table.includes(Number(anchor.slice("take:".length)));
  if (anchor.startsWith("board:")) {
    const id = anchor.slice("board:".length);
    return id !== viewer && state.players.some((player) => player.id === id);
  }
  return false;
}
