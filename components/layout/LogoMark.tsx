// Знак сайта «Собеседники»: человек (круглая голова) и ИИ (квадратная голова с антенной)
// разговаривают — над человеком облачко «печатает…». Человек — контур, ИИ — заливка,
// у ИИ «пиксельная» улыбка: дружелюбный, но всё же машина.
// Один рисунок для шапки и обложки превью: в шапке цвета берутся из токенов темы,
// на обложке (app/opengraph-image.tsx) передаются готовые значения — там нет CSS-переменных.

export type LogoColors = {
  // Контуры, точки «печатает…», голова ИИ и антенна
  line: string;
  // Заливка облачка
  soft: string;
  // Глаза и улыбка ИИ (поверх заливки)
  onFill: string;
};

// По умолчанию — токены темы: в тёмной теме знак светлее и читается на тёмном фоне.
// Детали на голове ИИ — цветом фона страницы: белые в светлой теме, почти чёрные
// в тёмной (на светлом индиго белые глаза были бы плохо видны)
const THEME_COLORS: LogoColors = {
  line: "var(--accent)",
  soft: "var(--accent-soft)",
  onFill: "var(--background)",
};

type LogoMarkProps = {
  size: number;
  colors?: LogoColors;
};

export function LogoMark({ size, colors = THEME_COLORS }: LogoMarkProps) {
  const { line, soft, onFill } = colors;
  return (
    // Знак декоративный: рядом всегда есть название сайта
    // shrink-0: рядом с длинным названием на телефоне знак не должен сжиматься
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {/* Облачко «печатает…» над человеком */}
      <path
        d="M14 4 H58 Q64 4 64 10 V24 Q64 30 58 30 H28 L19 38 V30 H14 Q8 30 8 24 V10 Q8 4 14 4Z"
        fill={soft}
        stroke={line}
        strokeWidth={3.5}
        strokeLinejoin="round"
      />
      <circle cx={24} cy={17} r={3.6} fill={line} />
      <circle cx={36} cy={17} r={3.6} fill={line} fillOpacity={0.6} />
      <circle cx={48} cy={17} r={3.6} fill={line} fillOpacity={0.3} />
      {/* Человек: круглая голова контуром, глаза и улыбка */}
      <circle cx={25} cy={66} r={20} fill="none" stroke={line} strokeWidth={5} />
      <circle cx={18.5} cy={63} r={3.2} fill={line} />
      <circle cx={31.5} cy={63} r={3.2} fill={line} />
      <path d="M17 72 Q25 78 33 72" fill="none" stroke={line} strokeWidth={3.5} strokeLinecap="round" />
      {/* ИИ: квадратная голова с антенной, глаза-экраны и пиксельная улыбка */}
      <path d="M76 46 V38" stroke={line} strokeWidth={4} strokeLinecap="round" />
      <circle cx={76} cy={36} r={4} fill={line} />
      <rect x={56} y={46} width={40} height={40} rx={9} fill={line} />
      <rect x={63} y={58} width={9} height={7} rx={1.5} fill={onFill} />
      <rect x={80} y={58} width={9} height={7} rx={1.5} fill={onFill} />
      <path
        d="M65 70 V74 H69 V77 H83 V74 H87 V70"
        fill="none"
        stroke={onFill}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
