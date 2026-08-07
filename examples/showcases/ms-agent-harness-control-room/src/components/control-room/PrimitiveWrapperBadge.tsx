/**
 * Compact "wrapper" chip used on inspector cards whose data is delivered
 * through an app-owned shim rather than a native AG-UI primitive. The full
 * explanation lives in the hover tooltip so the chip itself can stay tiny.
 */

export function PrimitiveWrapperBadge() {
  return (
    <span
      className="cr-wrapper-badge"
      title="Live wrapper — app-owned implementation pending native Harness AG-UI support."
    >
      wrapper
    </span>
  );
}
