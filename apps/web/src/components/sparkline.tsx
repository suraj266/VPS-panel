import { useMemo } from "react";

interface SparklineProps {
  /** Newest sample is at the end of the array. */
  values: number[];
  /** Fixed minimum for the y-axis. Useful for percentages (0). */
  min?: number;
  /** Fixed maximum for the y-axis. Useful for percentages (100). */
  max?: number;
  width?: number;
  height?: number;
  stroke?: string;
  /** Optional gradient fill below the line. */
  fill?: string;
  className?: string;
}

/**
 * Minimal SVG sparkline. Designed to be drop-in for "live CPU%" / "live RX bps"
 * style cards — no chart library, no tooltips, just a line.
 *
 * Auto-scales to the data range unless `min`/`max` are provided. For metrics
 * with a natural ceiling (percentages, bounded ratios) pass both so the line's
 * visual height carries real meaning across the dashboard.
 */
export function Sparkline({
  values,
  min,
  max,
  width = 200,
  height = 48,
  stroke = "currentColor",
  fill,
  className,
}: SparklineProps) {
  const { pathD, areaD } = useMemo(() => {
    if (values.length < 2) return { pathD: "", areaD: "" };
    const lo = min ?? Math.min(...values);
    let hi = max ?? Math.max(...values);
    if (hi === lo) hi = lo + 1;
    const span = hi - lo;
    const stepX = width / (values.length - 1);
    const points = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - lo) / span) * height;
      // Clamp so out-of-range samples don't render outside the box.
      return [x, Math.max(0, Math.min(height, y))] as const;
    });
    const d = points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(" ");
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const area =
      `M${first[0].toFixed(1)} ${height} ` +
      `L${first[0].toFixed(1)} ${first[1].toFixed(1)} ` +
      points
        .slice(1)
        .map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`)
        .join(" ") +
      ` L${last[0].toFixed(1)} ${height} Z`;
    return { pathD: d, areaD: area };
  }, [values, min, max, width, height]);

  if (!pathD) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        aria-hidden="true"
      />
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      {fill && <path d={areaD} fill={fill} />}
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
