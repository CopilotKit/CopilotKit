/**
 * Schedule periodic current-time refreshes.
 *
 * @param {() => void} onUpdate
 * @returns {() => void} Stops future refreshes.
 */
export function startCurrentTimeUpdates(onUpdate) {
  const intervalId = setInterval(onUpdate, 1_000);

  return () => clearInterval(intervalId);
}
