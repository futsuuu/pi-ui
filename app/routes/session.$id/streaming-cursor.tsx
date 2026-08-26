import { css } from "styled-system/css";

/** Animated cursor shown while streaming */
export function StreamingCursor() {
  return <span className={css({ fontFamily: "mono", color: "info", animation: "pulse" })}>█</span>;
}
