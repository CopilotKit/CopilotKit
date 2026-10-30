// PE-1105: replace pino with a zero-dependency logger. pino-pretty, sonic-boom
// and pino-abstract-transport need fs, worker_threads and stream.
const noop = () => {};
function createLogger() {
  const logger = {
    level: "error",
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return logger;
}
export default createLogger;
