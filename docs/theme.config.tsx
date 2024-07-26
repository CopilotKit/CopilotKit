import Image from "next/image";
import { useRouter } from "next/router";
import { DocsThemeConfig, useConfig } from "nextra-theme-docs";

const themeConfig: DocsThemeConfig = {
  head: () => {
    const router = useRouter();
    const { title, ...rest } = useConfig();

    const pagePath = router.asPath;
    const ogImageUrl = `https://docs.copilotkit.ai/api/opengraph-image?title=${title}`;

    const ogTitle = `${title} - CopilotKit`;

    return (
      <>
        <title>{ogTitle}</title>

        <meta name="viewport" content="width=device-width"/>
        <meta name="application-name" content="CopilotKit"/>
        <meta name="msapplication-TileColor" content="#4f46e5"/>
        <meta name="theme-color" content="#ffffff"/>
        <meta name="charset" content="utf-8"/>

        <link rel="sitemap" type="application/xml" href="/sitemap.xml"/>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="canonical" href={pagePath} />

        <meta name="og:url" content={pagePath} />
        <meta name="og:title" content={ogTitle} />
        <meta name="og:image" content={ogImageUrl} />
        <meta name="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={ogTitle} />
        <meta name="twitter:description" content="CopilotKit Documentation" />
        <meta name="twitter:image" content={ogImageUrl} />
      </>
    );
  },
  logo: (
    <div className="flex items-center gap-x-2">
      <Image
        src="/images/logo-light.webp"
        alt="CopilotKit"
        height={34}
        width={130}
      />
      <span className="font-semibold text-indigo-950">Docs</span>
    </div>
  ),
  project: {
    link: "https://github.com/copilotkit/copilotkit",
  },
  chat: {
    link: "https://discord.gg/6dffbvGU3D",
  },
  docsRepositoryBase: "https://github.com/copilotkit/copilotkit",
  footer: {
    content: "© Tawkit, Inc. All rights reserved.",
  },
  darkMode: false,
  nextThemes: {
    defaultTheme: "light",
    forcedTheme: "light",
  },
  color: {
    hue: {
      light: 245,
      dark: 245,
    },
    saturation: {
      light: 75,
      dark: 75,
    },
  },
};

export default themeConfig;
