import Image from "next/image";
import { useRouter } from "next/router";
import { DocsThemeConfig, useConfig } from "nextra-theme-docs";
import { useTheme } from "next-themes";
import ThemeSwitcher from "./components/ThemeSwitcher";

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
        <meta property="description" content="CopilotKit is the simplest way to integrate production-ready Copilots into any product." />

        <link rel="sitemap" type="application/xml" href="/sitemap.xml"/>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="canonical" href={pagePath} />

        <meta property="og:description" content="CopilotKit is the simplest way to integrate production-ready Copilots into any product." />
        <meta property="og:site_name" content="CopilotKit Documentation" />
        <meta name="og:url" content={`https://docs.copilotkit.ai/${pagePath}`} />
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
  logo: () => {
    const { theme } = useTheme();
    return (
      <div className="flex items-center gap-x-2">
        <Image
          src={theme === 'dark' ? '/images/logo-light.webp' : '/images/logo-light.webp'}
          alt="CopilotKit"
          height={34}
          width={130}
        />
        <span className="font-semibold" style={{ color: theme === 'dark' ? '#fff' : '#333' }}>
          Docs
        </span>
      </div>
    );
  },
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
  navbar: {
    extraContent: <ThemeSwitcher />
  },
  darkMode: true,
  nextThemes: {
    defaultTheme: 'system',
    storageKey: 'theme',
  }
};

export default themeConfig;