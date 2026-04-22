import { useState } from "react";
export function Z() {
  const [x] = useState(0);
  return <div>{x}</div>;
}
