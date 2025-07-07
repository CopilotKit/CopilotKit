import Image from "next/image";
import LightLogo from '@/media/logo/light.png'
import DarkLogo from '@/media/logo/dark.png'

export function Logo() {
  return (
    <div className="flex items-center justify-center h-8 mb-4">
      <Image src={LightLogo.src} width={150} height={40} alt="Logo" className="block dark:hidden" />
      <Image src={DarkLogo.src} width={150} height={40} alt="Logo" className="hidden dark:block" />
    </div>
  )
  
}