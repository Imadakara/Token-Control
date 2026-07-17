/** ASCII-прогресс-бар: bar(35, 100, 20) → "███████░░░░░░░░░░░░░". */
export function bar(value: number, max: number, width: number): string {
  const filled = max > 0 ? Math.round((Math.min(value, max) / max) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function pad(s: string | number, width: number): string {
  return String(s).padEnd(width);
}

export function padL(s: string | number, width: number): string {
  return String(s).padStart(width);
}

export function fmtOvm(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}
