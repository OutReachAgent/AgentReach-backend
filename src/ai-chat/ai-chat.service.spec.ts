import { AiChatService } from './ai-chat.service';

const mockGenerateContentStream = jest.fn();
jest.mock('@google/genai', () => ({
  ...jest.requireActual('@google/genai'),
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContentStream: mockGenerateContentStream },
  })),
}));

function streamOf(...chunks: any[]) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

const chunk = (...parts: any[]) => ({ candidates: [{ content: { parts } }] });

function writes(response: any) {
  return response.write.mock.calls.map((call: any[]) => String(call[0])).join('');
}

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
    emailCampaign: { findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    callingCampaign: { findUnique: jest.fn() },
  };
  const dependencies: any[] = [
    db,
    { getDashboardAnalytics: jest.fn() },
    { findAll: jest.fn() },
    { launchCampaign: jest.fn().mockResolvedValue({ status: 'RUNNING' }), findAll: jest.fn(), remove: jest.fn() },
    { search: jest.fn(), save: jest.fn() },
    { findAll: jest.fn() },
    { launchCampaign: jest.fn().mockResolvedValue({ status: 'RUNNING' }), findAll: jest.fn(), remove: jest.fn() },
    { getEmailHistory: jest.fn(), getCallHistory: jest.fn() },
    { listThreads: jest.fn() },
    { listSearches: jest.fn(), addToContacts: jest.fn() },
    { getRawSettings: jest.fn().mockResolvedValue({ geminiApiKey: '' }), getSettings: jest.fn() },
    { getStats: jest.fn(), getFeed: jest.fn(), getReviewQueue: jest.fn(), reviewMatch: jest.fn() },
    { findAll: jest.fn() },
    { findAll: jest.fn() },
    { findAll: jest.fn(), generateAiTemplate: jest.fn(), create: jest.fn(), findOne: jest.fn(), remove: jest.fn() },
  ];
  const service = new AiChatService(...(dependencies as [any, any, any, any, any, any, any, any, any, any, any, any, any, any, any]));
  Object.assign(service as any, overrides);
  return { service, db, dependencies };
}

const thread = (extra: Record<string, unknown> = {}) => ({
  id: 'thread-1',
  ownerId: 'owner-1',
  title: 'Existing conversation',
  model: 'gemini-flash-lite-latest',
  reasoningEffort: 'medium',
  pendingAction: null,
  ...extra,
});

const hunterPerson = (email: string, firstName = 'Jane') => ({
  email,
  firstName,
  lastName: 'Doe',
  position: 'VP Sales',
  company: 'Acme',
  confidence: 92,
  verificationStatus: 'valid',
  sourceUrl: 'https://acme.com/team',
});

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
    db.aiChatMessage.findMany.mockResolvedValueOnce([
      {
        toolName: 'find_contacts',
        toolResult: { people: [hunterPerson('known@acme.com', 'Known'), hunterPerson('new@acme.com', 'New')] },
      },
    ]);
    db.contact.findMany
      .mockResolvedValueOnce([{ email: 'known@acme.com' }])
      .mockResolvedValueOnce([{ id: 'contact-new', email: 'new@acme.com' }]);
    dependencies[4].save.mockResolvedValue({
      added: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    });

    const result = await (service as any).saveContacts('owner-1', 'thread-1', {
      emails: ['known@acme.com', 'new@acme.com', 'NEW@ACME.COM'],
      duplicateStrategy: 'OVERWRITE',
    });

    expect(dependencies[4].save).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({
        duplicateStrategy: 'SKIP',
        people: [expect.objectContaining({ email: 'new@acme.com', firstName: 'New' })],
      }),
    );
    expect(result.added).toBe(1);
    expect(result.existingContactsSkipped).toBe(1);
    expect(result.contacts).toEqual([
      { id: 'contact-new', email: 'new@acme.com' },
    ]);
  });

  it('saves only people a finder returned in this conversation, using the stored details', async () => {
    const { service, db, dependencies } = makeService();
    db.aiChatMessage.findMany.mockResolvedValueOnce([
      { toolName: 'find_contacts', toolResult: { people: [hunterPerson('jane@acme.com')] } },
    ]);
    db.contact.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    dependencies[4].save.mockResolvedValue({ added: 1, updated: 0, skipped: 0, errors: [] });

    const result = await (service as any).saveContacts('owner-1', 'thread-1', {
      emails: ['jane@acme.com', 'made.up@acme.com'],
    });

    expect(db.aiChatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ threadId: 'thread-1', toolName: { in: ['find_contacts', 'find_hiring_companies'] } }),
    }));
    expect(dependencies[4].save).toHaveBeenCalledWith('owner-1', expect.objectContaining({
      people: [expect.objectContaining({ email: 'jane@acme.com', position: 'VP Sales', verificationStatus: 'valid' })],
    }));
    expect(result.notFound).toEqual(['made.up@acme.com']);
  });

  it('refuses to save addresses no finder returned', async () => {
    const { service, db, dependencies } = makeService();
    db.aiChatMessage.findMany.mockResolvedValueOnce([]);

    await expect((service as any).saveContacts('owner-1', 'thread-1', {
      emails: ['invented@acme.com'],
    })).rejects.toThrow('nothing was saved');
    expect(dependencies[4].save).not.toHaveBeenCalled();
  });

  it('adds Prospect Finder people through Prospect Finder', async () => {
    const { service, db, dependencies } = makeService();
    db.aiChatMessage.findMany.mockResolvedValueOnce([
      {
        toolName: 'find_hiring_companies',
        toolResult: { people: [{ id: 'prospect-1', email: 'sam@beta.io', firstName: 'Sam', lastName: 'Lee' }] },
      },
    ]);
    db.contact.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    dependencies[9].addToContacts.mockResolvedValue({ added: 1, updated: 0, duplicates: 0, skipped: [], errors: [] });

    const result = await (service as any).saveContacts('owner-1', 'thread-1', { emails: ['sam@beta.io'] });

    expect(dependencies[9].addToContacts).toHaveBeenCalledWith('owner-1', expect.objectContaining({
      ids: ['prospect-1'],
      duplicateStrategy: 'SKIP',
    }));
    expect(dependencies[4].save).not.toHaveBeenCalled();
    expect(result.added).toBe(1);
  });

  it('searches without the hiring filter unless the user asks for it', async () => {
    const { service, dependencies } = makeService();
    dependencies[4].search.mockResolvedValue({ people: [], total: 0 });

    await (service as any).executeTool('owner-1', 'thread-1', 'find_contacts', { domain: 'acme.com' }, makeResponse());
    await (service as any).executeTool('owner-1', 'thread-1', 'find_contacts', { domain: 'acme.com', hiring: true }, makeResponse());

    expect(dependencies[4].search.mock.calls[0][1].hiring).toBeUndefined();
    expect(dependencies[4].search.mock.calls[1][1].hiring).toBe(true);
  });

  it('returns a failing tool to the model as an error instead of ending the answer', async () => {
    const { service, dependencies } = makeService();
    dependencies[4].search.mockRejectedValue(new Error('Your Hunter plan has no searches left this month.'));

    const result = await (service as any).runTool(
      'owner-1',
      'thread-1',
      { name: 'find_contacts', args: { domain: 'acme.com' } },
      makeResponse(),
      undefined,
      {},
    );

    expect(result).toEqual({ error: 'Your Hunter plan has no searches left this month.' });
  });

  it('stops spending Hunter searches after the per-answer limit', async () => {
    const { service, dependencies } = makeService();
    dependencies[4].search.mockResolvedValue({ people: [], total: 0 });
    const usage = {};
    const call = { name: 'find_contacts', args: { domain: 'acme.com' } };

    const results: any[] = [];
    for (let index = 0; index < 4; index++) {
      results.push(await (service as any).runTool('owner-1', 'thread-1', call, makeResponse(), undefined, usage));
    }

    expect(dependencies[4].search).toHaveBeenCalledTimes(3);
    expect(results[3].error).toContain('already ran 3 time(s)');
  });

  it('returns the newest messages of a long conversation, oldest first', async () => {
    const { service, db } = makeService();
    db.aiChatThread.findUnique.mockResolvedValue(thread());
    db.aiChatMessage.findMany.mockResolvedValue([{ id: 'm3' }, { id: 'm2' }, { id: 'm1' }]);

    const result = await service.getThread('owner-1', 'thread-1');

    expect(db.aiChatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: 'desc' },
      take: 200,
    }));
    expect(result.messages.map((message: any) => message.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('rejects a confirmation for a preview that is no longer current', async () => {
    const { service, db, dependencies } = makeService();
    const pendingAction = { id: 'action-new', kind: 'launch_email_campaign', campaignId: 'campaign-1' };
    db.aiChatThread.findUnique.mockResolvedValueOnce(thread({ pendingAction }));
    const response = makeResponse();

    await service.streamMessage('owner-1', 'thread-1', {
      content: 'Confirm launch',
      confirm: true,
      actionId: 'action-old',
    }, response);

    expect(dependencies[6].launchCampaign).not.toHaveBeenCalled();
    expect(writes(response)).toContain('out of date');
  });

  it('removes the draft campaign and its template when a launch is cancelled', async () => {
    const { service, db, dependencies } = makeService();
    const pendingAction = {
      id: 'action-1',
      kind: 'launch_email_campaign',
      campaignId: 'campaign-1',
      templateId: 'template-1',
      templateCreated: true,
    };
    db.aiChatThread.findUnique.mockResolvedValueOnce(thread({ pendingAction }));
    db.emailCampaign.findUnique.mockResolvedValue({ id: 'campaign-1', status: 'DRAFT' });
    const response = makeResponse();

    await service.streamMessage('owner-1', 'thread-1', { content: 'Cancel' }, response);

    expect(dependencies[6].remove).toHaveBeenCalledWith('campaign-1', 'owner-1');
    expect(dependencies[14].remove).toHaveBeenCalledWith('template-1', 'owner-1');
    expect(writes(response)).toContain('the draft was removed');
  });

  it('keeps a cancelled campaign that is no longer a draft', async () => {
    const { service, db, dependencies } = makeService();
    const pendingAction = { id: 'action-1', kind: 'launch_email_campaign', campaignId: 'campaign-1' };
    db.aiChatThread.findUnique.mockResolvedValueOnce(thread({ pendingAction }));
    db.emailCampaign.findUnique.mockResolvedValue({ id: 'campaign-1', status: 'RUNNING' });

    await service.streamMessage('owner-1', 'thread-1', { content: 'Cancel' }, makeResponse());

    expect(dependencies[6].remove).not.toHaveBeenCalled();
  });

  describe('with Gemini configured', () => {
    beforeEach(() => mockGenerateContentStream.mockReset());

    it('streams the answer and sends the latest messages as context, oldest first', async () => {
      const { service, db, dependencies } = makeService();
      dependencies[10].getRawSettings.mockResolvedValue({ geminiApiKey: 'key' });
      db.aiChatThread.findUnique
        .mockResolvedValueOnce(thread())
        .mockResolvedValueOnce(thread());
      db.aiChatMessage.findMany.mockResolvedValueOnce([
        { role: 'user', content: 'Latest question' },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'tool', toolName: 'find_contacts', toolResult: { people: [hunterPerson('jane@acme.com')] } },
        { role: 'user', content: 'Earlier question' },
      ]);
      mockGenerateContentStream.mockResolvedValueOnce(
        streamOf(chunk({ text: 'Hello ' }), chunk({ text: 'there.' })),
      );
      const response = makeResponse();

      await service.streamMessage('owner-1', 'thread-1', { content: 'Latest question' }, response);

      const contents = mockGenerateContentStream.mock.calls[0][0].contents;
      expect(contents.map((item: any) => item.role)).toEqual(['user', 'model', 'user']);
      expect(contents[0].parts[0].text).toBe('Earlier question');
      expect(contents[0].parts[1].text).toContain('jane@acme.com');
      expect(contents[2].parts[0].text).toBe('Latest question');
      const output = writes(response);
      expect(output).toContain('"text":"Hello "');
      expect(output).toContain('"text":"there."');
      expect(output.match(/event: delta/g)).toHaveLength(2);
      expect(db.aiChatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'assistant', content: 'Hello there.' }),
      });
    });

    it('runs tools between rounds and clears narration written before a tool call', async () => {
      const { service, db, dependencies } = makeService();
      dependencies[10].getRawSettings.mockResolvedValue({ geminiApiKey: 'key' });
      dependencies[4].search.mockResolvedValue({ people: [hunterPerson('jane@acme.com')], total: 1 });
      db.aiChatThread.findUnique
        .mockResolvedValueOnce(thread())
        .mockResolvedValueOnce(thread());
      db.aiChatMessage.findMany.mockResolvedValueOnce([{ role: 'user', content: 'Find sales leaders at acme.com' }]);
      mockGenerateContentStream
        .mockResolvedValueOnce(streamOf(chunk(
          { text: 'Let me check.' },
          { functionCall: { id: 'call-1', name: 'find_contacts', args: { domain: 'acme.com' } } },
        )))
        .mockResolvedValueOnce(streamOf(chunk({ text: 'Found Jane Doe.' })));
      const response = makeResponse();

      await service.streamMessage('owner-1', 'thread-1', { content: 'Find sales leaders at acme.com' }, response);

      const output = writes(response);
      expect(output).toContain('event: reset');
      expect(output).toContain('event: tool_start');
      expect(output).toContain('event: tool_result');
      expect(db.aiChatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'tool', toolName: 'find_contacts' }),
      });
      const secondRound = mockGenerateContentStream.mock.calls[1][0].contents;
      expect(secondRound[secondRound.length - 1].parts[0].functionResponse).toEqual(
        expect.objectContaining({ id: 'call-1', name: 'find_contacts' }),
      );
      expect(db.aiChatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'assistant', content: 'Found Jane Doe.' }),
      });
    });

    it('stops without an error when the client disconnects', async () => {
      const { service, db, dependencies } = makeService();
      dependencies[10].getRawSettings.mockResolvedValue({ geminiApiKey: 'key' });
      db.aiChatThread.findUnique.mockResolvedValueOnce(thread());
      db.aiChatMessage.findMany.mockResolvedValueOnce([{ role: 'user', content: 'Hi' }]);
      const controller = new AbortController();
      controller.abort();
      const response = makeResponse();

      await service.streamMessage('owner-1', 'thread-1', { content: 'Hi' }, response, controller.signal);

      expect(mockGenerateContentStream).not.toHaveBeenCalled();
      expect(writes(response)).not.toContain('event: error');
      expect(db.aiChatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'assistant', content: 'Stopped before finishing.' }),
      });
    });
  });
});
