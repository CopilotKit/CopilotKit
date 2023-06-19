module.exports = {
  root: true,
  // This tells ESLint to load the config from the package `eslint-config-copilotkit`
  extends: ['recursivelyai-copilotkit'],
  settings: {
    next: {
      rootDir: ['apps/*/']
    }
  }
}
