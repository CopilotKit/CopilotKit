interface CounterProps {
  count: number
}

export function Counter({ count }: CounterProps) {
  return (
    <div className="counter-container">
      <div className="counter-display">
        <div className="counter-value">{count}</div>
        <div className="counter-label">Active Incidents</div>
      </div>
    </div>
  )
}
