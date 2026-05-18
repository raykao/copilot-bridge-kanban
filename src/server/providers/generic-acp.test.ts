import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GenericAcpProvider } from './generic-acp.js';
import type { DispatchCallbacks } from '../card-session-manager.js';

// Mock AcpSessionManager to avoid real WebSocket connections in tests.
vi.mock('../acp-session-manager.js', () => ({
  AcpSessionManager: vi.fn().mockImplementation(() => ({
    dispatch: vi.fn(),
    resumeSession: vi.fn(),
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

describe('GenericAcpProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('discover()', () => {
    it('extracts wsUrl from ACP+WS supportedInterface when present', async () => {
      const mockCard = {
        name: 'test-agent',
        description: 'test',
        version: '1.0',
        supportedInterfaces: [
          { url: 'http://localhost:7878/v1', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' },
          { url: 'ws://localhost:3030/test-agent', protocolBinding: 'ACP+WS', protocolVersion: '1' },
        ],
        capabilities: { streaming: true, pushNotifications: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [],
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCard),
      } as unknown as Response);

      const provider = new GenericAcpProvider('p1', 'http://localhost:7878', null);
      await provider.discover();

      // After discover, dispatch should use the ACP+WS URL
      const { AcpSessionManager } = await import('../acp-session-manager.js');
      const callbacks = makeCallbacks();
      provider.dispatch('test-agent', 'hello', 'card-1', 'run-1', callbacks);

      expect(AcpSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'ws://localhost:3030/test-agent' }),
        callbacks,
      );
    });

    it('falls back to ws URL conversion when no ACP+WS interface present', async () => {
      const mockCard = {
        name: 'test-agent',
        description: 'test',
        version: '1.0',
        supportedInterfaces: [
          { url: 'http://localhost:7878/v1', protocolBinding: 'HTTP+JSON', protocolVersion: '0.3' },
        ],
        capabilities: { streaming: true, pushNotifications: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [],
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCard),
      } as unknown as Response);

      const provider = new GenericAcpProvider('p2', 'http://localhost:7878', null);
      await provider.discover();

      const { AcpSessionManager } = await import('../acp-session-manager.js');
      const callbacks = makeCallbacks();
      provider.dispatch('test-agent', 'hello', 'card-2', 'run-2', callbacks);

      expect(AcpSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'ws://localhost:7878' }),
        callbacks,
      );
    });
  });

  describe('dispatch()', () => {
    it('calls onComplete with failed status when called before discover', () => {
      const provider = new GenericAcpProvider('p3', 'http://localhost:7878', null);
      const callbacks = makeCallbacks();
      provider.dispatch('agent', 'hello', 'card-3', 'run-3', callbacks);
      expect(callbacks.onComplete).toHaveBeenCalledWith('card-3', 'run-3', 'failed', expect.stringContaining('not yet discovered'));
    });

    it('passes bearerToken from apiKey to AcpSessionManager', async () => {
      const mockCard = {
        name: 'agent',
        description: '',
        version: '1',
        supportedInterfaces: [
          { url: 'ws://host:3030/agent', protocolBinding: 'ACP+WS', protocolVersion: '1' },
        ],
        capabilities: { streaming: true, pushNotifications: false },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [],
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCard),
      } as unknown as Response);

      const provider = new GenericAcpProvider('p4', 'http://host:7878', 'my-api-key');
      await provider.discover();

      const { AcpSessionManager } = await import('../acp-session-manager.js');
      const callbacks = makeCallbacks();
      provider.dispatch('agent', 'hello', 'card-4', 'run-4', callbacks);

      expect(AcpSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({ bearerToken: 'my-api-key', auto_approve: false }),
        callbacks,
      );
    });
  });
});
