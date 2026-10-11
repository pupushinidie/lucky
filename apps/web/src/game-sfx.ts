import { useEffect, useRef } from "react";
import { SIZE, type GameState } from "@lucky/game";
import { sfx, synth } from "./gm-sound.js";

/**
 * 幸运数字的动作音效：对比前后两次对局状态，按 game.events（这一步产生的事件）出声。
 * 自己的动作响亮，别人的减半；观战时都算别人的。第一次拿到状态（进房间、重连、观战刚进来）不出声，
 * 一下跳了好几步只响最后一步。
 *
 *   从牌池盲抽       draw（自己的再「翻」一下看到数字：flip）
 *   拿桌面明牌       draw + 轻的一声 tile
 *   放到空格子       tile（硬质牌落格的「嗒」）
 *   换掉格子里的牌   换牌（招牌）：拿起「嗒」+ 一阵滑动 + 放下「嗒」，换下来的牌落到桌面
 *   弃到桌面        滑一下 + 低一点的 tile
 *   凑满一整行 / 一整列 四叶草铃（招牌）
 *   超时代走（自己）  timeout      轮到你 yourTurn      你交出回合 turnPassed
 *   终局           填满 16 格：sparkle → 赢 / 输；牌池抽光：reveal → 赢 / 输
 */

/** 开发时记下响了哪些声音（自测脚本读 window.__sfxLog）。 */
function cue(name: string, play: () => void, delayMs = 0) {
  const run = () => {
    if (import.meta.env.DEV) (window as unknown as { __sfxLog?: string[] }).__sfxLog?.push(name);
    play();
  };
  if (delayMs > 0) window.setTimeout(run, delayMs);
  else run();
}

/** 点了不能放 / 不能拿的地方。 */
export const pick = {
  deny: () => cue("deny", () => sfx.deny()),
};

/** 换牌：先把格子里的牌拿起来，滑一下，再把新牌放进去。 */
function swap(v: number) {
  synth.noise({ duration: 0.03, volume: 0.25 * v, freq: 2600, q: 2 });
  synth.tone(980, { duration: 0.05, volume: 0.1 * v, type: "triangle" });
  synth.noise({ at: 0.05, duration: 0.16, volume: 0.12 * v, freq: 1200, freqTo: 3200, q: 0.8 });
  synth.noise({ at: 0.2, duration: 0.03, volume: 0.32 * v, freq: 3400, q: 2 });
  synth.tone(1320, { at: 0.2, duration: 0.06, volume: 0.15 * v, type: "triangle" });
  synth.tone(560, { at: 0.2, duration: 0.08, volume: 0.1 * v });
}

/** 弃到桌面：一张牌滑出去落下。 */
function slideOut(v: number) {
  synth.noise({ duration: 0.14, volume: 0.13 * v, freq: 2800, freqTo: 1100, q: 0.8 });
  synth.noise({ at: 0.12, duration: 0.025, volume: 0.22 * v, freq: 2400, q: 2 });
  synth.tone(700, { at: 0.12, duration: 0.06, volume: 0.09 * v, type: "triangle" });
}

/** 四叶草铃：凑满一整行 / 一整列时一串清亮的小铃。 */
function cloverChime(v: number) {
  [1319, 1760, 2093, 2637].forEach((f, i) => {
    synth.tone(f, { at: i * 0.07, duration: 0.35, volume: 0.09 * v });
    synth.tone(f * 2, { at: i * 0.07, duration: 0.12, volume: 0.025 * v });
  });
}

/** 这块棋盘上满了几整行 + 几整列。 */
function fullLines(board: readonly (number | null)[]): number {
  let lines = 0;
  for (let i = 0; i < SIZE; i += 1) {
    let row = true;
    let col = true;
    for (let j = 0; j < SIZE; j += 1) {
      if (board[i * SIZE + j] == null) row = false;
      if (board[j * SIZE + i] == null) col = false;
    }
    if (row) lines += 1;
    if (col) lines += 1;
  }
  return lines;
}

/** myId：自己的玩家 id（观战传空字符串，所有动作都按别人的放）。 */
export function useGameSfx(game: GameState, myId: string) {
  const previous = useRef<GameState | null>(null);
  useEffect(() => {
    const prev = previous.current;
    previous.current = game;
    if (!prev || prev === game || game.version === prev.version) return;
    // 新开一局（再来一局、练习局重开）：只响一声开局。
    if (game.version < prev.version || (prev.phase === "finished" && game.phase !== "finished")) {
      cue("gameStart", () => sfx.gameStart());
      return;
    }
    const isMe = (id: string) => myId !== "" && id === myId;
    let at = 0;
    let timedOutMe = false;

    for (const event of game.events) {
      switch (event.type) {
        case "TurnTimedOut":
          if (isMe(event.player)) {
            timedOutMe = true;
            cue("timeout", () => sfx.timeout());
            at += 380;
          }
          break;
        case "Drew": {
          const mine = isMe(event.player);
          cue("draw", () => sfx.draw(mine, 1), at);
          if (mine) cue("flip", () => sfx.flip(true), at + 150);
          at += 250;
          break;
        }
        case "Took": {
          const mine = isMe(event.player);
          cue("take", () => {
            sfx.draw(mine, 1);
            sfx.tile(mine, 1, 1.25);
          }, at);
          at += 200;
          break;
        }
        case "Placed": {
          const mine = isMe(event.player);
          const v = synth.level(mine);
          if (event.replaced !== undefined) {
            cue("swap", () => swap(v), at);
            cue("tile", () => sfx.tile(mine, 1, 0.8), at + 330);
            at += 450;
          } else {
            cue("tile", () => sfx.tile(mine, 1, 1), at);
            at += 150;
          }
          const before = prev.players.find((player) => player.id === event.player);
          const after = game.players.find((player) => player.id === event.player);
          if (before && after && fullLines(after.board) > fullLines(before.board) && game.phase !== "finished") {
            cue("clover", () => cloverChime(v), at + 80);
            at += 450;
          }
          break;
        }
        case "Discarded": {
          const mine = isMe(event.player);
          cue("discard", () => slideOut(synth.level(mine)), at);
          at += 250;
          break;
        }
        case "GameEnded": {
          const won = myId !== "" && event.winners.includes(myId);
          if (event.reason === "full") cue("sparkle", () => sfx.sparkle(won || event.winners.length === 0), at + 150);
          else cue("reveal", () => sfx.reveal(true), at + 150);
          cue(won ? "win" : "lose", () => sfx.gameOver(won), at + 700);
          at += 700;
          break;
        }
        case "TurnStarted":
          break;
      }
    }

    // 回合交接：轮到你 / 你交出了回合。
    if (game.phase !== "playing" || prev.currentPlayer === game.currentPlayer) return;
    const nowId = game.players[game.currentPlayer]?.id ?? "";
    if (isMe(nowId)) cue("yourTurn", () => sfx.yourTurn(), Math.max(400, at + 150));
    else if (isMe(prev.players[prev.currentPlayer]?.id ?? "") && !timedOutMe) cue("turnPassed", () => sfx.turnPassed(), Math.max(350, at + 100));
  }, [game, myId]);
}
