import type { Board } from "./board.js";

export interface Config {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 每一步（选抽牌还是拿明牌、放牌）的限时；超时自动处理，见 timeoutTurn。 */
  readonly stepTimeoutSec: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 座位色下标 0–3，开局按入座顺序定。 */
  readonly color: number;
  /** 棋盘上已有几张牌；房间列表里当作「分数」显示。 */
  score: number;
  board: Board;
}

/** 当前玩家手里待处理的一张牌。从牌池抽的只有自己看得到（其他人只看到 value 为 null）。 */
export interface Hand {
  readonly value: number | null;
  readonly from: "pot" | "table";
}

/**
 * choose：回合开始，选从牌池盲抽还是从桌面拿明牌；
 * place：手里有一张牌，放上棋盘（或顶替一张），从牌池抽的也可以弃到桌面。
 */
export type Stage = "choose" | "place";

export type GameCommand =
  | { readonly type: "DRAW" }
  | { readonly type: "TAKE"; readonly index: number }
  | { readonly type: "PLACE"; readonly cell: number }
  | { readonly type: "DISCARD" };

export type GameEvent =
  | { readonly type: "Drew"; readonly player: string }
  | { readonly type: "Took"; readonly player: string; readonly value: number }
  /** replaced：被顶替下来、放到桌面上的牌。 */
  | { readonly type: "Placed"; readonly player: string; readonly value: number; readonly cell: number; readonly replaced?: number }
  | { readonly type: "Discarded"; readonly player: string; readonly value: number }
  | { readonly type: "TurnStarted"; readonly player: string }
  | { readonly type: "TurnTimedOut"; readonly player: string; readonly stage: Stage }
  | { readonly type: "GameEnded"; readonly winners: string[]; readonly reason: "full" | "potEmpty" };

export interface FinalResult {
  /** 第一位获胜者（并列时见 winners）。 */
  readonly winner: string;
  readonly winners: string[];
  /** full：有人填满 16 格；potEmpty：牌池抽光，棋盘上牌最多的人获胜。 */
  readonly reason: "full" | "potEmpty";
}

export interface GameState {
  readonly config: Config;
  phase: "playing" | "finished";
  players: Player[];
  /** 当前玩家在 players 里的下标。 */
  currentPlayer: number;
  /** 第几个回合（每换一位玩家 +1，从 1 开始）。 */
  turn: number;
  /** 本回合内第几步；服务端按 turn + step 给每一步单独计时。 */
  step: number;
  stage: Stage;
  hand?: Hand;
  /** 牌池剩余张数（牌池内容只在服务端，见 pot）。 */
  potCount: number;
  /** 桌面上的明牌，按弃下的先后排列，所有人可见、可拿。 */
  table: number[];
  /** 最近一次放牌，界面高亮用。 */
  lastPlaced?: { readonly player: string; readonly cell: number };
  events: GameEvent[];
  finalResult?: FinalResult;
  /** 每个动作 +1；前端据此判断是不是新事件。 */
  version: number;
  /** 以下只在服务端：牌池顺序、随机数种子、动作序列。 */
  pot?: number[];
  seed?: number;
  log?: { player: string; command: GameCommand | { type: "TIMEOUT" } }[];
}
