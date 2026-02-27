# fumadocs-test

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.vercel.app) - learn about Fumadocs

## Vercel Deployment with Git LFS

Docs assets are tracked with Git LFS. To ensure production builds always receive
real asset bytes (not pointer files), deploy docs through GitHub Actions using
`.github/workflows/deploy_docs_vercel.yml`.

Required GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_DOCS`

PR previews:

- `.github/workflows/deploy_docs_vercel_preview.yml` deploys docs previews for
  non-fork pull requests.
- The workflow posts/updates a sticky PR comment with a clickable
  `Open Docs Preview` link.

Recommended Vercel project setting:

- Disable automatic Git-based deployments for the docs project and let the
  GitHub Actions workflow handle production deploys.
