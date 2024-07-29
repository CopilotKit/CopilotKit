import nextra from 'nextra'

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
})

export default withNextra({
  // async redirects() {
  //   return [
  //     {
  //       source: "/",
  //       destination: "/what-is-copilotkit",
  //       permanent: true,
  //     }
  //   ]
  // }
});
