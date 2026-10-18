import { AiChatService } from './ai-chat.service';

function makeResponse() {
  return {
    writableEnded: false,
    write: jest.fn(),
    end: jest.fn(),
  } as any;
}

function makeService(overrides: Record<string, any> = {}) {
  const db = {
    aiChatThread: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    aiChatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    contact: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const dependencies = [
    db,
    { getDashboardAnalytics: jest.fn() },
    { findAll: jest.fn() },
    { launchCampaign: jest.fn().mockResolvedValue({ status: 'RUNNING' }), findAll: jest.fn() },
    { search: jest.fn() },
    { findAll: jest.fn() },
    { launchCampaign: jest.fn().mockResolvedValue({ status: 'RUNNING' }), findAll: jest.fn() },
    { getEmailHistory: jest.fn(), getCallHistory: jest.fn() },
    { listThreads: jest.fn() },
    { listSearches: jest.fn() },
    { getRawSettings: jest.fn().mockResolvedValue({ geminiApiKey: '' }), getSettings: jest.fn() },
    { getStats: jest.fn(), getFeed: jest.fn(), getReviewQueue: jest.fn() },
    { findAll: jest.fn() },
    { findAll: jest.fn(), generateAiTemplate: jest.fn(), create: jest.fn(), findOne: jest.fn() },
  ];
  const service = new AiChatService(...(dependencies as any));
  Object.assign(service as any, overrides);
  return { service, db, dependencies };
}

describe('AiChatService', () => {
  it('returns the configured model and reasoning options', () => {
    const { service } = makeService();
    const result = service.models();

    expect(result.defaultModel).toBe('gemini-flash-lite-latest');
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.reasoningEfforts.map((item) => item.value)).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('does not allow a conversation from another owner to be read', async () => {
    const { service, db } = makeService();
    db.aiChatThread.findUnique.mockResolvedValue(null);

    await expect(service.getThread('owner-a', 'thread-b')).rejects.toThrow(
      'AI conversation not found',
    );
    expect(db.aiChatThread.findUnique).toHaveBeenCalledWith({
      where: { id: 'thread-b', ownerId: 'owner-a' },
    });
  });

  it('launches only after an explicit confirmation and clears the pending action', async () => {
    const pendingAction = {
      kind: 'launch_email_campaign',
      campaignId: 'campaign-1',
      campaignName: 'Hiring outreach',
      contactCount: 3,
    };
    const { service, db, dependencies } = makeService();
    db.aiChatThread.findUnique
      .mockResolvedValueOnce({ id: 'thread-1', ownerId: 'owner-1', model: 'gemini-flash-lite-latest', reasoningEffort: 'medium', pendingAction })
      .mockResolvedValueOnce({ id: 'thread-1', ownerId: 'owner-1', pendingAction: null });
    const response = makeResponse();

    await service.streamMessage('owner-1', 'thread-1', {
      content: 'Confirm launch',
      confirm: true,
    }, response);

    expect(dependencies[6].launchCampaign).toHaveBeenCalledWith('campaign-1', 'owner-1');
    expect(db.aiChatThread.update).toHaveBeenCalledWith({
      where: { id: 'thread-1', ownerId: 'owner-1' },
      data: { pendingAction: null, status: 'idle' },
    });
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('event: delta'));
    expect(response.end).toHaveBeenCalled();
  });

  it('provides structured workspace data when Gemini is not configured', async () => {
    const { service, db, dependencies } = makeService();
    const analytics = { emailMetrics: { sent: 4 }, callingMetrics: { callsMade: 2 } };
    dependencies[1].getDashboardAnalytics.mockResolvedValue(analytics);
    db.aiChatThread.findUnique
      .mockResolvedValueOnce({ id: 'thread-1', ownerId: 'owner-1', model: 'gemini-flash-lite-latest', reasoningEffort: 'medium', pendingAction: null })
      .mockResolvedValueOnce({ id: 'thread-1', ownerId: 'owner-1', pendingAction: null });
    const response = makeResponse();

    await service.streamMessage('owner-1', 'thread-1', {
      content: 'Show dashboard performance',
    }, response);

    expect(dependencies[10].getRawSettings).toHaveBeenCalledWith('owner-1');
    expect(dependencies[1].getDashboardAnalytics).toHaveBeenCalledWith('owner-1');
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('structured workspace data'));
  });
});
