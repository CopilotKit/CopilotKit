import { css } from "lit";

export const threadsViewStyles = css`
  .cpk-threads-overview-video-frame {
    position: relative;
    display: block;
    width: 100%;
    max-width: 440px;
    aspect-ratio: 16 / 9;
    margin: 0 0 14px;
    overflow: hidden;
    border: 1px solid #dbdbe5;
    border-radius: 10px;
    background:
      linear-gradient(
        135deg,
        rgba(190, 194, 255, 0.18),
        rgba(133, 236, 206, 0.12)
      ),
      #ffffff;
    box-shadow: 0 8px 20px rgba(1, 5, 7, 0.08);
  }

  .cpk-threads-overview-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;
