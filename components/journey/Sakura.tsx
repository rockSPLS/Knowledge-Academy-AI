import type { LeafState } from "./gamification";

// Компаньон прогресса — сакура-бонсай. Ветка — чекпоинт (появляется, когда чекпоинт
// начат), подушка из листьев — упражнение: зелёная — верно, светлая — частично,
// жёлтая и поникшая — ошибка (и два листа падают к горшку); более поздний верный ответ
// возвращает цвет, упавшие листья исчезают. Почка — упражнение впереди.
// Макушка — всегда зелёная, чтобы в начале дерево не было голым.
// В конце путешествия на зелёных подушках распускаются цветы, несколько лепестков падает.
// Цвета — токены «палитры компаньона» в globals.css; смена цвета листьев и появление
// цветов анимированы, только если человек не просил уменьшить движение.

type Point = readonly [number, number];

// Ветки: точка на стволе и центр главной подушки
const BRANCHES: readonly { trunk: Point; pad: Point }[] = [
  { trunk: [114, 150], pad: [58, 142] },
  { trunk: [118, 128], pad: [180, 120] },
  { trunk: [112, 106], pad: [60, 96] },
  { trunk: [118, 88], pad: [174, 78] },
  { trunk: [117, 72], pad: [76, 58] },
];

// Листья подушки: задний ряд и передний (меньше); углы — куда смотрит кончик листа
const BACK_ANGLES = [-170, -145, -120, -60, -35, -10];
const FRONT_ANGLES = [-150, -110, -75, -40];

// Лист — заострённый, от черешка (0, 0) вправо, с жилкой
const LEAF_PATH = "M0 0 C3 -3.4 9 -3.4 13 0 C9 3.4 3 3.4 0 0 Z";
// Лепесток сакуры — с надрезом на конце
const PETAL_PATH = "M0 0 C-3.2 -2 -3.4 -6.5 -1.2 -7.4 L0 -6.2 L1.2 -7.4 C3.4 -6.5 3.2 -2 0 0 Z";

const TRANSITION = "motion-safe:transition-colors motion-safe:duration-700";

type PadColors = { base: string; back: string; backEdge: string; front: string; frontEdge: string };

const PAD_COLORS: Record<Exclude<LeafState, "pending">, PadColors> = {
  correct: {
    base: "fill-plant-leaf-edge",
    back: "fill-plant-leaf",
    backEdge: "stroke-plant-leaf-edge",
    front: "fill-plant-leaf-light",
    frontEdge: "stroke-plant-leaf",
  },
  healed: {
    base: "fill-plant-leaf-edge",
    back: "fill-plant-leaf",
    backEdge: "stroke-plant-leaf-edge",
    front: "fill-plant-leaf-light",
    frontEdge: "stroke-plant-leaf",
  },
  partial: {
    base: "fill-plant-leaf-edge",
    back: "fill-plant-leaf-light",
    backEdge: "stroke-plant-leaf-edge",
    front: "fill-plant-leaf-highlight",
    frontEdge: "stroke-plant-leaf-light",
  },
  wilted: {
    base: "fill-plant-wilt-edge",
    back: "fill-plant-wilt",
    backEdge: "stroke-plant-wilt-edge",
    front: "fill-plant-wilt-light",
    frontEdge: "stroke-plant-wilt",
  },
};

// Куда падают листья с жёлтых подушек и лепестки в конце путешествия
const FALLEN_LEAVES: readonly [number, number][] = [
  [92, -15],
  [138, 170],
  [104, 20],
  [126, 195],
  [84, 160],
  [148, -30],
];
const FALLING_PETALS: readonly [number, number, number][] = [
  [44, 170, 30],
  [196, 160, -40],
  [178, 182, 70],
  [60, 186, 15],
];

// Подушки упражнений на ветке: главная на конце, вторая ближе к стволу, третья выше
function padPoints({ trunk, pad }: (typeof BRANCHES)[number]): Point[] {
  return [
    pad,
    [trunk[0] + (pad[0] - trunk[0]) * 0.62, trunk[1] + (pad[1] - trunk[1]) * 0.62 - 9],
    [pad[0] + (pad[0] < trunk[0] ? 10 : -10), pad[1] - 15],
  ];
}

// Текст для экранного диктора: картинку он не видит
function describe(leaves: LeafState[][], bloom: boolean): string {
  const all = leaves.flat();
  const green = all.filter((s) => s === "correct" || s === "healed").length;
  const light = all.filter((s) => s === "partial").length;
  const wilted = all.filter((s) => s === "wilted").length;
  const parts = [`верно — ${green}`];
  if (light > 0) parts.push(`частично — ${light}`);
  if (wilted > 0) parts.push(`увядает — ${wilted}`);
  return `Дерево знаний, сакура${bloom ? " в цвету" : ""}. Упражнения: ${parts.join(", ")}`;
}

type SakuraProps = {
  // Состояния упражнений по чекпоинтам; веток рисуется столько, сколько чекпоинтов начато
  leaves: LeafState[][];
  started: number;
  bloom: boolean;
  className?: string;
};

export function Sakura({ leaves, started, bloom, className }: SakuraProps) {
  const branches = leaves.slice(0, Math.min(started, BRANCHES.length));
  const wiltedCount = branches.flat().filter((state) => state === "wilted").length;
  // По два упавших листа с каждой жёлтой подушки
  const fallen = FALLEN_LEAVES.slice(0, Math.min(FALLEN_LEAVES.length, wiltedCount * 2));

  return (
    <svg viewBox="20 20 200 205" role="img" aria-label={describe(leaves, bloom)} className={className}>
      {/* Ствол с прожилками коры */}
      <path
        d="M104 192 C 96 168 128 150 112 126 C 100 108 120 92 116 64 L 123 64 C 128 94 110 110 122 126 C 141 150 114 170 138 192 Z"
        className="fill-plant-trunk"
      />
      <path
        d="M110 186 C 106 170 124 154 116 136 M118 120 C 112 108 120 96 119 80"
        fill="none"
        strokeWidth={1}
        className="stroke-plant-trunk-edge opacity-70"
      />

      {/* Макушка — раньше веток, чтобы не закрывать подушки пятого чекпоинта */}
      <path d="M119 64 Q119 52 112 44" fill="none" strokeWidth={3} strokeLinecap="round" className="stroke-plant-trunk" />
      <Pad x={110} y={44} state="correct" />
      {bloom && <Blossoms x={110} y={44} />}

      {branches.map((states, index) => {
        const branch = BRANCHES[index];
        const [tx, ty] = branch.trunk;
        const [px, py] = branch.pad;
        const points = padPoints(branch);
        return (
          <g key={index}>
            <path
              d={`M${tx} ${ty} Q${(tx + px) / 2} ${Math.min(ty, py) - 10} ${px} ${py}`}
              fill="none"
              strokeWidth={4.5}
              strokeLinecap="round"
              className="stroke-plant-trunk"
            />
            {states.map((_, j) => {
              const [x, y] = points[j] ?? branch.pad;
              return (
                <path
                  key={j}
                  d={`M${x} ${y + 4} L${x + (tx - x) * 0.25} ${y + (ty - y) * 0.25 + 3}`}
                  strokeWidth={2}
                  strokeLinecap="round"
                  className="stroke-plant-trunk"
                />
              );
            })}
            {states.map((state, j) => {
              const [x, y] = points[j] ?? branch.pad;
              return (
                <g key={`pad-${j}`}>
                  <Pad x={x} y={y} state={state} />
                  {bloom && (state === "correct" || state === "healed") && <Blossoms x={x} y={y} />}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Мох, камешек, упавшие листья (лежат на земле над краем горшка) */}
      {[
        [70, 189, 5],
        [82, 187, 7],
        [96, 188, 6],
        [146, 188, 7],
        [160, 189, 5],
        [170, 190, 4],
      ].map(([x, y, r]) => (
        <g key={x}>
          <circle cx={x} cy={y} r={r} className="fill-plant-leaf" />
          <circle cx={x - 1} cy={y - 1} r={r * 0.55} className="fill-plant-leaf-light" />
        </g>
      ))}
      <ellipse cx={158} cy={189} rx={7} ry={4} strokeWidth={0.6} className="fill-plant-stone stroke-plant-stone-edge" />
      {fallen.map(([x, angle]) => (
        <Leaf key={x} x={x} y={185} angle={angle} scale={0.9} fill="fill-plant-wilt" edge="stroke-plant-wilt-edge" />
      ))}

      {/* Глазурованный горшок на ножках */}
      <path d="M56 196 H184 L176 214 H64 Z" strokeWidth={1} className="fill-plant-pot stroke-plant-pot-edge" />
      <rect x={52} y={190} width={136} height={8} rx={3} className="fill-plant-pot-edge" />
      <path d="M66 201 H174" strokeWidth={1.2} className="stroke-plant-pot-light opacity-70" />
      <rect x={70} y={214} width={12} height={5} rx={1} className="fill-plant-pot-edge" />
      <rect x={158} y={214} width={12} height={5} rx={1} className="fill-plant-pot-edge" />

      {bloom &&
        FALLING_PETALS.map(([x, y, angle]) => (
          // Анимация — на обёртке: CSS-transform анимации заменил бы transform лепестка
          <g
            key={x}
            className="motion-safe:animate-bloom"
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          >
            <path
              d={PETAL_PATH}
              transform={`translate(${x} ${y}) rotate(${angle})`}
              strokeWidth={0.4}
              className="fill-plant-petal stroke-plant-petal-edge opacity-85"
            />
          </g>
        ))}
    </svg>
  );
}

function Leaf({
  x,
  y,
  angle,
  scale = 1,
  fill,
  edge,
}: {
  x: number;
  y: number;
  angle: number;
  scale?: number;
  fill: string;
  edge: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <path d={LEAF_PATH} strokeWidth={0.5} className={`${fill} ${edge} ${TRANSITION}`} />
      <path d="M1 0 L11 0" strokeWidth={0.4} className={`${edge} opacity-60 ${TRANSITION}`} />
    </g>
  );
}

// Подушка листьев одного упражнения (или почка, если упражнение впереди)
function Pad({ x, y, state }: { x: number; y: number; state: LeafState }) {
  if (state === "pending") {
    return <circle cx={x} cy={y} r={3.2} strokeWidth={0.8} className="fill-plant-leaf-light stroke-plant-leaf-edge" />;
  }
  const colors = PAD_COLORS[state];
  // Поникшие листья смотрят кончиком вниз
  const droop = (angle: number) => (state === "wilted" ? (angle < -90 ? angle - 60 : angle + 60) : angle);
  return (
    <g>
      <ellipse cx={x} cy={y + 2} rx={17} ry={8} className={`${colors.base} opacity-90 ${TRANSITION}`} />
      {BACK_ANGLES.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <Leaf
            key={angle}
            x={x + 8 * Math.cos(rad)}
            y={y + 4 + 5 * Math.sin(rad)}
            angle={droop(angle)}
            fill={colors.back}
            edge={colors.backEdge}
          />
        );
      })}
      {FRONT_ANGLES.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <Leaf
            key={angle}
            x={x + 3 * Math.cos(rad)}
            y={y + 1 + 3 * Math.sin(rad)}
            angle={droop(angle)}
            scale={0.85}
            fill={colors.front}
            edge={colors.frontEdge}
          />
        );
      })}
    </g>
  );
}

// Три цветка сакуры: пять лепестков с надрезом и тычинки
function Blossoms({ x, y }: { x: number; y: number }) {
  return (
    <>
      {[
        [-9, -6],
        [6, -9],
        [12, 1],
      ].map(([dx, dy], index) => {
        const fx = x + dx;
        const fy = y + dy;
        return (
          <g
            key={index}
            className="motion-safe:animate-bloom"
            style={{ transformBox: "fill-box", transformOrigin: "center", animationDelay: `${index * 150}ms` }}
          >
            {[0, 72, 144, 216, 288].map((angle) => (
              <path
                key={angle}
                d={PETAL_PATH}
                transform={`translate(${fx} ${fy}) rotate(${angle + index * 15})`}
                strokeWidth={0.4}
                className="fill-plant-petal stroke-plant-petal-edge"
              />
            ))}
            <circle cx={fx} cy={fy} r={1.6} className="fill-plant-core" />
            {[0, 120, 240].map((angle) => {
              const rad = (angle * Math.PI) / 180;
              return (
                <circle
                  key={angle}
                  cx={fx + 2.4 * Math.cos(rad)}
                  cy={fy + 2.4 * Math.sin(rad)}
                  r={0.55}
                  className="fill-plant-petal-edge"
                />
              );
            })}
          </g>
        );
      })}
    </>
  );
}
