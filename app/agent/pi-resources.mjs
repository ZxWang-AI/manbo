// Implement Pi's public ResourceLoader interface without invoking package,
// project or global discovery. Empty arrays are immutable; the per-session
// runtime remains mutable because Pi binds its internal hooks to it.
export function createEmptyResourceLoader(sdk, systemPrompt) {
  const empty = Object.freeze([]);
  const extensions = Object.freeze({ extensions: empty, errors: empty, runtime: sdk.createExtensionRuntime() });
  return Object.freeze({
    getExtensions: () => extensions,
    getSkills: () => Object.freeze({ skills: empty, diagnostics: empty }),
    getPrompts: () => Object.freeze({ prompts: empty, diagnostics: empty }),
    getThemes: () => Object.freeze({ themes: empty, diagnostics: empty }),
    getAgentsFiles: () => Object.freeze({ agentsFiles: empty }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => empty,
    getAppendSystemPromptSources: () => empty,
    extendResources(paths = {}) {
      if (!paths || typeof paths !== 'object' || Array.isArray(paths) || Object.entries(paths).some(([key, value]) =>
        !['skillPaths', 'promptPaths', 'themePaths'].includes(key) || !Array.isArray(value) || value.length !== 0)) {
        throw new Error('Pi resource extension is disabled');
      }
    },
    async reload() {},
  });
}
