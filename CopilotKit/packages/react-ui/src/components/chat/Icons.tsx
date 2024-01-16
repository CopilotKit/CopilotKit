import React from "react";

export const OpenIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    width="24"
    height="24"
  >
    <g transform="translate(24, 0) scale(-1, 1)">
      <path
        fillRule="evenodd"
        d="M5.337 21.718a6.707 6.707 0 01-.533-.074.75.75 0 01-.44-1.223 3.73 3.73 0 00.814-1.686c.023-.115-.022-.317-.254-.543C3.274 16.587 2.25 14.41 2.25 12c0-5.03 4.428-9 9.75-9s9.75 3.97 9.75 9c0 5.03-4.428 9-9.75 9-.833 0-1.643-.097-2.417-.279a6.721 6.721 0 01-4.246.997z"
        clipRule="evenodd"
      />
    </g>
  </svg>
);

export const CloseIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="1.5"
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);

export const HeaderCloseIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="1.5"
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export const SendIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
    />
  </svg>
);

export const SpinnerIcon = (
  <svg
    style={{
      animation: "copilotKitSpinAnimation 1s linear infinite",
      color: "rgb(107 114 128)",
    }}
    width="24"
    height="24"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      style={{ opacity: 0.25 }}
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      style={{ opacity: 0.75 }}
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
);

export const ActivityIcon = (
  <svg
    style={{
      display: "inline-block",
      marginLeft: "0.25rem",
      marginRight: "0.25rem",
    }}
    height="24"
    width="24"
    viewBox="0 0 27 27"
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
  >
    <circle className="copilotKitActivityDot1" cx="4" cy="12" r="3" />
    <circle className="copilotKitActivityDot1 copilotKitActivityDot2" cx="12" cy="12" r="3" />
    <circle className="copilotKitActivityDot1 copilotKitActivityDot3" cx="20" cy="12" r="3" />
  </svg>
);
