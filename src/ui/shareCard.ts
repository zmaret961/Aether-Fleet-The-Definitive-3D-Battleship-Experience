import type { MatchStory } from '../game/story';

export interface ShareCardInput {
  story: MatchStory;
  won: boolean;
  commander: { name: string; initials: string; from: string; to: string };
  difficultyLabel: string;
  duration: string;
  shots: number;
  accuracyPct: number;
  shipsSunk: number;
  /** final enemy grid: player's shots + which cells belonged to sunk tickets */
  marks: ('unknown' | 'miss' | 'hit')[][];
  sunkCells: Set<string>;
}

export const CARD_W = 1200;
export const CARD_H = 630;

const SANS = "'Inter Variable', system-ui, -apple-system, sans-serif";
const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";

const roundRect = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
};

/** Greedy word wrap; returns the y below the last line. */
const wrap = (c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 3) => {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (c.measureText(test).width > maxW && line) {
      if (lines === maxLines - 1) {
        c.fillText(`${line}…`, x, y);
        return y + lineH;
      }
      c.fillText(line, x, y);
      y += lineH;
      lines += 1;
      line = words[i];
    } else line = test;
  }
  if (line) c.fillText(line, x, y);
  return y + lineH;
};

/**
 * Renders a 1200x630 (Open Graph sized) Cognition-branded field report card.
 * Pure canvas drawing, no DOM screenshots, so it looks identical everywhere.
 */
export async function renderShareCard(input: ShareCardInput, scale = 2): Promise<HTMLCanvasElement> {
  if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * scale;
  canvas.height = CARD_H * scale;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('2D canvas unavailable');
  c.scale(scale, scale);
  const { story, won } = input;
  const accent = won ? '#9aa7ff' : '#fb7185';
  const accentDeep = won ? '#5146ff' : '#be123c';

  // backdrop: abyss gradient, accent bloom, fine grid
  const bg = c.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, '#030a17');
  bg.addColorStop(1, '#0a1838');
  c.fillStyle = bg;
  c.fillRect(0, 0, CARD_W, CARD_H);
  const bloom = c.createRadialGradient(330, 120, 0, 330, 120, 520);
  bloom.addColorStop(0, won ? 'rgba(81,70,255,0.38)' : 'rgba(251,113,133,0.26)');
  bloom.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = bloom;
  c.fillRect(0, 0, CARD_W, CARD_H);
  c.strokeStyle = 'rgba(154,167,255,0.05)';
  c.lineWidth = 1;
  for (let x = 0; x <= CARD_W; x += 30) {
    c.beginPath();
    c.moveTo(x + 0.5, 0);
    c.lineTo(x + 0.5, CARD_H);
    c.stroke();
  }
  for (let y = 0; y <= CARD_H; y += 30) {
    c.beginPath();
    c.moveTo(0, y + 0.5);
    c.lineTo(CARD_W, y + 0.5);
    c.stroke();
  }
  // card frame
  roundRect(c, 16, 16, CARD_W - 32, CARD_H - 32, 28);
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  c.lineWidth = 1.5;
  c.stroke();

  const L = 64;
  // brand bar
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#ffffff';
  c.font = `800 18px ${SANS}`;
  c.letterSpacing = '6px';
  c.fillText('COGNITION', L, 74);
  const brandW = c.measureText('COGNITION').width;
  c.font = `600 13px ${SANS}`;
  c.letterSpacing = '3px';
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.fillText(`·  AETHER FLEET  ·  FIELD REPORT`, L + brandW + 14, 73);
  c.letterSpacing = '0px';

  // headline + subhead
  c.fillStyle = '#ffffff';
  c.font = `800 68px ${SANS}`;
  const headGrad = c.createLinearGradient(L, 110, L, 180);
  headGrad.addColorStop(0, '#ffffff');
  headGrad.addColorStop(1, won ? '#c3ccff' : '#ffd1d9');
  c.fillStyle = headGrad;
  let y = wrap(c, story.headline, L, 160, 600, 70, 2);
  c.fillStyle = 'rgba(255,255,255,0.72)';
  c.font = `500 21px ${SANS}`;
  y = wrap(c, story.subhead, L, y - 8, 600, 30, 2);

  // commander line
  y += 14;
  const av = 44;
  const avGrad = c.createLinearGradient(L, y, L + av, y + av);
  avGrad.addColorStop(0, input.commander.from);
  avGrad.addColorStop(1, input.commander.to);
  roundRect(c, L, y, av, av, 12);
  c.fillStyle = avGrad;
  c.fill();
  c.fillStyle = '#0b1030';
  c.font = `800 16px ${SANS}`;
  c.textAlign = 'center';
  c.fillText(input.commander.initials, L + av / 2, y + av / 2 + 6);
  c.textAlign = 'left';
  c.fillStyle = '#ffffff';
  c.font = `700 18px ${SANS}`;
  c.fillText(input.commander.name, L + av + 14, y + 19);
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.font = `500 15px ${SANS}`;
  c.fillText(`vs ${input.difficultyLabel}  ·  ${input.duration} mission`, L + av + 14, y + 40);

  // stat tiles
  const tiles: [string, string, string][] = [
    ['Accuracy', `${input.accuracyPct}%`, accent],
    ['Shots fired', String(input.shots), '#ffffff'],
    ['Tickets closed', `${input.shipsSunk}/5`, '#5eead4'],
    ['Fleet afloat', `${story.playerAfloat}/5`, story.playerAfloat ? '#9aa7ff' : '#fb7185'],
  ];
  const tw = 140;
  const ty = 400;
  tiles.forEach(([label, value, tone], i) => {
    const tx = L + i * (tw + 12);
    roundRect(c, tx, ty, tw, 84, 16);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.1)';
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = tone;
    c.font = `800 32px ${SANS}`;
    c.fillText(value, tx + 16, ty + 44);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.font = `700 11px ${SANS}`;
    c.letterSpacing = '1.5px';
    c.fillText(label.toUpperCase(), tx + 16, ty + 68);
    c.letterSpacing = '0px';
  });

  // monolith parting shot
  roundRect(c, L, 508, 596, 56, 12);
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fill();
  c.strokeStyle = 'rgba(52,211,153,0.25)';
  c.stroke();
  c.font = `600 13px ${MONO}`;
  c.fillStyle = 'rgba(16,185,129,0.75)';
  c.fillText('LEGACY-MONOLITH>', L + 16, 541);
  const promptW = c.measureText('LEGACY-MONOLITH> ').width;
  c.fillStyle = 'rgba(110,231,183,0.95)';
  wrap(c, story.monolithQuote, L + 16 + promptW, 541, 596 - 32 - promptW, 18, 2);

  // right column: final enemy grid
  const R = 740;
  const gx = R;
  const gy = 92;
  const cell = 26;
  const gs = cell * 10;
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.font = `700 11px ${SANS}`;
  c.letterSpacing = '2px';
  c.fillText('ENEMY BACKLOG · FINAL STATE', gx, gy - 14);
  c.letterSpacing = '0px';
  roundRect(c, gx - 6, gy - 6, gs + 12, gs + 12, 12);
  c.fillStyle = 'rgba(4,16,30,0.75)';
  c.fill();
  c.strokeStyle = 'rgba(154,167,255,0.25)';
  c.stroke();
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const x = gx + col * cell;
      const yy = gy + row * cell;
      const mark = input.marks[row]?.[col] ?? 'unknown';
      const sunk = input.sunkCells.has(`${col},${row}`);
      roundRect(c, x + 2, yy + 2, cell - 4, cell - 4, 4);
      if (mark === 'hit') {
        c.fillStyle = sunk ? 'rgba(94,234,212,0.85)' : 'rgba(251,191,36,0.9)';
        c.fill();
      } else {
        c.fillStyle = 'rgba(255,255,255,0.035)';
        c.fill();
        if (mark === 'miss') {
          c.beginPath();
          c.arc(x + cell / 2, yy + cell / 2, 3, 0, Math.PI * 2);
          c.fillStyle = 'rgba(219,234,254,0.55)';
          c.fill();
        }
      }
    }
  }
  // legend
  const ly = gy + gs + 26;
  const legend: [string, string][] = [
    ['rgba(94,234,212,0.85)', 'Closed'],
    ['rgba(251,191,36,0.9)', 'Hit'],
    ['rgba(219,234,254,0.55)', 'CI failed'],
  ];
  let lx = gx;
  c.font = `600 12px ${SANS}`;
  for (const [col, label] of legend) {
    roundRect(c, lx, ly - 10, 12, 12, 3);
    c.fillStyle = col;
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.fillText(label, lx + 18, ly);
    lx += 30 + c.measureText(label).width;
  }

  // timeline highlights
  const beats = [...story.beats].slice(-4);
  let by = ly + 34;
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.font = `700 11px ${SANS}`;
  c.letterSpacing = '2px';
  c.fillText('SESSION TIMELINE', gx, by);
  c.letterSpacing = '0px';
  by += 24;
  for (const beat of beats) {
    c.beginPath();
    c.arc(gx + 5, by - 5, 4.5, 0, Math.PI * 2);
    c.fillStyle = beat.tone === 'win' ? '#9aa7ff' : beat.tone === 'loss' ? '#fb7185' : '#fcd34d';
    c.fill();
    c.fillStyle = '#ffffff';
    c.font = `600 14px ${SANS}`;
    const title = beat.title.length > 34 ? `${beat.title.slice(0, 33)}…` : beat.title;
    c.fillText(title, gx + 18, by);
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.font = `700 11px ${SANS}`;
    c.fillText(`T${beat.turn}`, gx + 18 + c.measureText(title).width + 46, by);
    by += 26;
  }

  // footer
  c.fillStyle = 'rgba(255,255,255,0.4)';
  c.font = `600 12px ${SANS}`;
  c.textAlign = 'right';
  c.fillText('Built by Devin · the AI software engineer', CARD_W - 48, CARD_H - 40);
  c.textAlign = 'left';
  // accent rule
  const rule = c.createLinearGradient(L, 0, L + 200, 0);
  rule.addColorStop(0, accentDeep);
  rule.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = rule;
  c.fillRect(L, 92, 200, 2);
  return canvas;
}

export const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'),
  );
