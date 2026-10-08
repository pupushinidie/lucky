/** 棋盘 4×4，格子编号 0–15，按行排列：第 r 行第 c 列是 r * 4 + c。 */
export const SIZE = 4;
export const CELLS = SIZE * SIZE;
/** 数字牌 1–20。 */
export const MAX_NUMBER = 20;
/** 初始对角线上的 4 格（左上到右下）。 */
export const DIAGONAL = [0, 5, 10, 15] as const;

export type Board = (number | null)[];

/**
 * 把 value 放到 cell（空格，或者顶替那里的牌）后，这一行、这一列是否仍然严格递增（规则 2.4）。
 * 只需要和同行同列的牌比：左边、上边的都比它小，右边、下边的都比它大，所以同行同列也不会重复。
 */
export function canPlace(board: readonly (number | null)[], cell: number, value: number): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return false;
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  for (let c = 0; c < SIZE; c += 1) {
    const other = board[row * SIZE + c];
    if (c === col || other === null || other === undefined) continue;
    if (c < col ? other >= value : other <= value) return false;
  }
  for (let r = 0; r < SIZE; r += 1) {
    const other = board[r * SIZE + col];
    if (r === row || other === null || other === undefined) continue;
    if (r < row ? other >= value : other <= value) return false;
  }
  return true;
}

/** value 能放的所有格子（空格和可顶替的格子都算）。 */
export function legalCells(board: readonly (number | null)[], value: number): number[] {
  const cells: number[] = [];
  for (let cell = 0; cell < CELLS; cell += 1) if (canPlace(board, cell, value)) cells.push(cell);
  return cells;
}

export function filledCount(board: readonly (number | null)[]): number {
  return board.filter((value) => value !== null).length;
}
