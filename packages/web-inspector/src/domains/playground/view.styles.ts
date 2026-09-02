import { css } from "lit";

export const playgroundViewStyles = css`
  @keyframes cpk-playground-message-enter {
    from {
      opacity: 0;
      filter: blur(2px);
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      filter: blur(0);
      transform: translateY(0);
    }
  }

  @keyframes cpk-playground-thinking {
    0%,
    60%,
    100% {
      opacity: 0.28;
      transform: translateY(0);
    }
    30% {
      opacity: 1;
      transform: translateY(-2px);
    }
  }

  .cpk-playground-root {
    container-type: inline-size;
    background: #fbfbfd !important;
  }

  .cpk-playground-header {
    min-height: 58px;
    background: #f7f6fd !important;
  }

  .cpk-playground-welcome {
    max-width: 560px;
    padding: 24px;
  }

  .cpk-playground-welcome-title {
    color: #24242b;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }

  .cpk-playground-composer {
    border: 1px solid #dcdce8;
    box-shadow:
      0 8px 22px rgba(31, 23, 57, 0.08),
      0 1px 2px rgba(31, 23, 57, 0.1);
  }

  .cpk-playground-composer:focus-within {
    border-color: #aaa4d4;
    box-shadow:
      0 10px 26px rgba(86, 53, 155, 0.13),
      0 0 0 3px rgba(190, 194, 255, 0.3);
  }

  .inspector-window[data-color-scheme="dark"] .cpk-playground-root,
  .inspector-window[data-color-scheme="dark"] .cpk-playground-header {
    background: #15171e !important;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-playground-welcome-title {
    color: #f3f4f8 !important;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-playground-composer {
    border-color: #464957;
    background: #15171e !important;
    box-shadow:
      0 8px 22px rgba(0, 0, 0, 0.26),
      0 1px 2px rgba(0, 0, 0, 0.36);
  }

  .inspector-window[data-color-scheme="dark"]
    .cpk-playground-composer:focus-within {
    border-color: #777aae;
    box-shadow:
      0 10px 26px rgba(0, 0, 0, 0.34),
      0 0 0 3px rgba(102, 106, 158, 0.3);
  }

  .cpk-playground-message-enter {
    animation: cpk-playground-message-enter 0.24s cubic-bezier(0.16, 1, 0.3, 1)
      both;
  }

  .cpk-playground-thinking-dot {
    animation: cpk-playground-thinking 1.2s ease-in-out infinite;
  }

  .cpk-playground-thinking-dot:nth-child(2) {
    animation-delay: 0.12s;
  }

  .cpk-playground-thinking-dot:nth-child(3) {
    animation-delay: 0.24s;
  }

  .cpk-playground-reasoning summary::-webkit-details-marker {
    display: none;
  }

  .cpk-playground-reasoning[open] .cpk-playground-reasoning-chevron {
    transform: rotate(90deg);
  }

  @container (max-width: 560px) {
    .cpk-playground-header {
      align-items: stretch;
    }

    .cpk-playground-actions {
      width: 100%;
    }

    .cpk-playground-thread-select {
      min-width: 0;
      max-width: none;
      flex: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cpk-playground-message-enter,
    .cpk-playground-thinking-dot {
      animation: none;
    }
  }
`;
