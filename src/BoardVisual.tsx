import { memo, useId, type ComponentPropsWithRef } from 'react';
import type { Ball, BoardPlayer, Mark, Point, Scene } from './model';

type Bounds = Point & { width: number; height: number };
type Label = Bounds & { compress: boolean };
export type BoardSelection = { players: string[]; annotation?: string; ball?: boolean };

const PITCH: Bounds = { x: 0, y: 0, width: 1050, height: 680 };
const FULL: Bounds = { x: -103.67, y: -13.625, width: 1257.33, height: 707.25 };
const ASPECT = 16 / 9;
const FONT = 'Arial, Helvetica, sans-serif';
const MARKER_RADIUS = 17;
const OPAQUE_FRAME = '#0d1416';
const arrowKinds = new Set<Mark['kind']>(['run', 'pass', 'carry']);

function cropBounds(scene: Scene): Bounds | undefined {
  const areaWidth = 810;
  const areaHeight = areaWidth / ASPECT;
  const areaY = (PITCH.height - areaHeight) / 2;
  switch (scene.view) {
    case 'attacking': return { x: 525, y: -13, width: 554, height: 706 };
    case 'defensive': return { x: -29, y: -13, width: 554, height: 706 };
    case 'penalty': return { x: 1079 - areaWidth, y: areaY, width: areaWidth, height: areaHeight };
    case 'own-penalty': return { x: -29, y: areaY, width: areaWidth, height: areaHeight };
    default: return undefined;
  }
}

export function getBoardBounds(scene: Scene): Bounds {
  return scene.image
    ? { ...PITCH, height: PITCH.width * scene.image.height / scene.image.width }
    : PITCH;
}

export function getViewBox(scene: Scene): Bounds {
  const bounds = scene.image ? getBoardBounds(scene) : cropBounds(scene);
  if (!bounds) return FULL;
  const crop = scene.image?.fit === 'crop';
  const width = crop
    ? Math.min(bounds.width, bounds.height * ASPECT)
    : Math.max(bounds.width, bounds.height * ASPECT);
  const height = width / ASPECT;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}

export function getVisibleBounds(scene: Scene): Bounds {
  const bounds = getBoardBounds(scene);
  const viewport = (scene.image ? getViewBox(scene) : cropBounds(scene)) ?? bounds;
  const x = Math.max(bounds.x, viewport.x);
  const y = Math.max(bounds.y, viewport.y);
  return {
    x,
    y,
    width: Math.min(bounds.x + bounds.width, viewport.x + viewport.width) - x,
    height: Math.min(bounds.y + bounds.height, viewport.y + viewport.height) - y,
  };
}

export function getBallPoint(ball: Ball | null, players: BoardPlayer[]): Point | null {
  if (!ball) return null;
  const holder = players.find(player => player.id === ball.playerId);
  return holder ? { x: holder.point.x + 23, y: holder.point.y + 12 } : ball.point;
}

const Pitch = memo(function Pitch({ uid }: { uid: string }) {
  // All field coordinates are metres multiplied by ten.
  const arcEnd = Math.sqrt(91.5 ** 2 - 55 ** 2);
  const goalTop = 340 - 36.6;
  const endLines = (
    <>
      <rect x="0" y="138.4" width="165" height="403.2" />
      <rect x="0" y="248.4" width="55" height="183.2" />
      <path d={`M165 ${340 - arcEnd} A91.5 91.5 0 0 1 165 ${340 + arcEnd}`} />
      <path d="M0 10 A10 10 0 0 0 10 0 M0 670 A10 10 0 0 1 10 680" />
      <circle cx="110" cy="340" r="2.8" fill="#f3f7e9" stroke="none" />
    </>
  );

  return (
    <>
      <defs>
        <linearGradient id={`${uid}-turf`} x2="0" y2="1">
          <stop stopColor="#28613d" />
          <stop offset=".52" stopColor="#245837" />
          <stop offset="1" stopColor="#1c4830" />
        </linearGradient>
        <radialGradient id={`${uid}-light`} cx=".51" cy=".36" r=".68">
          <stop stopColor="#cee991" stopOpacity=".12" />
          <stop offset=".62" stopColor="#86b365" stopOpacity=".035" />
          <stop offset="1" stopColor="#031512" stopOpacity=".26" />
        </radialGradient>
        <pattern id={`${uid}-net`} width="3.8" height="3.8" patternUnits="userSpaceOnUse">
          <path d="M0 0H3.8M0 0V3.8" stroke="#e3f6df" strokeWidth=".63" opacity=".7" />
        </pattern>
        <filter id={`${uid}-grain`} x="0" y="0" width="1" height="1">
          <feTurbulence type="fractalNoise" baseFrequency=".54" numOctaves="2" seed="7" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      <rect {...FULL} fill={`url(#${uid}-turf)`} />
      <rect {...FULL} fill="#0a211a" opacity=".48" />
      <rect width="1050" height="680" fill={`url(#${uid}-turf)`} />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={i * 87.5} width="87.5" height="680" fill={i % 2 ? '#00241a' : '#a3d77e'} opacity={i % 2 ? '.105' : '.065'} />
      ))}
      <rect width="1050" height="680" filter={`url(#${uid}-grain)`} opacity=".12" style={{ mixBlendMode: 'soft-light' }} />
      <rect width="1050" height="680" fill={`url(#${uid}-light)`} />
      <g stroke="#f3f7e9" strokeOpacity=".91" strokeWidth="1.85" fill="none">
        <rect width="1050" height="680" />
        <path d="M525 0V680" />
        <circle cx="525" cy="340" r="91.5" />
        <circle cx="525" cy="340" r="3" fill="#f3f7e9" stroke="none" />
        {endLines}
        <g transform="translate(1050 0) scale(-1 1)">{endLines}</g>
        <g fill={`url(#${uid}-net)`} strokeWidth="1.4">
          <rect x="-20" y={goalTop} width="20" height="73.2" rx="1" />
          <rect x="1050" y={goalTop} width="20" height="73.2" rx="1" />
        </g>
      </g>
    </>
  );
});

function numberInk(colour: string) {
  const rgb = colour.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!rgb) return '#fff';
  const channels = [0, 2, 4].map(i => parseInt(rgb.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2] > .36 ? '#12181c' : '#fff';
}

function layoutLabels(players: BoardPlayer[], frame: Bounds): Label[] {
  const occupied: Bounds[] = players.map(({ point }) => ({ x: point.x - 19, y: point.y - 19, width: 38, height: 38 }));
  return players.map(({ name, point }) => {
    const textWidth = Array.from(name).reduce((width, char) => width + (/[ilI.' -]/.test(char) ? 4 : /[mwMW]/.test(char) ? 12 : 7.5), 0);
    const width = Math.min(155, Math.max(41, textWidth + 15));
    const height = 21;
    const middle = point.x - width / 2;
    const placements = [
      [middle, point.y + 21], [middle, point.y - 42],
      [point.x + 21, point.y - 10], [point.x - width - 21, point.y - 10],
      [middle, point.y + 46], [middle, point.y - 67],
    ].map(([x, y]) => ({
      x: Math.max(frame.x + 2, Math.min(x, frame.x + frame.width - width - 2)),
      y: Math.max(frame.y + 2, Math.min(y, frame.y + frame.height - height - 2)),
      width, height,
    }));
    const label = placements.find(box => !occupied.some(other =>
      box.x < other.x + other.width + 1 && box.x + box.width + 1 > other.x
      && box.y < other.y + other.height + 1 && box.y + box.height + 1 > other.y
    )) ?? placements[0];
    occupied.push(label);
    return { ...label, compress: textWidth + 15 > width };
  });
}

function Player({ player, selected, clean, uid, label }: { player: BoardPlayer; selected: boolean; clean: boolean; uid: string; label: Label }) {
  const { point, name, colour, number } = player;
  const labelX = label.x - point.x;
  const labelY = label.y - point.y;
  return (
    <g transform={`translate(${point.x} ${point.y})`} data-player={clean ? undefined : player.id} role="img" aria-label={`${number}, ${name}`}>
      {!clean && <circle r="23" fill="transparent" />}
      {selected && !clean && <circle r="22" fill="none" stroke="#d6fc86" strokeWidth="2" />}
      <ellipse cy="3" rx="19" ry="17.5" fill="#081b15" opacity=".5" />
      <circle r={MARKER_RADIUS} fill={colour} stroke="#f9fff5" strokeWidth="1.65" />
      <circle r="16" fill={`url(#${uid}-token)`} />
      <text y="6" fill={numberInk(colour)} fontFamily={FONT} fontSize="17.2" fontWeight="800" textAnchor="middle">{number}</text>
      <rect x={labelX} y={labelY} width={label.width} height={label.height} rx="4" fill="#0c1b17" fillOpacity=".95" stroke="#ffffff" strokeOpacity=".16" strokeWidth=".65" />
      <text x={labelX + label.width / 2} y={labelY + 15} textAnchor="middle" fill="#fcfff8" fontFamily={FONT} fontSize="14.2" fontWeight="700"
        textLength={label.compress ? label.width - 12 : undefined} lengthAdjust="spacingAndGlyphs">{name}</text>
    </g>
  );
}

function Football({ point, selected, clean }: { point: Point; selected: boolean; clean: boolean }) {
  return (
    <g transform={`translate(${point.x} ${point.y})`} data-ball={clean ? undefined : ''} aria-label="Ball" role="img">
      {!clean && <circle r="15" fill="transparent" />}
      {selected && !clean && <circle r="11.5" fill="none" stroke="#d6fc86" strokeWidth="1.6" />}
      <ellipse cy="1.5" rx="8.2" ry="7.7" fill="#071612" opacity=".7" />
      <circle r="7.3" fill="#fffef0" stroke="#1b2421" strokeWidth=".85" />
      <path d="M0-2.8 2.8-.8 1.7 2.4-1.7 2.4-2.8-.8ZM-1.4-7.05 1.4-7.05 2.1-5.3 0-4.5-2.1-5.3ZM6.3-3.5 7.1-1 5.9.7 4.5-.45 4.85-2.5ZM4.8 5.25 2.4 6.8.7 5.8 1.8 4.3 3.75 4.15ZM-2.4 6.8-4.8 5.25-3.75 4.15-1.8 4.3-.7 5.8ZM-7.1-1-6.3-3.5-4.85-2.5-4.5-.45-5.9.7Z" fill="#202923" />
    </g>
  );
}

function smoothPath(points: Point[]) {
  const first = points[0];
  if (points.length < 3) return points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  const segments = points.slice(1, -1).map((p, index) => {
    const next = points[index + 2];
    return `Q${p.x} ${p.y} ${(p.x + next.x) / 2} ${(p.y + next.y) / 2}`;
  });
  const last = points[points.length - 1];
  return `M${first.x} ${first.y} ${segments.join(' ')} L${last.x} ${last.y}`;
}

function carryPath(start: Point, end: Point, control: Point | undefined) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < 30) return control
    ? `M${start.x} ${start.y} Q${control.x} ${control.y} ${end.x} ${end.y}`
    : `M${start.x} ${start.y} L${end.x} ${end.y}`;
  const middle = control ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const waves = Math.max(1, Math.round(length / 37));
  const steps = waves * 10;
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const inv = 1 - t;
    const x = inv * inv * start.x + 2 * inv * t * middle.x + t * t * end.x;
    const y = inv * inv * start.y + 2 * inv * t * middle.y + t * t * end.y;
    const dx = inv * (middle.x - start.x) + t * (end.x - middle.x);
    const dy = inv * (middle.y - start.y) + t * (end.y - middle.y);
    const norm = Math.hypot(dx, dy) || 1;
    const offset = Math.sin(t * waves * 2 * Math.PI) * 4 * Math.sin(Math.PI * t);
    return { x: x - dy / norm * offset, y: y + dx / norm * offset };
  });
  return smoothPath(points);
}

function Handle({ point, name }: { point: Point; name: string }) {
  return (
    <g data-handle={name}>
      <circle cx={point.x} cy={point.y} r="14" fill="transparent" />
      <circle cx={point.x} cy={point.y} r={name === 'bend' ? '6' : '5'} fill={name === 'bend' ? '#d6fc86' : '#fff'} stroke="#182522" strokeWidth="1.4" />
    </g>
  );
}

const Annotation = memo(function Annotation({ mark, clean, uid, unit }: { mark: Mark; clean: boolean; uid: string; unit: number }) {
  const suffix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const id = `${uid}-${suffix}`;
  const start = mark.points[0];
  const end = mark.points.at(-1);
  if (!start || !end) return null;
  const { kind, colour, control, style } = mark;
  const zone = kind === 'zone';
  const highlight = kind === 'highlight';
  const arrow = arrowKinds.has(kind);
  const dash = style === 'dash' ? `${11 * unit} ${8 * unit}` : style === 'dot' ? `1 ${7 * unit}` : undefined;
  const lineCap = arrow && style !== 'dot' ? 'butt' : 'round';
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(start.x - end.x);
  const height = Math.abs(start.y - end.y);
  const path = kind === 'carry'
    ? carryPath(start, end, control)
    : kind === 'freehand'
      ? smoothPath(mark.points)
      : control
        ? `M${start.x} ${start.y} Q${control.x} ${control.y} ${end.x} ${end.y}`
        : `M${start.x} ${start.y} L${end.x} ${end.y}`;

  return (
    <g data-annotation={clean ? undefined : mark.id}>
      {arrow && (
        <defs>
          <marker id={`${id}-arrow`} markerWidth={17 * unit} markerHeight={14 * unit} refX="16" refY="7" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 17 14" overflow="visible">
            <path d="M0 0 17 7 0 14 3.5 7Z" transform="translate(-1 0)" fill={colour} stroke="#071713" strokeOpacity=".28" strokeWidth=".75" />
          </marker>
        </defs>
      )}
      {zone && (
        <>
          <defs>
            <pattern id={`${id}-hatch`} patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(42)">
              <path d="M0 0V10" stroke={colour} strokeOpacity=".37" strokeWidth="2.2" />
            </pattern>
          </defs>
          <rect {...{ x, y, width, height }} rx="1.6" fill={colour} fillOpacity=".17" />
          <rect {...{ x, y, width, height }} rx="1.6" fill={`url(#${id}-hatch)`} stroke={colour} strokeWidth={2.3 * unit} strokeDasharray={dash} />
        </>
      )}
      {highlight && (
        <>
          <defs>
            <radialGradient id={`${id}-spot`}>
              <stop stopColor={colour} stopOpacity=".06" />
              <stop offset=".79" stopColor={colour} stopOpacity=".12" />
              <stop offset="1" stopColor={colour} stopOpacity=".43" />
            </radialGradient>
          </defs>
          <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} fill={`url(#${id}-spot)`} stroke={colour} strokeWidth={2.5 * unit} strokeDasharray={dash} />
        </>
      )}
      {!zone && !highlight && (
        <>
          {!clean && <path d={path} fill="none" stroke="transparent" strokeWidth={22 * unit} pointerEvents="stroke" />}
          <path d={path} fill="none" stroke="#101b15" strokeOpacity=".48" strokeWidth={6.2 * unit} strokeDasharray={dash} strokeLinecap={lineCap} strokeLinejoin="round" />
          <path d={path} fill="none" stroke={colour} strokeWidth={(kind === 'freehand' ? 3.2 : 3.8) * unit} strokeDasharray={dash} strokeLinecap={lineCap} strokeLinejoin="round"
            markerEnd={arrow ? `url(#${id}-arrow)` : undefined} />
        </>
      )}
    </g>
  );
});

function AnnotationHandles({ mark }: { mark: Mark }) {
  const start = mark.points[0];
  const end = mark.points.at(-1);
  if (!start || !end) return null;
  const bend = mark.control ?? (arrowKinds.has(mark.kind) ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : undefined);
  return (
    <g data-annotation={mark.id}>
      {mark.control && <path d={`M${start.x} ${start.y} L${mark.control.x} ${mark.control.y} ${end.x} ${end.y}`} stroke="#fff" strokeOpacity=".72" strokeDasharray="3 4" fill="none" pointerEvents="none" />}
      {bend && <Handle point={bend} name="bend" />}
      <Handle point={start} name="start" />
      <Handle point={end} name="end" />
    </g>
  );
}

type BoardVisualProps = ComponentPropsWithRef<'svg'> & {
  scene: Scene;
  selection?: BoardSelection;
  marquee?: Bounds;
  clean?: boolean;
};

export function BoardVisual({ scene, selection, marquee, clean = false, style, ...svgProps }: BoardVisualProps) {
  const uid = `board-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const view = getViewBox(scene);
  const bounds = getBoardBounds(scene);
  const clip = scene.image ? bounds : cropBounds(scene);
  const ball = getBallPoint(scene.ball, scene.players);
  const players = scene.image ? [] : scene.players.filter(({ point }) => !clip || (
    point.x >= clip.x && point.x <= clip.x + clip.width && point.y >= clip.y && point.y <= clip.y + clip.height
  ));
  const labels = layoutLabels(players, clip ?? FULL);
  const marks = scene.showAnnotations ? scene.marks : [];
  const activeMark = clean ? undefined : marks.find(mark => mark.id === selection?.annotation);
  const unit = Math.max(1, view.width / FULL.width);

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} width="1920" height="1080" role="img"
      aria-label={scene.image ? 'Match still' : 'Football tactics board'} style={{ aspectRatio: '16 / 9', display: 'block', ...style }} {...svgProps}>
      <defs>
        {clip && <clipPath id={`${uid}-clip`}><rect {...clip} /></clipPath>}
        <linearGradient id={`${uid}-token`} x2="0" y2="1">
          <stop stopColor="#ffffff" stopOpacity=".19" />
          <stop offset=".49" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity=".19" />
        </linearGradient>
      </defs>
      <rect {...view} fill={OPAQUE_FRAME} />
      <g clipPath={clip ? `url(#${uid}-clip)` : undefined}>
        {scene.image
          ? <image href={scene.image.src} {...bounds} preserveAspectRatio="none" />
          : <Pitch uid={uid} />}
        {marks.map(mark => <Annotation key={mark.id} mark={mark} clean={clean} uid={uid} unit={unit} />)}
        {players.map((player, index) => <Player key={player.id} player={player} selected={selection?.players.includes(player.id) ?? false} clean={clean} uid={uid} label={labels[index]} />)}
        {ball && !scene.image && <Football point={ball} selected={selection?.ball ?? false} clean={clean} />}
        {activeMark && <AnnotationHandles mark={activeMark} />}
        {!clean && marquee && <rect {...marquee} fill="#d6fc86" fillOpacity=".12" stroke="#d6fc86" strokeWidth="1.2" strokeDasharray="4 4" pointerEvents="none" />}
      </g>
    </svg>
  );
}
