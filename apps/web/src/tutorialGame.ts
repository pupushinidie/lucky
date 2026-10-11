/**
 * 幸运数字和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { apply, botCommand, cellOpen, legalCells, type GameState } from "@lucky/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "lucky";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个元素（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

const cellName = (cell: number) => `第 ${Math.floor(cell / 4) + 1} 行第 ${(cell % 4) + 1} 列`;

/** 「提示」：让人机从你的位置算一步（它本来就只看你能看到的信息），配一句原因。 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase !== "playing") return { say: "这局已经结束了。", anchor: null };
  const current = game.players[game.currentPlayer]!;
  if (current.id !== playerId) return { say: `等 ${current.name} 走完再问我。`, anchor: null };
  const command = botCommand(game, playerId);
  if (!command) return { say: "现在没有能做的。", anchor: null };
  const board = current.board;
  const endgame = game.potCount <= 6 ? "牌池快空了，多放一张最要紧。" : "";

  if (command.type === "DRAW") {
    return {
      say: "我会从牌池抽一张。",
      note: game.table.length > 0 ? "桌面上的明牌都不太合适，碰碰运气更好。" : "桌面上还没有明牌。",
      anchor: "pot",
    };
  }
  if (command.type === "TAKE") {
    const value = game.table[command.index]!;
    // 拿了以后放哪：再问一次人机
    let where = "";
    try {
      const taken = apply(game, playerId, command).state;
      const place = botCommand(taken, playerId);
      if (place?.type === "PLACE") {
        where = board[place.cell] === null ? `放进${cellName(place.cell)}的空格。` : `换下${cellName(place.cell)}的 ${board[place.cell]}。`;
      }
    } catch {
      // 算不出来就不说放哪
    }
    return { say: `我会拿桌面上的 ${value}。`, note: `${where}${endgame}` || "明牌是确定的，不用碰运气。", anchor: `take:${value}` };
  }
  if (command.type === "PLACE") {
    const value = game.hand?.value;
    const old = board[command.cell];
    if (old === null || old === undefined) {
      return {
        say: `我会把 ${value} 放在${cellName(command.cell)}。`,
        note: endgame || "放在那里，旁边的空格还留得最宽。",
        anchor: `cell:${command.cell}`,
      };
    }
    return {
      say: `我会用 ${value} 换下${cellName(command.cell)}的 ${old}。`,
      note: "换完那一格离它「该放的数」更近，周围的空格更好填。",
      anchor: `cell:${command.cell}`,
    };
  }
  return {
    say: "我会弃掉这张。",
    note: legalCells(board, game.hand?.value ?? 0).some((cell) => board[cell] === null)
      ? "放进去会把旁边的空格挤得太窄，不如弃掉。"
      : "它放不进任何空格，换牌也不划算。",
    anchor: "discard",
  };
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "took-table": { title: "拿了明牌就要放", text: "从桌面拿的明牌必须放上棋盘（放进空格或换下一张），不能再弃掉。" },
  swapped: { title: "你换下了一张牌", text: "换下的牌放到了桌面，谁都能拿。换牌不会多一格，但能给后面的牌腾空间。" },
  "dead-cell": { title: "有一格被堵死了", text: "它左边、上面的牌和右边、下面的牌只差 1，中间放不进任何数。换掉旁边的牌也许能救回来。" },
  dim: { title: "暗着的明牌", text: "放不进你棋盘的明牌会变暗，拿不了。" },
  "pot-low": { title: "牌池快空了", text: "抽光的那个回合结束就结算：棋盘上牌最多的人赢，一样多就并列。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  const me = game.players.find((player) => player.id === selfId);
  if (!me) return ids;
  for (const event of game.events) {
    if (event.type === "Took" && event.player === selfId) ids.push("took-table");
    if (event.type === "Placed" && event.player === selfId && event.replaced !== undefined) ids.push("swapped");
    if (event.type === "Placed" && event.player === selfId && me.board.some((_value, cell) => !cellOpen(me.board, cell))) ids.push("dead-cell");
  }
  const myTurn = game.phase === "playing" && game.players[game.currentPlayer]?.id === selfId;
  if (myTurn && game.stage === "choose" && game.table.some((value) => legalCells(me.board, value).length === 0)) ids.push("dim");
  if (game.phase === "playing" && game.potCount > 0 && game.potCount <= 5) ids.push("pot-low");
  return ids;
}
