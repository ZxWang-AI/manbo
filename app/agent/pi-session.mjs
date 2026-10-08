import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { join } from 'node:path';

const EMPTY_RESOURCES = Object.freeze([]);

export async function createNoToolSession({ cwd, sdk: injectedSdk, tools, modelRuntime, selectedModel, model } = {}) {
  if (tools !== undefined) throw new Error('Pi tools cannot be overridden in no-tool mode');
  if (typeof cwd !== 'string' || !cwd) throw new Error('An existing cwd is required');
  const absoluteCwd = resolve(cwd);
  if (!(await stat(absoluteCwd)).isDirectory()) throw new Error('cwd must be an existing directory');
  const sdk = injectedSdk ?? await import('@earendil-works/pi-coding-agent');
  const agentDir = await mkdtemp(join(tmpdir(), 'manbo-empty-agent-resources-'));
  try {
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd: absoluteCwd,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionsOverride: (base) => ({ ...base, extensions: [], errors: [] }),
      skillsOverride: () => ({ skills: EMPTY_RESOURCES, diagnostics: [] }),
      promptsOverride: () => ({ prompts: EMPTY_RESOURCES, diagnostics: [] }),
      agentsFilesOverride: () => ({ agentsFiles: EMPTY_RESOURCES }),
    });
    await resourceLoader.reload();
    const { session } = await sdk.createAgentSession({
      cwd: absoluteCwd,
      modelRuntime,
      model: selectedModel,
      noTools: 'all',
      tools: [],
      sessionManager: sdk.SessionManager.inMemory(),
      settingsManager: sdk.SettingsManager.inMemory(),
      resourceLoader,
    });
    return {
      session,
      dispose: async () => {
        try {
          await session.dispose();
        } finally {
          await rm(agentDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await rm(agentDir, { recursive: true, force: true });
    throw error;
  }
}
