import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CELLS, legalCells, type GameEvent, type GameCommand, type GameState, type LobbyMember, type LobbyRoomSnapshot, type Player } from "@lucky/game";
import { art, seatColor } from "./art.js";
import GameRules from "./GameRules.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
}

/**
 * 牌面尺寸档位。牌面原图 32px，只用整数倍（128 / 96 / 64 / 32），像素才不会糊。
 * 桌面端牌桌固定占满可视区域：先用最大一档，渲染后哪一列放不下就降一档（见 useFitLevel）。
 * my：自己的棋盘；hand：手里的牌；opp：其他玩家的棋盘；table：桌面明牌。
 */
const LEVELS = [
  { my: 128, hand: 96, opp: 64, table: 64, stack: false },
  { my: 128, hand: 96, opp: 32, table: 64, stack: false },
  { my: 96, hand: 96, opp: 64, table: 64, stack: false },
  { my: 96, hand: 64, opp: 32, table: 64, stack: false },
  // stack：牌池和手牌挪到自己棋盘下面，中间一列只放桌面明牌和其他玩家（平板、4 人局）
  { my: 64, hand: 64, opp: 32, table: 64, stack: true },
  { my: 64, hand: 64, opp: 32, table: 32, stack: true },
] as const;
/** 手机：竖着排，允许往下滚，自己的棋盘、牌池、手牌、桌面明牌在第一屏。 */
const MOBILE_LEVEL = { my: 64, hand: 64, opp: 32, table: 64, stack: false } as const;
const MOBILE_WIDTH = 760;

/** 牌上数字的字号：12 的整数倍，约占牌面一半。 */
const numberFont = (size: number) => ({ 128: 72, 96: 48, 64: 36, 32: 24 } as Record<number, number>)[size] ?? 24;

function useFitLevel(screen: RefObject<HTMLDivElement | null>, version: number) {
  const [mobile, setMobile] = useState(() => window.innerWidth < MOBILE_WIDTH);
  const [level, setLevel] = useState(0);
  // 窗口大小变了、开了新的一局：从最大一档重新试。
  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { setMobile(window.innerWidth < MOBILE_WIDTH); setLevel(0); }, 120);
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); window.clearTimeout(timer); };
  }, []);
  const lastVersion = useRef(version);
  useEffect(() => {
    if (version < lastVersion.current) setLevel(0);
    lastVersion.current = version;
  }, [version]);
  // 每次渲染后检查：有一列内容超出了自己的高度（或宽度），就降一档。只降不升，桌面明牌变多时不会来回跳。
  useLayoutEffect(() => {
    if (mobile || level >= LEVELS.length - 1 || !screen.current) return;
    const over = [...screen.current.querySelectorAll<HTMLElement>(".lk-fit")]
      .some((column) => column.scrollHeight > column.clientHeight + 1 || column.scrollWidth > column.clientWidth + 1);
    if (over) setLevel(level + 1);
  });
  return mobile ? MOBILE_LEVEL : LEVELS[level]!;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

const cellName = (cell: number) => `第 ${Math.floor(cell / 4) + 1} 行第 ${(cell % 4) + 1} 列`;

function describeEvent(event: GameEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case "Drew":
      return `${name(event.player)} 从牌池抽了一张`;
    case "Took":
      return `${name(event.player)} 拿走桌面上的 ${event.value}`;
    case "Placed":
      return event.replaced !== undefined
        ? `${name(event.player)} 把 ${event.value} 放在${cellName(event.cell)}，换下 ${event.replaced}`
        : `${name(event.player)} 把 ${event.value} 放在${cellName(event.cell)}`;
    case "Discarded":
      return `${name(event.player)} 弃掉 ${event.value}`;
    case "TurnTimedOut":
      return `${name(event.player)} 超时，自动处理`;
    case "GameEnded":
      return event.reason === "full"
        ? `${event.winners.map(name).join("、")} 填满 16 格，获胜！`
        : `牌池抽光了，${event.winners.map(name).join("、")} 棋盘上的牌最多，获胜！`;
    default:
      return null;
  }
}

/** 一张数字牌。 */
export function Tile({ value, hidden = false, size, className = "" }: { value: number | null; hidden?: boolean; size?: number; className?: string }) {
  const style = size ? ({ "--size": `${size}px`, "--num": `${numberFont(size)}px` } as CSSProperties) : undefined;
  return (
    <span className={`lk-tile${hidden ? " hidden" : ""} ${className}`} style={style} aria-label={hidden ? "背面朝上的牌" : String(value)}>
      {!hidden && <b>{value}</b>}
    </span>
  );
}

function Grid({ player, me, hand, size, lastPlaced, onCell }: {
  player: Player;
  me: boolean;
  /** 手里的牌：能放的格子高亮。 */
  hand: number | null;
  /** 牌面边长（32 的整数倍）。 */
  size: number;
  lastPlaced: number | undefined;
  onCell?: (cell: number) => void;
}) {
  const legal = new Set(hand !== null ? legalCells(player.board, hand) : []);
  return (
    <div className={me ? "lk-grid mine" : "lk-grid"} style={{ "--cell": `${size}px` } as CSSProperties} role="grid" aria-label={`${player.name} 的棋盘`}>
      {Array.from({ length: CELLS }, (_, cell) => {
        const value = player.board[cell] ?? null;
        const can = legal.has(cell);
        const classes = ["lk-cell", can ? (value === null ? "can-place" : "can-swap") : "", cell === lastPlaced ? "last" : ""].join(" ");
        const content = value !== null ? <Tile value={value} size={size} /> : null;
        return can && onCell ? (
          <button key={cell} type="button" className={classes} onClick={() => onCell(cell)} title={value === null ? `放在${cellName(cell)}` : `换下 ${value}`}>{content}</button>
        ) : (
          <span key={cell} className={classes}>{content}</span>
        );
      })}
    </div>
  );
}

/** 棋盘上的牌数：大字的数字 + 小字的「/16」。 */
function Score({ value }: { value: number }) {
  return <span className="lk-score"><b>{value}</b>/16</span>;
}

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  // 观战的人没有座位：牌桌按 watchId 那位玩家的座位摆（me 就是他），但什么都不能点，也不叫「你」。
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const current = game.players[game.currentPlayer]!;
  const myTurn = !spectating && game.phase === "playing" && current.id === myId;
  const me = game.players.find((player) => player.id === myId);
  const others = game.players.filter((player) => player.id !== myId);
  const secondsLeft = useCountdown(room);
  const nameOf = (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const memberOf = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId);
  const connected = (playerId: string) => memberOf(playerId)?.connected ?? false;
  // 托管中：人机替我行动，提示条上给一个「取消托管」
  const autoPlaying = member?.auto === true;
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";
  const screen = useRef<HTMLDivElement>(null);
  const sizes = useFitLevel(screen, game.version);

  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  const seenVersion = useRef(game.version);
  useEffect(() => {
    if (game.version === seenVersion.current) return;
    const restarted = game.version < seenVersion.current;
    seenVersion.current = game.version;
    const lines = game.events
      .map((event, index) => ({ key: `${game.version}-${index}`, text: describeEvent(event, nameOf) }))
      .filter((line): line is { key: string; text: string } => line.text !== null)
      .reverse();
    setLog((previous) => [...lines, ...(restarted ? [] : previous)].slice(0, 60));
  }, [game.version]);

  const hand = myTurn && game.stage === "place" ? game.hand?.value ?? null : null;
  const send = (command: GameCommand) => { if (!busy) onCommand(command); };
  const choosing = myTurn && game.stage === "choose";
  const takeable = (value: number) => choosing && me !== undefined && legalCells(me.board, value).length > 0;
  const canDraw = choosing && game.potCount > 0 && !busy;
  // 桌面明牌按数字排好，相同的叠成一张（拿哪一张都一样）；index 是这个数字在桌面上第一次出现的位置。
  const tableGroups = [...new Set(game.table)].sort((a, b) => a - b)
    .map((value) => ({ value, count: game.table.filter((v) => v === value).length, index: game.table.indexOf(value) }));

  const supply = (
    <div className="lk-supply">
      <section className={canDraw ? "lk-panel lk-pot active" : "lk-panel lk-pot"}>
        <h3>牌池<span className="lk-score">剩 <b>{game.potCount}</b></span></h3>
        <button type="button" className="lk-pile" disabled={!canDraw} onClick={() => send({ type: "DRAW" })} title="盲抽一张">
          <Tile value={null} hidden size={64} />
          {canDraw && <span>抽牌</span>}
        </button>
      </section>
      <section className={game.phase === "playing" && game.stage === "place" ? "lk-panel lk-hand active" : "lk-panel lk-hand"}>
        <h3>{game.phase === "playing" && !myTurn ? `${current.name} 手里` : "手里的牌"}</h3>
        {game.phase === "playing" && game.stage === "place" && game.hand ? (
          <>
            <Tile value={game.hand.value} hidden={game.hand.value === null} size={sizes.hand} />
            <div className="lk-hand-info">
              <small>{game.hand.from === "pot" ? "从牌池抽的" : "从桌面拿的"}</small>
              {myTurn && game.hand.from === "pot" && (
                <button type="button" className="quiet-button lk-discard" disabled={busy} onClick={() => send({ type: "DISCARD" })} title="弃到桌面，谁都能拿">弃牌</button>
              )}
            </div>
          </>
        ) : <p className="lk-muted">还没拿牌</p>}
      </section>
    </div>
  );

  let prompt: string;
  if (game.phase === "finished") prompt = "对局结束";
  else if (autoPlaying) prompt = myTurn ? "托管中：人机正在替你走" : "托管中：轮到你时人机替你走";
  else if (choosing) prompt = game.potCount > 0 ? "轮到你：从牌池抽一张，或拿一张桌面明牌" : "牌池空了：只能拿桌面明牌";
  else if (myTurn && game.hand?.from === "pot") prompt = "点亮着的格子放牌，或者弃到桌面";
  else if (myTurn) prompt = "拿了明牌必须放上棋盘：点亮着的格子";
  else prompt = game.stage === "place" ? `${current.name} 正在放牌` : `${current.name} 在选抽牌还是拿明牌`;

  return (
    <div ref={screen} className="lk-screen" style={{ "--tile-img": `url(${art.tile})`, "--opp": `${sizes.opp}px` } as CSSProperties}>
      <header className="lk-topbar">
        {brand}
        <div className="lk-turn">
          <span>第 {game.turn} 手</span>
          {game.phase === "playing" && (
            <span className={myTurn ? "lk-turn-who mine" : "lk-turn-who"}>
              <i className="lk-dot" style={{ background: seatColor(current.color) }} />
              {myTurn ? "轮到你" : `轮到 ${current.name}`}
            </span>
          )}
        </div>
        <div className="lk-topbar-right">
          {themeToggle}
          <GameRules />
          <GameRoomMenu room={room} />
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {connection}
        </div>
      </header>

      <div className={myTurn || autoPlaying ? "lk-prompt mine" : "lk-prompt"} role="status">
        <i className="lk-dot" style={{ background: seatColor(current.color) }} />
        <span className="lk-prompt-text">{prompt}</span>
        {autoPlaying && game.phase === "playing" && (
          <button className="quiet-button lk-auto-cancel" type="button" onClick={() => onAuto(false)}>取消托管</button>
        )}
        {(error || shownNotice) && <span className={error ? "lk-feedback error" : "lk-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</span>}
        {game.phase === "playing" && secondsLeft !== null && <b className={secondsLeft <= 10 ? "lk-timer low" : "lk-timer"} title="这一步还剩的秒数">{secondsLeft}s</b>}
      </div>

      <div className={sizes.stack ? "lk-layout lk-fit stacked" : "lk-layout lk-fit"}>
        {/* 左列：自己的棋盘（stack 档位时牌池和手牌也放这里）；中列：牌池和手牌、桌面明牌、其他玩家 */}
        <div className="lk-col lk-col-mine lk-fit">
          {me && (
            <div className="lk-board-panel mine" style={{ "--seat": seatColor(me.color) } as CSSProperties}>
              <h3><i className="lk-dot" style={{ background: seatColor(me.color) }} />{spectating ? `${me.name}的棋盘（观战视角）` : "你的棋盘"}<Score value={me.score} /></h3>
              <Grid player={me} me hand={hand} size={sizes.my} lastPlaced={game.lastPlaced?.player === me.id ? game.lastPlaced.cell : undefined} onCell={(cell) => send({ type: "PLACE", cell })} />
            </div>
          )}
          {me && sizes.stack && supply}
        </div>
        <div className="lk-col lk-col-mid lk-fit">
          {me && !sizes.stack && supply}
          <section className={choosing && tableGroups.some((group) => takeable(group.value)) ? "lk-panel lk-table active" : "lk-panel lk-table"}>
            <h3>桌面明牌<small>{game.table.length} 张 · 谁都能拿，拿了必须放</small></h3>
            {tableGroups.length === 0 ? <p className="lk-muted">还没有人弃牌。</p> : (
              <div className="lk-table-tiles" style={{ "--tbl": `${sizes.table}px` } as CSSProperties}>
                {tableGroups.map(({ value, count, index }) => {
                  const tile = <Tile value={value} size={sizes.table} />;
                  const badge = count > 1 ? <i className="lk-count">×{count}</i> : null;
                  return takeable(value) ? (
                    <button key={value} type="button" className="lk-take" disabled={busy} onClick={() => send({ type: "TAKE", index })} title={`拿走 ${value}`}>{tile}{badge}</button>
                  ) : (
                    <span key={value} className={choosing ? "lk-take dim" : "lk-take"} title={choosing ? `${value} 放不进你的棋盘` : undefined}>{tile}{badge}</span>
                  );
                })}
              </div>
            )}
          </section>
          <div className="lk-others">
            {others.map((player) => (
              <div
                key={player.id}
                className={["lk-board-panel", game.phase === "playing" && player.id === current.id ? "active" : "", !connected(player.id) ? "offline" : ""].join(" ")}
                style={{ "--seat": seatColor(player.color) } as CSSProperties}
              >
                <h3>
                  <i className="lk-dot" style={{ background: seatColor(player.color) }} />
                  <span className="lk-name">{player.name}</span>
                  <SeatTags member={memberOf(player.id)} />
                  <Score value={player.score} />
                </h3>
                <Grid player={player} me={false} hand={null} size={sizes.opp} lastPlaced={game.lastPlaced?.player === player.id ? game.lastPlaced.cell : undefined} />
              </div>
            ))}
          </div>
        </div>

        <aside className="lk-side">
          {spectating && <SpectateBar room={room} watchId={myId} onWatch={onWatch} onLeave={onLeave} />}
          <section className="lk-panel lk-log">
            <h3>动作记录</h3>
            {log.length === 0 ? <p className="lk-muted">还没有动作。</p> : <ul>{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>}
          </section>
          <div className="lk-chat">{chat}</div>
        </aside>
      </div>
      {game.phase === "finished" && <FinalDialog game={game} room={room} myId={selfId} spectating={spectating} onRematch={onRematch} onLeave={onLeave} />}
    </div>
  );
}

/** 名字后面的标签：人机、托管（离线的人也由人机代打）、离线。 */
function SeatTags({ member }: { member: LobbyMember | undefined }) {
  const offline = !member?.connected;
  return (
    <>
      {member?.bot && <small className="lk-bot">人机</small>}
      {!member?.bot && (member?.auto || offline) && <small className="lk-auto">托管</small>}
      {offline && <small className="lk-offline">离线</small>}
    </>
  );
}

function FinalDialog({ game, room, myId, spectating, onRematch, onLeave }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  spectating: boolean;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
}) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const won = (id: string) => result.winners.includes(id);
  const rows = [...game.players].sort((a, b) => Number(won(b.id)) - Number(won(a.id)) || b.score - a.score);
  const title = won(myId) ? (result.winners.length > 1 ? "并列获胜！" : "你赢了！") : `${result.winners.map((id) => game.players.find((p) => p.id === id)?.name).join("、")} 获胜`;
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel lk-final" role="dialog" aria-modal="true" aria-labelledby="lk-final-title">
        <img className="lk-final-icon" src={art.clover} alt="" />
        <h2 id="lk-final-title">{title}</h2>
        <p className="lk-muted">{result.reason === "full" ? "第一个填满 16 格。" : "牌池抽光了，按棋盘上的牌数定胜负。"}</p>
        <ol className="lk-standings">
          {rows.map((player) => (
            <li key={player.id} className={won(player.id) ? "winner" : ""}>
              <i className="lk-dot" style={{ background: seatColor(player.color) }} />
              <strong>{player.name}{player.id === myId ? "（你）" : ""}</strong>
              <Score value={player.score} />
            </li>
          ))}
        </ol>
        {spectating ? (
          <div className="lk-rematch">
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>
            </div>
          </div>
        ) : room.rematch && (
          <div className="lk-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
