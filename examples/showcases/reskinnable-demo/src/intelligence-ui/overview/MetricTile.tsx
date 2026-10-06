import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { motion } from 'motion/react';
import type { ComponentType } from 'react';
import { useWorkspaceEntranceMotion } from '../shell/workspace-entrance';
import { Badge, type BadgeVariant } from '../ui/feedback';
import { VisuallyHidden } from '../ui/primitives';

import './MetricTile.css';

/**
 * Health signal a {@link MetricTile} is reporting for its metric, driving
 * which token-based color modifier class the tile renders with.
 */
export type MetricTileState = 'good' | 'neutral' | 'warn';

/** Which way a metric moved over the period. */
export type MetricTrendDirection = 'up' | 'down' | 'flat';

/**
 * Whether a metric's movement is good, bad, or neither for this metric —
 * decoupled from {@link MetricTrendDirection} because "up" is good for active
 * users but bad for error rate. Drives the delta pill's semantic color.
 */
export type MetricTrendTone = 'positive' | 'negative' | 'neutral';

/** The period-over-period change shown as a colored delta pill on a tile. */
export interface MetricTileTrend {
  /** The arrow direction: which way the value moved. */
  readonly direction: MetricTrendDirection;
  /** Whether that movement is good, bad, or neutral for this metric. */
  readonly tone: MetricTrendTone;
  /** The formatted change, e.g. `'+12%'`. */
  readonly value: string;
}

/**
 * The metric a {@link MetricTile} renders: a labeled value with a delta
 * caption, an icon, a health {@link MetricTileState}, and — on the bento
 * dashboard — a colored trend pill.
 */
export interface MetricTileMetric {
  /** Short caption under the value, e.g. trend context or a comparison. */
  readonly delta: string;
  /** Icon rendered in the tile's leading badge. */
  readonly icon: ComponentType<{ readonly size?: number }>;
  /** The metric's name, rendered as the tile's small caps heading. */
  readonly label: string;
  /** Health signal driving the tile's color modifier class. */
  readonly state: MetricTileState;
  /** The metric's headline value. */
  readonly value: string;
  /** Accessible meaning when the visible value is a compact placeholder. */
  readonly valueLabel?: string;
  /**
   * Show the value as quiet status text rather than a KPI figure. Defaults to
   * `true` when the value has no digits (e.g. "Loading…", "Unavailable",
   * "N/A", "—"), so a status never borrows the large number style.
   */
  readonly compactValue?: boolean;
  /**
   * The period-over-period change, rendered as a direction-colored pill. Omit
   * to show no pill (e.g. when there is nothing to compare against).
   */
  readonly trend?: MetricTileTrend;
}

/**
 * Props for {@link MetricTile}.
 */
export interface MetricTileProps {
  /** The metric to render. */
  readonly metric: MetricTileMetric;
  /** Stagger position within a newly mounted report. */
  readonly order?: number;
}

/** The arrow glyph for a trend direction. */
const TREND_ICON: Record<
  MetricTrendDirection,
  ComponentType<{ readonly size?: number }>
> = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus,
};

/** The shared Badge variant for each trend tone. */
const TREND_BADGE: Record<MetricTrendTone, BadgeVariant> = {
  negative: 'danger',
  neutral: 'neutral',
  positive: 'success',
};

/**
 * Renders a single analytics metric as a compact KPI card: a sentence-case
 * label with an icon, the headline value, and a trend Badge with its caption.
 *
 * The tile's {@link MetricTileState} drives a `metric-tile--<state>` modifier
 * class and the trend's tone picks the shared Badge variant, so colors come
 * from tokens only; no color is set inline. A value without digits renders
 * as quiet status text (see {@link MetricTileMetric.compactValue}).
 *
 * @param props - The metric to render.
 * @returns The rendered metric tile.
 */
export function MetricTile(props: MetricTileProps): React.JSX.Element {
  const { metric } = props;
  const Icon = metric.icon;
  const TrendIcon =
    metric.trend === undefined ? null : TREND_ICON[metric.trend.direction];
  const entrance = useWorkspaceEntranceMotion(props.order);

  return (
    <motion.article
      className={`metric-tile metric-tile--${metric.state}`}
      {...entrance}
    >
      <div className="metric-tile__head">
        <p className="metric-tile__label">{metric.label}</p>
        <span className="metric-tile__icon" aria-hidden="true">
          <Icon size={15} />
        </span>
      </div>
      <p
        className="metric-tile__value"
        data-compact={
          (metric.compactValue ?? !/\d/u.test(metric.value))
            ? 'true'
            : undefined
        }
        data-placeholder={metric.valueLabel ? 'true' : undefined}
      >
        {metric.valueLabel ? (
          <>
            <span aria-hidden="true">{metric.value}</span>
            <VisuallyHidden>{metric.valueLabel}</VisuallyHidden>
          </>
        ) : (
          metric.value
        )}
      </p>
      <div className="metric-tile__foot">
        {metric.trend !== undefined && TrendIcon !== null ? (
          <Badge
            className={`metric-tile__pill metric-tile__pill--${metric.trend.tone}`}
            variant={TREND_BADGE[metric.trend.tone]}
          >
            <TrendIcon size={11} />
            {metric.trend.value}
          </Badge>
        ) : (
          <span className="metric-tile__dot" aria-hidden="true" />
        )}
        <span className="metric-tile__delta">{metric.delta}</span>
      </div>
    </motion.article>
  );
}
