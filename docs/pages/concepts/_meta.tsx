import { SideNavTitleWithIcon } from "../../components/sidenav/sidenav-title-with-icon";
import { FaNodeJs } from "react-icons/fa";
import { FaReact } from "react-icons/fa";
import { PiGraphDuotone } from "react-icons/pi";
import { LuBrush } from "react-icons/lu";

export default {
  "generative-ui": {
    title: <SideNavTitleWithIcon title="Generative UI" icon={FaReact} />,
  },
  "copilot-runtime": {
    title: <SideNavTitleWithIcon title="Copilot Runtime" icon={FaNodeJs} />,
  },
  "agents": {
    title: <SideNavTitleWithIcon title="Agents (LangChain)" icon={PiGraphDuotone} />,
  },
  "customize-look-and-feel": {
    title: <SideNavTitleWithIcon title="Customize Look and Feel" icon={LuBrush} />,
  }
}

