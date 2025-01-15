echo ${APP_CONFIGS_BASE64} | base64 -d > app-configs.json

cat app-configs.json

pnpm run test -- tests/next-openai.spec.ts