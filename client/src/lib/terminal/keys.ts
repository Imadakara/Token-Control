/** Нормализация легаси-имён клавиш (IE/автоматизация): Down → ArrowDown и т.п. */
const LEGACY: Record<string, string> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Esc: 'Escape',
  Del: 'Delete',
};

export function keyOf(e: KeyboardEvent): string {
  return LEGACY[e.key] ?? e.key;
}
