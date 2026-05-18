import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CopilotBridgeProvider } from './copilot-bridge.js';
import type { DispatchCallbacks } from '../card-session-manager.js';

vi.mock('../acp-session-manager.js', () => ({
  AcpSessionManager: vi.fn().mockImplementation(() => ({
    dispatch: vi.fn(),
  })),
}));

const makeCallbacks = (): DispatchCallbacks => ({
  onRunCreated: vi.fn(),
  onEvent: vi.fn(),
  onAgentMessage: vi.fn(),
  onComplete: vi.fn(),
  onPermissionRequest: vi.fn(),
  onInterrupted: vi.fn(),
});

const makeBridgeCard = (name: string, wsUrl: string) => ({
  name,
  description: `copilot-bridge agent: ${name}`,
  version: '1.0.0',
  supportedInterfaces: [
    { url: 'http://localhost:7878/v1', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' },
    { url: wsUrl, protocolBinding: 'ACP+WS', protocolVersion: '1' },
  ],
  capabilities: { streaming: true, pushNotifications: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'chat', name: 'Chat', description: 'Chat', tags: ['chat'] }],
  securitySchemes: {},
  securityRequirements: [],
});

describe('CopilotBridgeProvider', () => {
  let callbacks: DispatchCallbacks;
  beforeEach(() => { callbacks = makeCallbacks(); });

  describe('discover()', () => {
    it('populates agentWsUrls from ACP+WS supportedInterface', async () => {
      const cards = [
        makeBridgeCard('bob', 'ws://localhost:3030/bob'),
        makeBridgeCard('homer', 'ws://localhost:3030/homer'),
      ];

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ cards }),
      } as unknown as Response);

      const provider = new CopilotBridgeProvider('p1', 'http://localhost:7878', 'key', callbacks);
      const result = await provider.discover();

      expect(result).toHaveLength(2);
      expect(result[0].providerType).toBe('copilot-bridge');
      expect(result[0].providerBaseUrl).toBe('http://localhost:7878');
    });

    it('throws when catalog request fails', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as unknown as Response);

      const provider = new CopilotBridgeProvider('p2', 'http://localhost:7878', 'bad', callbacks);
      await expect(provider.discover()).rejects.toThrow('CopilotBridgeProvider discover failed: 401');
    });
  });

  describe('dispatch()', () => {
    it('calls onComplete with failed when agent not in agentWsUrls (before discover)', () => {
      const provider = new CopilotBridgeProvider('p3', 'http://localhost:7878', 'key', callbacks);
      provider.dispatch('bob', 'hello', 'card-1', 'run-1', callbacks);
      expect(callbacks.onComplete).toHaveBeenCalledWith(
        'card-1', 'run-1', 'failed', expect.stringContaining("no WS URL for agent 'bob'"),
      );
    });

    it('creates AcpSessionManager with correct WS URL after discover', async () => {
      const cards = [makeBridgeCard('bob', 'ws://localhost:3030/bob')];
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ cards }),
      } as unknown as Response);

      const provider = new CopilotBridgeProvider('p4', 'http://localhost:7878', 'api-key', callbacks);
      await provider.discover();

      const { AcpSessionManager } = await import('../acp-session-manager.js');
      const dispatchCallbacks = makeCallbacks();
      provider.dispatch('bob', 'hello', 'card-2', 'run-2', dispatchCallbacks);

      expect(AcpSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'ws://localhost:3030/bob',
          auto_approve: false,
          bearerToken: 'api-key',
        }),
        dispatchCallbacks,
      );

      const mockInstance = vi.mocked(AcpSessionManager).mock.results.at(-1)?.value as { dispatch: ReturnType<typeof vi.fn> };
      expect(mockInstance.dispatch).toHaveBeenCalledWith('card-2', 'bob', 'hello', 'run-2');
    });

    it('omits bearerToken when apiKey is null or empty', async () => {
      const cards = [makeBridgeCard('bob', 'ws://localhost:3030/bob')];
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ cards }),
      } as unknown as Response);

      const provider = new CopilotBridgeProvider('p5', 'http://localhost:7878', null, callbacks);
      await provider.discover();

      const { AcpSessionManager } = await import('../acp-session-manager.js');
      provider.dispatch('bob', 'hi', 'card-3', 'run-3', makeCallbacks());

      expect(AcpSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({ bearerToken: undefined }),
        expect.anything(),
      );
    });
  });
});
