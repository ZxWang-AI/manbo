import { createJsonConnector } from "./export/json";
import { createMarkdownConnector } from "./export/markdown";
import type { Connector } from "./connector";

export function createConnectorRegistry(options: Parameters<typeof createMarkdownConnector>[0] = {}) {
  const connectors = [createMarkdownConnector(options), createJsonConnector(options)];
  return { list: (): readonly Connector[] => connectors, get: (id: string) => connectors.find((connector) => connector.describe().connectorId === id) };
}
