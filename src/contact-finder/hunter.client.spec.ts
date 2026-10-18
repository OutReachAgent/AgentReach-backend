import { HunterClient } from './hunter.client';

function mockFetch(status: number, body: unknown) {
  const fetchMock = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  global.fetch = fetchMock as any;
  return fetchMock;
}

describe('HunterClient', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the key in a header, not the URL, and maps domain search results', async () => {
    const fetchMock = mockFetch(200, {
      data: {
        domain: 'acme.com',
        organization: 'Acme',
        pattern: '{first}',
        emails: [
          {
            value: 'Jane@Acme.com',
            type: 'personal',
            confidence: 94,
            first_name: 'Jane',
            last_name: 'Doe',
            position: 'CTO',
            seniority: 'executive',
            department: 'it',
            linkedin: 'https://linkedin.com/in/jane',
            phone_number: null,
            verification: { status: 'valid' },
            sources: [{ uri: 'https://acme.com/team' }],
          },
          { value: '', type: 'generic' },
        ],
      },
      meta: { results: 12, limit: 10, offset: 0 },
    });

    const result = await new HunterClient('secret-key').domainSearch({
      domain: 'acme.com',
      company: 'ignored',
      seniority: ['senior', 'executive'],
      limit: 10,
    });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toContain('/v2/domain-search?');
    expect(url).toContain('domain=acme.com');
    expect(url).toContain('seniority=senior%2Cexecutive');
    expect(url).not.toContain('company=');
    expect(url).not.toContain('secret-key');
    expect(init.headers['X-API-KEY']).toBe('secret-key');
    expect(init.signal).toBeDefined();

    expect(result.total).toBe(12);
    expect(result.people).toEqual([
      {
        email: 'jane@acme.com',
        firstName: 'Jane',
        lastName: 'Doe',
        position: 'CTO',
        seniority: 'executive',
        department: 'it',
        linkedinUrl: 'https://linkedin.com/in/jane',
        phoneNumber: '',
        company: 'Acme',
        domain: 'acme.com',
        type: 'personal',
        confidence: 94,
        verificationStatus: 'valid',
        sourceUrl: 'https://acme.com/team',
      },
    ]);
  });

  it('returns null when the email finder finds nothing', async () => {
    mockFetch(200, { data: { email: null } });
    await expect(
      new HunterClient('k').findEmail({
        domain: 'acme.com',
        firstName: 'Jane',
        lastName: 'Doe',
      }),
    ).resolves.toBeNull();
  });

  it('reads remaining searches from the account endpoint', async () => {
    mockFetch(200, {
      data: {
        plan_name: 'Free',
        reset_date: '2026-11-01',
        requests: {
          searches: { used: 3, available: 25, remaining: 22 },
          verifications: { used: 0, available: 50 },
        },
      },
    });
    const account = await new HunterClient('k').account();
    expect(account.planName).toBe('Free');
    expect(account.searches.remaining).toBe(22);
    expect(account.verifications.remaining).toBe(50);
    expect(account.credits).toBeUndefined();
  });

  it.each([
    [401, 'invalid'],
    [403, 'rate limiting'],
    [429, 'no searches left'],
    [451, 'asked Hunter not to share'],
  ])('explains a %s response', async (status, message) => {
    mockFetch(status, { errors: [{ details: 'raw' }] });
    await expect(new HunterClient('k').account()).rejects.toThrow(message);
  });

  it("passes Hunter's own error details through", async () => {
    mockFetch(400, {
      errors: [{ id: 'pagination_error', details: 'Limited to 10 emails' }],
    });
    await expect(
      new HunterClient('k').domainSearch({ domain: 'acme.com', offset: 10 }),
    ).rejects.toThrow('Hunter: Limited to 10 emails');
  });
});
