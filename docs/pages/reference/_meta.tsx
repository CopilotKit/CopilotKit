import { SideNavTitleWithIcon } from "../../components/sidenav/sidenav-title-with-icon";
import { BiCube } from "react-icons/bi";
import { MdDataObject } from "react-icons/md";
import { PiFunctionBold } from "react-icons/pi";

export default {
  "components": {
    title: <SideNavTitleWithIcon title="Components" icon={BiCube} />,
  },
  "hooks": {
    title: <SideNavTitleWithIcon title="Hooks" icon={PiFunctionBold} />,
  },
  "classes": {
    title: <SideNavTitleWithIcon title="Classes" icon={MdDataObject} />,
  }
}

