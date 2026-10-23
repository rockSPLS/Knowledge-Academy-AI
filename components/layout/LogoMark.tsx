// Знак сайта «Собеседники»: человек (круглая голова) и ИИ (квадратная голова с антенной)
// разговаривают — в строку: человек, между ними облачко, ИИ. В облачке маршрут
// с чекпоинтами и флажком: ИИ ведёт по маршруту. Знак широкий (3 : 1): облачко посередине
// шире, чем было над головой человека, и маршрут читается даже в шапке.
// Человек — контур, ИИ — заливка, у ИИ «пиксельная» улыбка: дружелюбный, но всё же машина.
// Один рисунок для шапки и обложки превью: в шапке цвета берутся из токенов темы,
// на обложке (app/opengraph-image.tsx) передаются готовые значения — там нет CSS-переменных.

export type LogoColors = {
  // Контуры, маршрут в облачке, голова ИИ и антенна
  line: string;
  // Заливка облачка и следующего чекпоинта
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
  // Высота знака; ширина — втрое больше
  size: number;
  colors?: LogoColors;
  // Например, другой размер на узком экране (классы ширины и высоты перекрывают size)
  className?: string;
};

export function LogoMark({ size, colors = THEME_COLORS, className = "" }: LogoMarkProps) {
  const { line, soft, onFill } = colors;
  return (
    // Знак декоративный: рядом всегда есть название сайта
    // Сжимается ли знак в тесной строке — решает место использования (className)
    <svg
      width={size * 3}
      height={size}
      viewBox="0 0 180 60"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* Человек: круглая голова контуром, глаза и улыбка */}
      <circle cx={22} cy={34} r={17} fill="none" stroke={line} strokeWidth={4.5} />
      <circle cx={16.5} cy={31.5} r={2.8} fill={line} />
      <circle cx={27.5} cy={31.5} r={2.8} fill={line} />
      <path d="M15 39 Q22 44.5 29 39" fill="none" stroke={line} strokeWidth={3.2} strokeLinecap="round" />
      {/* Облачко между ними, хвостиком к человеку */}
      <path
        d="M58 13 H120 Q127 13 127 20 V40 Q127 47 120 47 H58 Q51 47 51 40 V36 L45 33 L51 30 V20 Q51 13 58 13Z"
        fill={soft}
        stroke={line}
        strokeWidth={3.2}
        strokeLinejoin="round"
      />
      {/* В облачке — маршрут: пройденный чекпоинт, следующий и флажок финиша */}
      <path d="M64 30 H100" stroke={line} strokeWidth={4} strokeLinecap="round" />
      <circle cx={63} cy={30} r={5.5} fill={line} />
      <circle cx={83} cy={30} r={5} fill={soft} stroke={line} strokeWidth={3.6} />
      <path d="M106 40 V19" stroke={line} strokeWidth={4.5} strokeLinecap="round" />
      <path d="M106 18 H121 L116.5 23.5 L121 29 H106Z" fill={line} />
      {/* ИИ: квадратная голова с антенной, глаза-экраны и пиксельная улыбка */}
      <path d="M157 18 V11" stroke={line} strokeWidth={3.6} strokeLinecap="round" />
      <circle cx={157} cy={9} r={3.6} fill={line} />
      <rect x={138} y={18} width={38} height={36} rx={8} fill={line} />
      <rect x={144.5} y={28.5} width={8} height={6.5} rx={1.4} fill={onFill} />
      <rect x={161.5} y={28.5} width={8} height={6.5} rx={1.4} fill={onFill} />
      <path
        d="M146 40 V43.5 H149.5 V46 H164.5 V43.5 H168 V40"
        fill="none"
        stroke={onFill}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
