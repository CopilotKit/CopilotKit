export function IntegrationsSelectorLightMobile({ className, rows = 7 }: { className?: string; rows?: number }) {
  // Calculate which connectors to show based on row count
  const showConnector1 = rows >= 2;
  const showConnector2 = rows >= 3;
  const showConnector3 = rows >= 4;
  const showConnector4 = rows >= 5;
  const showConnector5 = rows >= 6;
  const showConnector6 = rows >= 7;
  return (
    <svg className={className} width='116' height='452' viewBox='0 0 116 452' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <rect x='25.6001' y='25.6826' width='64' height='64' rx='32' fill='white' />
      <path
        d='M47.825 52.0662C50.5644 48.483 52.838 44.9397 53.7129 42.0783C53.7364 42.0005 53.8276 41.9674 53.8953 42.0124C56.9374 44.0269 62.4784 45.3529 67.3795 45.384C67.4638 45.3846 67.5218 45.4677 67.4914 45.5463C65.8619 49.6804 63.8716 57.088 63.7942 65.5471C63.7942 65.6728 63.6173 65.7178 63.5551 65.6087C60.7659 60.7276 51.8318 53.8689 47.8706 52.2501C47.7973 52.22 47.7766 52.1295 47.825 52.0662Z'
        fill='url(#paint0_linear_6481_45022)'
      />
      <path
        d='M57.0674 49.8744C52.7855 51.2301 48.8727 51.9838 47.9383 52.155C47.8789 52.1659 47.8665 52.2482 47.9231 52.2714C51.9148 53.9309 60.8047 60.7696 63.5676 65.6309C63.5731 65.6415 63.5869 65.6454 63.598 65.6405C63.609 65.6353 63.6146 65.6215 63.6104 65.6096L57.0674 49.8744Z'
        fill='url(#paint1_linear_6481_45022)'
      />
      <path
        d='M53.9078 42.0034C57.5733 44.0028 61.8095 44.9008 67.4293 45.374C67.4639 45.377 67.4763 45.4243 67.4445 45.4408C66.7258 45.8101 62.6084 47.9053 59.5511 49.0275C58.7315 49.3281 57.9078 49.607 57.0964 49.8643C57.0785 49.8699 57.0591 49.8611 57.0522 49.8439L53.8235 42.0791C53.8014 42.0269 53.8581 41.9763 53.9078 42.0034Z'
        fill='url(#paint2_linear_6481_45022)'
      />
      <path d='M53.8429 42.1215L63.6782 65.5839' stroke='#513C9F' strokeWidth='0.147105' strokeLinecap='round' />
      <path
        d='M47.9412 52.1518C47.9412 52.1518 53.373 51.1769 58.4786 49.4158C63.5828 47.6548 67.3837 45.4984 67.3837 45.4984'
        stroke='#513C9F'
        strokeWidth='0.147105'
        strokeLinecap='round'
      />
      <path
        d='M55.1918 45.0858L51.5485 57.2094M51.5485 57.2094H60.2076M51.5485 57.2094L37.8667 73.3221'
        stroke='#ABABAB'
        strokeWidth='0.257437'
        strokeLinecap='round'
      />
      <path
        d='M47.3606 70.005L45.7477 70.2319C46.5839 72.4433 48.2991 73.4093 50.3461 73.4093C55.3632 73.4093 53.8318 67.7357 56.7384 67.7357C58.8476 67.7357 57.9907 72.3342 62.5282 72.3342C65.298 72.3342 65.5745 69.544 65.1018 68.3436C65.099 68.3363 65.0962 68.3296 65.0921 68.323L64.3499 67.1865C64.3015 67.1108 64.184 67.1393 64.1757 67.2292L64.0375 68.6067C64.0279 68.7025 64.0306 68.798 64.0417 68.8937C64.155 69.8454 64.2283 72.1551 62.5282 72.1551C60.7356 72.1551 60.3044 67.6162 56.7384 67.6162C52.5561 67.6162 53.0937 73.2301 50.5257 73.2301C48.8312 73.2301 47.5389 71.319 47.3606 70.005Z'
        fill='url(#paint3_linear_6481_45022)'
      />
      <path
        opacity='0.5'
        d='M13.3002 57.5999C13.3002 33.1337 33.1338 13.3002 57.6 13.3C82.0662 13.3 101.9 33.1336 101.9 57.5998C101.9 82.066 82.0661 101.9 57.6 101.9C33.1339 101.9 13.3003 82.0659 13.3002 57.5999Z'
        stroke='url(#paint4_radial_6481_45022)'
      />
      <circle opacity='0.3' cx='57.6' cy='57.6' r='57.1' stroke='url(#paint5_radial_6481_45022)' />
      {/* Main trunk line - ends at last row */}
      <path
        d={rows >= 7 
          ? 'M58.6001 89.6826L58.6001 427.683C58.6001 440.385 68.8976 450.683 81.6001 450.683'
          : rows >= 6
          ? 'M58.6001 89.6826L58.6001 368.683C58.6001 381.385 68.8975 391.683 81.6001 391.683'
          : rows >= 5
          ? 'M58.6001 89.6826L58.6001 313.683C58.6001 326.385 68.8975 336.683 81.6001 336.683'
          : rows >= 4
          ? 'M58.6001 89.6826L58.6001 258.683C58.6001 271.385 68.8975 281.683 81.6001 281.683'
          : rows >= 3
          ? 'M58.6001 89.6826L58.6001 203.683C58.6001 216.385 68.8975 226.683 81.6001 226.683'
          : rows >= 2
          ? 'M58.6001 89.6826L58.6001 147.683C58.6001 160.385 68.8975 170.683 81.6001 170.683'
          : 'M58.6001 89.6826L58.6001 92.6826C58.6001 105.385 68.8975 115.683 81.6001 115.683'
        }
        stroke='url(#paint6_linear_6481_45022)'
      />
      {/* Branch connectors */}
      {showConnector6 && (
        <path
          d='M58.6001 354.683L58.6001 368.683C58.6001 381.385 68.8975 391.683 81.6001 391.683'
          stroke='url(#paint11_linear_6481_45022)'
        />
      )}
      {showConnector5 && (
        <path
          d='M58.6001 299.683L58.6001 313.683C58.6001 326.385 68.8975 336.683 81.6001 336.683'
          stroke='url(#paint7_linear_6481_45022)'
        />
      )}
      {showConnector4 && (
        <path
          d='M58.6001 244.683L58.6001 258.683C58.6001 271.385 68.8975 281.683 81.6001 281.683'
          stroke='url(#paint12_linear_6481_45022)'
        />
      )}
      {showConnector3 && (
        <path
          d='M58.6001 189.683L58.6001 203.683C58.6001 216.385 68.8975 226.683 81.6001 226.683'
          stroke='url(#paint8_linear_6481_45022)'
        />
      )}
      {showConnector2 && (
        <path
          d='M58.6001 133.683L58.6001 147.683C58.6001 160.385 68.8975 170.683 81.6001 170.683'
          stroke='url(#paint9_linear_6481_45022)'
        />
      )}
      {showConnector1 && (
        <path
          d='M58.6001 90.6826L58.6001 92.6826C58.6001 105.385 68.8975 115.683 81.6001 115.683'
          stroke='url(#paint10_linear_6481_45022)'
        />
      )}
      <defs>
        <linearGradient
          id='paint0_linear_6481_45022'
          x1='60.5075'
          y1='43.8318'
          x2='55.7294'
          y2='56.9707'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#6430AB' />
          <stop offset='1' stopColor='#AA89D8' />
        </linearGradient>
        <linearGradient
          id='paint1_linear_6481_45022'
          x1='56.8048'
          y1='51.2373'
          x2='50.6542'
          y2='63.122'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#005DBB' />
          <stop offset='1' stopColor='#3D92E8' />
        </linearGradient>
        <linearGradient
          id='paint2_linear_6481_45022'
          x1='59.5511'
          y1='43.8316'
          x2='57.699'
          y2='49.6247'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#1B70C4' />
          <stop offset='1' stopColor='#54A4F2' />
        </linearGradient>
        <linearGradient
          id='paint3_linear_6481_45022'
          x1='45.7477'
          y1='70.3933'
          x2='65.2884'
          y2='70.3933'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#4497EA' />
          <stop offset='0.254755' stopColor='#1463B2' />
          <stop offset='0.498725' stopColor='#0A437D' />
          <stop offset='0.666667' stopColor='#2476C8' />
          <stop offset='0.972542' stopColor='#0C549A' />
        </linearGradient>
        <radialGradient
          id='paint4_radial_6481_45022'
          cx='0'
          cy='0'
          r='1'
          gradientUnits='userSpaceOnUse'
          gradientTransform='translate(29.4797 92.7997) rotate(-45.8275) scale(89.5789 74.6789)'>
          <stop stopColor='#BEC2FF' />
          <stop offset='1' stopColor='#BEC2FF' stopOpacity='0.3' />
        </radialGradient>
        <radialGradient
          id='paint5_radial_6481_45022'
          cx='0'
          cy='0'
          r='1'
          gradientUnits='userSpaceOnUse'
          gradientTransform='translate(12.3429 21.4451) rotate(31.8516) scale(113.557 94.6685)'>
          <stop stopColor='#BEC2FF' />
          <stop offset='1' stopColor='#BEC2FF' stopOpacity='0.3' />
        </radialGradient>
        <linearGradient
          id='paint6_linear_6481_45022'
          x1='58.6001'
          y1='87.9233'
          x2='137.152'
          y2='102.972'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#BEC2FF' stopOpacity='0.6' />
          <stop offset='0.178093' stopColor='#BEC2FF' />
          <stop offset='1' stopColor='#BEC2FF' stopOpacity='0.3' />
        </linearGradient>
        <linearGradient
          id='paint7_linear_6481_45022'
          x1='58.6001'
          y1='299.423'
          x2='85.229'
          y2='334.992'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#BEC2FF' stopOpacity='0.2' />
          <stop offset='0.423077' stopColor='#BEC2FF' />
          <stop offset='1' stopColor='#BEC2FF' stopOpacity='0.3' />
        </linearGradient>
        <linearGradient
          id='paint11_linear_6481_45022'
          x1='58.6001'
          y1='354.423'
          x2='85.229'
          y2='389.992'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#BEC2FF' stopOpacity='0.2' />
          <stop offset='0.423077' stopColor='#BEC2FF' />
          <stop offset='1' stopColor='#BEC2FF' stopOpacity='0.3' />
        </linearGradient>
        <linearGradient
          id='paint12_linear_6481_45022'
          x1='58.6001'
          y1='244.423'
          x2='85.229'
          y2='279.992'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#BEC2FF' stopOpacity='0.2' />
          <stop offset='0.423077' stopColor='#BEC2FF' />
          <stop offset='1' stopColor='#BEC2FF' stopOpacity='0.3' />
        </linearGradient>
        <linearGradient
          id='paint8_linear_6481_45022'
          x1='58.6001'
          y1='189.423'
          x2='85.229'
          y2='224.992'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#BEC2FF' stopOpacity='0.2' />
          <stop offset='0.423077' stopColor='#BEC2FF' />
          <stop offset='1' stopColor='#BEC2FF' stopOpacity='0.3' />
        </linearGradient>
        <linearGradient
          id='paint9_linear_6481_45022'
          x1='58.6001'
          y1='133.423'
          x2='85.229'
          y2='168.992'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#BEC2FF' stopOpacity='0.2' />
          <stop offset='0.423077' stopColor='#BEC2FF' />
          <stop offset='1' stopColor='#BEC2FF' stopOpacity='0.3' />
        </linearGradient>
        <linearGradient
          id='paint10_linear_6481_45022'
          x1='58.6001'
          y1='90.5074'
          x2='73.7058'
          y2='120.37'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#BEC2FF' stopOpacity='0.2' />
          <stop offset='0.423077' stopColor='#BEC2FF' />
          <stop offset='1' stopColor='#BEC2FF' stopOpacity='0.3' />
        </linearGradient>
      </defs>
    </svg>
  );
}
