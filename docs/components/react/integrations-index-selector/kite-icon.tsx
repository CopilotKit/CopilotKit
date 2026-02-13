export function KiteIconLight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="180"
      height="180"
      viewBox="0 0 180 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Kite background circle */}
      <rect x="40" y="40" width="100" height="100" rx="50" fill="white" />

      {/* Kite icon - scaled up and centered */}
      <g transform="translate(90, 90) scale(1.25) translate(-72, -72)">
        <path
          d="M59.7812 65.0829C63.2055 60.6039 66.0475 56.1748 67.1411 52.5981C67.1705 52.5008 67.2845 52.4594 67.3691 52.5156C71.1718 55.0338 78.098 56.6913 84.2243 56.7302C84.3297 56.7309 84.4023 56.8348 84.3643 56.9331C82.3273 62.1007 79.8395 71.3602 79.7427 81.9341C79.7427 82.0911 79.5216 82.1475 79.4439 82.011C75.9574 75.9097 64.7897 67.3363 59.8382 65.3128C59.7467 65.2752 59.7207 65.162 59.7812 65.0829Z"
          fill="url(#kite-light-paint0)"
        />
        <path
          d="M71.3341 62.3431C65.9818 64.0377 61.0908 64.9798 59.9229 65.1939C59.8486 65.2076 59.833 65.3103 59.9038 65.3394C64.8934 67.4138 76.0058 75.9621 79.4594 82.0387C79.4663 82.052 79.4836 82.0569 79.4974 82.0508C79.5112 82.0442 79.5181 82.027 79.5129 82.0121L71.3341 62.3431Z"
          fill="url(#kite-light-paint1)"
        />
        <path
          d="M67.3848 52.5046C71.9665 55.0038 77.2619 56.1263 84.2866 56.7178C84.3298 56.7216 84.3453 56.7807 84.3056 56.8012C83.4072 57.263 78.2605 59.882 74.4388 61.2846C73.4143 61.6604 72.3846 62.0091 71.3705 62.3307C71.348 62.3377 71.3239 62.3267 71.3152 62.3052L67.2794 52.5992C67.2517 52.5339 67.3226 52.4707 67.3848 52.5046Z"
          fill="url(#kite-light-paint2)"
        />
        <path
          d="M67.3035 52.6521L79.5976 81.9802"
          stroke="#513C9F"
          strokeWidth="0.183881"
          strokeLinecap="round"
        />
        <path
          d="M59.9263 65.1902C59.9263 65.1902 66.7161 63.9715 73.0981 61.7702C79.4784 59.5689 84.2295 56.8734 84.2295 56.8734"
          stroke="#513C9F"
          strokeWidth="0.183881"
          strokeLinecap="round"
        />
        <path
          d="M68.9897 56.3575L64.4356 71.512M64.4356 71.512H75.2594M64.4356 71.512L47.3333 91.6529"
          stroke="#ABABAB"
          strokeWidth="0.321797"
          strokeLinecap="round"
        />
        <path
          d="M59.2007 87.5065L57.1845 87.79C58.2298 90.5542 60.3738 91.7617 62.9325 91.7617C69.204 91.7617 67.2897 84.6698 70.923 84.6698C73.5594 84.6698 72.4883 90.4179 78.1602 90.4179C81.6225 90.4179 81.968 86.9301 81.3771 85.4296C81.3737 85.4205 81.3702 85.4122 81.365 85.4039L80.4373 83.9832C80.3768 83.8887 80.23 83.9243 80.2196 84.0366L80.0468 85.7586C80.0348 85.8783 80.0382 85.9977 80.052 86.1172C80.1937 87.3069 80.2853 90.194 78.1602 90.194C75.9194 90.194 75.3804 84.5204 70.923 84.5204C65.6951 84.5204 66.3671 91.5378 63.1571 91.5378C61.039 91.5378 59.4236 89.149 59.2007 87.5065Z"
          fill="url(#kite-light-paint3)"
        />
      </g>

      {/* Outer circles */}
      <path
        opacity="0.5"
        d="M20 90C20 51.34 51.34 20 90 20C128.66 20 160 51.34 160 90C160 128.66 128.66 160 90 160C51.34 160 20 128.66 20 90Z"
        stroke="url(#kite-light-paint4)"
      />
      <circle
        opacity="0.3"
        cx="90"
        cy="90"
        r="89.5"
        stroke="url(#kite-light-paint5)"
      />

      <defs>
        <linearGradient
          id="kite-light-paint0"
          x1="75.6343"
          y1="54.7899"
          x2="69.6618"
          y2="71.2135"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#6430AB" />
          <stop offset="1" stopColor="#AA89D8" />
        </linearGradient>
        <linearGradient
          id="kite-light-paint1"
          x1="71.0059"
          y1="64.0467"
          x2="63.3177"
          y2="78.9026"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#005DBB" />
          <stop offset="1" stopColor="#3D92E8" />
        </linearGradient>
        <linearGradient
          id="kite-light-paint2"
          x1="74.4388"
          y1="54.7898"
          x2="72.1238"
          y2="62.0312"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#1B70C4" />
          <stop offset="1" stopColor="#54A4F2" />
        </linearGradient>
        <linearGradient
          id="kite-light-paint3"
          x1="57.1845"
          y1="87.9918"
          x2="81.6104"
          y2="87.9918"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4497EA" />
          <stop offset="0.254755" stopColor="#1463B2" />
          <stop offset="0.498725" stopColor="#0A437D" />
          <stop offset="0.666667" stopColor="#2476C8" />
          <stop offset="0.972542" stopColor="#0C549A" />
        </linearGradient>
        <radialGradient
          id="kite-light-paint4"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(50 140) rotate(-45.8275) scale(111.974 93.3487)"
        >
          <stop stopColor="#BEC2FF" />
          <stop offset="1" stopColor="#BEC2FF" stopOpacity="0.3" />
        </radialGradient>
        <radialGradient
          id="kite-light-paint5"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(20 35) rotate(31.8516) scale(141.946 118.336)"
        >
          <stop stopColor="#BEC2FF" />
          <stop offset="1" stopColor="#BEC2FF" stopOpacity="0.3" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export function KiteIconDark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="180"
      height="180"
      viewBox="0 0 180 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Kite background circle - more opaque to hide connectors behind */}
      <rect x="40" y="40" width="100" height="100" rx="50" fill="#1a1a1a" />

      {/* Kite icon - scaled up and centered */}
      <g transform="translate(90, 90) scale(1.25) translate(-72, -72)">
        <path
          d="M59.7812 65.0829C63.2055 60.6039 66.0475 56.1748 67.1411 52.5981C67.1705 52.5008 67.2845 52.4594 67.3692 52.5156C71.1718 55.0338 78.098 56.6913 84.2244 56.7302C84.3297 56.7309 84.4023 56.8348 84.3643 56.9331C82.3274 62.1007 79.8395 71.3602 79.7428 81.9341C79.7428 82.0911 79.5216 82.1475 79.4439 82.011C75.9574 75.9097 64.7898 67.3363 59.8382 65.3128C59.7467 65.2752 59.7208 65.162 59.7812 65.0829Z"
          fill="url(#kite-dark-paint0)"
        />
        <path
          d="M71.3344 62.3431C65.982 64.0377 61.091 64.9798 59.9231 65.1939C59.8488 65.2076 59.8332 65.3103 59.9041 65.3394C64.8936 67.4138 76.006 75.9621 79.4596 82.0387C79.4665 82.052 79.4838 82.0569 79.4976 82.0508C79.5115 82.0442 79.5184 82.027 79.5132 82.0121L71.3344 62.3431Z"
          fill="url(#kite-dark-paint1)"
        />
        <path
          d="M67.385 52.5046C71.9668 55.0038 77.2621 56.1263 84.2868 56.7178C84.33 56.7216 84.3456 56.7807 84.3058 56.8012C83.4074 57.263 78.2607 59.882 74.4391 61.2846C73.4146 61.6604 72.3849 62.0091 71.3707 62.3307C71.3483 62.3377 71.3241 62.3267 71.3154 62.3052L67.2796 52.5992C67.252 52.5339 67.3228 52.4707 67.385 52.5046Z"
          fill="url(#kite-dark-paint2)"
        />
        <path
          d="M67.3037 52.6521L79.5978 81.9802"
          stroke="#513C9F"
          strokeWidth="0.183881"
          strokeLinecap="round"
        />
        <path
          d="M59.9268 65.1902C59.9268 65.1902 66.7165 63.9715 73.0985 61.7702C79.4788 59.5689 84.2299 56.8734 84.2299 56.8734"
          stroke="#513C9F"
          strokeWidth="0.183881"
          strokeLinecap="round"
        />
        <path
          d="M68.9899 56.3575L64.4357 71.512M64.4357 71.512H75.2596M64.4357 71.512L47.3335 91.6529"
          stroke="#ABABAB"
          strokeWidth="0.321797"
          strokeLinecap="round"
        />
        <path
          d="M59.2008 87.5065L57.1846 87.79C58.2298 90.5542 60.3738 91.7617 62.9325 91.7617C69.204 91.7617 67.2897 84.6698 70.923 84.6698C73.5595 84.6698 72.4883 90.4179 78.1603 90.4179C81.6225 90.4179 81.968 86.9301 81.3772 85.4296C81.3737 85.4205 81.3703 85.4122 81.3651 85.4039L80.4373 83.9832C80.3769 83.8887 80.23 83.9243 80.2196 84.0366L80.0469 85.7586C80.0348 85.8783 80.0382 85.9977 80.0521 86.1172C80.1937 87.3069 80.2853 90.194 78.1603 90.194C75.9195 90.194 75.3804 84.5204 70.923 84.5204C65.6951 84.5204 66.3672 91.5378 63.1571 91.5378C61.039 91.5378 59.4236 89.149 59.2008 87.5065Z"
          fill="url(#kite-dark-paint3)"
        />
      </g>

      {/* Outer circles */}
      <path
        opacity="0.5"
        d="M20 90C20 51.34 51.34 20 90 20C128.66 20 160 51.34 160 90C160 128.66 128.66 160 90 160C51.34 160 20 128.66 20 90Z"
        stroke="url(#kite-dark-paint4)"
      />
      <circle
        opacity="0.3"
        cx="90"
        cy="90"
        r="89.5"
        stroke="url(#kite-dark-paint5)"
      />

      <defs>
        <linearGradient
          id="kite-dark-paint0"
          x1="75.6343"
          y1="54.7899"
          x2="69.6618"
          y2="71.2135"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#6430AB" />
          <stop offset="1" stopColor="#AA89D8" />
        </linearGradient>
        <linearGradient
          id="kite-dark-paint1"
          x1="71.0059"
          y1="64.0467"
          x2="63.3177"
          y2="78.9026"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#005DBB" />
          <stop offset="1" stopColor="#3D92E8" />
        </linearGradient>
        <linearGradient
          id="kite-dark-paint2"
          x1="74.4388"
          y1="54.7898"
          x2="72.1238"
          y2="62.0312"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#1B70C4" />
          <stop offset="1" stopColor="#54A4F2" />
        </linearGradient>
        <linearGradient
          id="kite-dark-paint3"
          x1="57.1845"
          y1="87.9918"
          x2="81.6104"
          y2="87.9918"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4497EA" />
          <stop offset="0.254755" stopColor="#1463B2" />
          <stop offset="0.498725" stopColor="#0A437D" />
          <stop offset="0.666667" stopColor="#2476C8" />
          <stop offset="0.972542" stopColor="#0C549A" />
        </linearGradient>
        <radialGradient
          id="kite-dark-paint4"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(50 140) rotate(-45.8275) scale(111.974 93.3487)"
        >
          <stop stopColor="#7076D5" />
          <stop offset="1" stopColor="#7076D5" stopOpacity="0.3" />
        </radialGradient>
        <radialGradient
          id="kite-dark-paint5"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(20 35) rotate(31.8516) scale(141.946 118.336)"
        >
          <stop stopColor="#7076D5" />
          <stop offset="1" stopColor="#7076D5" stopOpacity="0.3" />
        </radialGradient>
      </defs>
    </svg>
  );
}
