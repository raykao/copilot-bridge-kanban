import type { DispatchCallbacks } from '../card-session-manager.js';
import type { Provider } from '../providers-db.js';
import type { AgentProvider } from './types.js';
import { CopilotBridgeProvider } from './copilot-bridge.js';
import { GenericAcpProvider } from './generic-acp.js';

export function buildProviderInstance(
  provider: Provider,
  callbacks: DispatchCallbacks,
): AgentProvider | null {
  if (provider.type === 'copilot-bridge') {
    return new CopilotBridgeProvider(provider.id, provider.url, provider.api_key, callbacks);
  }
  if (provider.type === 'acp') {
    return new GenericAcpProvider(provider.id, provider.url, provider.api_key);
  }
  return null;
}
