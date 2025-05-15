import { FaReact } from "react-icons/fa";
import { HiOutlineServerStack } from "react-icons/hi2";
import { LuBrush, LuZap, LuGlobe } from "react-icons/lu";
import { SiLangchain } from "react-icons/si";
import { TbBrandTypescript } from "react-icons/tb";
import { FaPython } from "react-icons/fa";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { LuLayoutTemplate } from "react-icons/lu";
import { IconBaseProps } from "react-icons";
export const AG2Icon = (props: IconBaseProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="3em"
    height="3em"
    fill="none"
    viewBox="0 0 90 50"
    style={{ transform: "scale(1.5)" }}
    {...props}
  >
    <path
      fill="currentColor"
      d="M69.285 0h-3.232v3.232h3.232V0Zm-3.232 16.095h-3.21v6.442h3.21v-6.442Zm0-12.863h-3.21v3.21h3.21v-3.21Zm-3.21 9.652h-3.21v3.21h3.21v-3.21Zm0-6.442h-3.21v3.232h3.21V6.442Zm-3.211 3.232H53.19v3.21h6.442v-3.21ZM53.19 6.442H37.095v3.232H53.19V6.442Zm6.442 19.305v-6.42h-3.231v-3.232H33.885v3.232h-3.232v6.42h28.98Zm-9.652-6.42h3.21v3.21h-3.21v-3.21Zm-12.885 0h3.21v3.21h-3.21v-3.21Zm0-9.653h-6.442v3.21h6.442v-3.21Zm-6.442 3.21h-3.21v3.21h3.21v-3.21Zm0-6.442h-3.21v3.232h3.21V6.442Zm-3.211 9.653h-3.21v6.442h3.21v-6.442Zm0-12.863h-3.21v3.21h3.21v-3.21ZM24.232 0H21v3.232h3.232V0Z"
    />
    <path
      fill="currentColor"
      d="M65.867 37.748V34.33H55.615v-3.418h10.252v3.418h3.418v3.417h-3.418Zm-6.834 3.417v-3.417h6.834v3.417h-6.834ZM55.615 48v-6.835h3.418v3.418h10.252V48h-13.67Zm-13.89-13.67v-3.417h10.252v3.418H41.725Zm-3.417 10.253V34.33h3.417v10.252h-3.417Zm10.252 0v-3.418h-3.417v-3.417h6.834v6.835H48.56ZM41.725 48v-3.417h6.835V48h-6.835ZM21 48V34.33h3.417v-3.417h6.835v3.418h3.418V48h-3.418v-6.835h-6.835V48H21Zm3.417-10.252h6.835v-3.28h-6.835v3.28Z"
    />
  </svg>
);

export const MastraIcon = (props: IconBaseProps) => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 34 34"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="16.6532"
      cy="16.9999"
      r="14.0966"
      stroke="currentColor"
      strokeWidth="1.16026"
    />
    <ellipse
      cx="16.6533"
      cy="17"
      rx="14.0966"
      ry="9.45478"
      transform="rotate(45 16.6533 17)"
      stroke="currentColor"
      strokeWidth="1.16026"
    />
    <path
      d="M10.8984 17.0508H22.483"
      stroke="currentColor"
      strokeWidth="1.16026"
    />
    <path
      d="M13.748 19.9932L19.6339 14.1074"
      stroke="currentColor"
      strokeWidth="1.16026"
    />
  </svg>
);

export const customIcons = {
  react: FaReact,
  server: HiOutlineServerStack,
  zap: LuZap,
  brush: LuBrush,
  globe: LuGlobe,
  langchain: SiLangchain,
  typescript: TbBrandTypescript,
  python: FaPython,
  crewai: SiCrewai,
  component: LuLayoutTemplate,
  ag2: AG2Icon,
  mastra: MastraIcon,
};
