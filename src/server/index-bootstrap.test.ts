import { describe, it, expect } from 'vitest';
import { buildProviderInstance } from './providers/build.js';
import { CopilotBridgeProvider } from './providers/copilot-bridge.js';
import { GenericAcpProvider } from './providers/generic-acp.js';
import type { Provider } from './providers-db.js';
import type { DispatchCallbacks } from './card-session-manager.js';

const noopCallbacks = {
  onRunCreated: () => {},
  onEvent: () => {},
  onAgentMessage: () => {},
  onComplete: () => {},
  onPermissionRequest: () => {},
  onInterrupted: () => {},
} as unknown as DispatchCallbacks;

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    id: 'p-1',
    type: 'acp',
    label: 'test',
    url: 'http://host:1',
    ws_url: null,
    api_key: null,
    status: 'disconnected',
    last_discovered_at: null,
    created_at: '2026-05-18T00:00:00Z',
    ...overrides,
  };
}

describe('buildProviderInstance', () => {
  it('returns a CopilotBridgeProvider for type copilot-bridge', () => {
    const p = makeProvider({ id: 'p-cb', type: 'copilot-bridge', url: 'http://b:8080', api_key: 'k' });
    const instance = buildProviderInstance(p, noopCallbacks);
    expect(instance).toBeInstanceOf(CopilotBridgeProvider);
    expect(instance?.id).toBe('p-cb');
  });

  it('returns a GenericAcpProvider for type acp', () => {
    const p = makeProvider({ id: 'p-acp', type: 'acp', url: 'http://a:8080', api_key: null });
    const instance = buildProviderInstance(p, noopCallbacks);
    expect(instance).toBeInstanceOf(GenericAcpProvider);
    expect(instance?.id).toBe('p-acp');
  });

  it('returns null for an unknown type', () => {
    const p = makeProvider({ id: 'p-x', type: 'foo' as Provider['type'] });
    const instance = buildProviderInstance(p, noopCallbacks);
    expect(instance).toBeNull();
  });
});
