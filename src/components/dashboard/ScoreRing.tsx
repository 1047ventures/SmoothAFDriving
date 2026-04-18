import { scoreColor, scoreLabel } from "@/lib/smoothScore";

interface ScoreRingProps {
  score: number;
  size?: number;
  animated?: boolean;
}

export function ScoreRing({ score, size = 160, animated = false }: ScoreRingProps) {
  const radius = (size / 2) - 12;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = scoreColor(score);
  const label = scoreLabel(score);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(0 0% 16%)"
          strokeWidth={10}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          style={{
            transition: "stroke-dashoffset 0.5s ease, stroke 0.5s ease",
            filter: `drop-shadow(0 0 6px ${color})`,
          }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span
          className={`text-4xl font-bold tabular-nums ${animated ? "animate-score-pulse" : ""}`}
          style={{ color }}
        >
          {Math.round(score)}
        </span>
        <span className="text-xs text-muted-foreground mt-0.5">{label}</span>
      </div>
    </div>
  );
}
