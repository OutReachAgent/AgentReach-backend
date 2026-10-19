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
    { search: jest.fn(), save: jest.fn() },
    { findAll: jest.fn() },
    { launchCampaign: jest.fn().mockResolvedValue({ status: 'RUNNING' }), findAll: jest.fn() },
    { getEmailHistory: jest.fn(), getCallHistory: jest.fn() },
    { listThreads: jest.fn() },
    { listSearches: jest.fn() },
    { getRawSettings: jest.fn().mockResolvedValue({ geminiApiKey: '' }), getSettings: jest.fn() },
    { getStats: jest.fn(), getFeed: jest.fn(), getReviewQueue: jest.fn(), reviewMatch: jest.fn() },
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
      .mockResolvedValueOnce({ id: 'thread-1', ownerId: 'owner-1', title: 'New conversation', model: 'gemini-flash-lite-latest', reasoningEffort: 'medium', pendingAction: null })
      .mockResolvedValueOnce({ id: 'thread-1', ownerId: 'owner-1', pendingAction: null });
    const response = makeResponse();

    await service.streamMessage('owner-1', 'thread-1', {
      content: 'Show dashboard performance',
    }, response);

    expect(dependencies[10].getRawSettings).toHaveBeenCalledWith('owner-1');
    expect(dependencies[1].getDashboardAnalytics).toHaveBeenCalledWith('owner-1');
    expect(db.aiChatThread.update).toHaveBeenCalledWith({
      where: { id: 'thread-1', ownerId: 'owner-1' },
      data: { title: 'Show dashboard performance' },
    });
    expect(response.write).toHaveBeenCalledWith(expect.stringContaining('structured workspace data'));
  });

  it('prepares a Signal review action without executing it', async () => {
    const review = {
      matchId: 'match-1',
      signal: { title: 'New hiring activity', companyName: 'Acme' },
      contact: { name: 'Alex Smith' },
      playbook: { name: 'Hiring follow-up' },
    };
    const { service, db, dependencies } = makeService();
    dependencies[11].getReviewQueue.mockResolvedValue([review]);

    const result = await (service as any).prepareSignalAction('owner-1', 'thread-1', {
      matchId: 'match-1',
      action: 'approve',
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.pendingAction).toEqual(expect.objectContaining({
      kind: 'review_signal_match',
      matchId: 'match-1',
      action: 'approve',
      signalTitle: 'New hiring activity',
    }));
    expect(db.aiChatThread.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pendingAction: expect.any(Object) }),
    }));
    expect(dependencies[11].reviewMatch).not.toHaveBeenCalled();
  });

  it('returns only unique contacts that are not already saved', async () => {
    const { service, dependencies } = makeService();
    dependencies[4].search.mockResolvedValue({
      domain: 'acme.com',
      people: [
        { email: 'known@acme.com', alreadyInContacts: true },
        { email: 'new@acme.com', alreadyInContacts: false },
        { email: 'NEW@ACME.COM', alreadyInContacts: false },
      ],
      total: 3,
    });

    const result = await (service as any).executeTool(
      'owner-1',
      'thread-1',
      'find_contacts',
      { domain: 'acme.com' },
      makeResponse(),
    );

    expect(result.people.map((person: any) => person.email)).toEqual([
      'new@acme.com',
    ]);
    expect(result.uniqueOnly).toBe(true);
    expect(result.excludedExistingContacts).toBe(2);
  });

  it('forces AI contact saves to skip existing and duplicate emails', async () => {
    const { service, db, dependencies } = makeService();
    db.contact.findMany
      .mockResolvedValueOnce([{ email: 'known@acme.com' }])
      .mockResolvedValueOnce([{ id: 'contact-new', email: 'new@acme.com' }]);
    dependencies[4].save.mockResolvedValue({
      added: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    });

    const result = await (service as any).saveContacts('owner-1', {
      people: [
        { email: 'known@acme.com', firstName: 'Known' },
        { email: 'new@acme.com', firstName: 'New' },
        { email: 'NEW@ACME.COM', firstName: 'Duplicate' },
      ],
      duplicateStrategy: 'OVERWRITE',
    });

    expect(dependencies[4].save).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({
        duplicateStrategy: 'SKIP',
        people: [expect.objectContaining({ email: 'new@acme.com' })],
      }),
    );
    expect(result.added).toBe(1);
    expect(result.existingContactsSkipped).toBe(1);
    expect(result.contacts).toEqual([
      { id: 'contact-new', email: 'new@acme.com' },
    ]);
  });
});
