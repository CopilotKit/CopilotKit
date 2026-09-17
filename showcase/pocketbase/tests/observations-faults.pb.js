// TEST ONLY: mount separately into a private PB instance. Never ship this hook.
onModelBeforeCreate(() => {
  let active = false;
  try {
    $os.readFile("/pb_data/fault-status");
    active = true;
  } catch {}
  if (active) throw new ApiError(503, "test status failure");
}, "status");
onModelBeforeUpdate(() => {
  let active = false;
  try {
    $os.readFile("/pb_data/fault-status");
    active = true;
  } catch {}
  if (active) throw new ApiError(503, "test status failure");
}, "status");
onModelBeforeCreate(() => {
  let active = false;
  try {
    $os.readFile("/pb_data/fault-history");
    active = true;
  } catch {}
  if (active) throw new ApiError(503, "test history failure");
}, "status_history");
onModelBeforeUpdate(() => {
  let active = false;
  try {
    $os.readFile("/pb_data/fault-receipt");
    active = true;
  } catch {}
  if (active) throw new ApiError(503, "test receipt failure");
}, "probe_jobs");
