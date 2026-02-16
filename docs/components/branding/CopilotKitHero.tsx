import Image from "next/image";

export const CopilotKitHero = () => (
  <div className="pointer-events-none relative mb-16 flex justify-center overflow-hidden rounded-3xl">
    <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-60"></div>
    <div className="relative z-10 transform p-12 transition-all duration-300">
      <Image
        src={
          "https://cdn.copilotkit.ai/docs/copilotkit/copilotkit-logo-dark.png"
        }
        width={400}
        height={100}
        alt="CopilotKit Logo"
      />
    </div>
  </div>
);
