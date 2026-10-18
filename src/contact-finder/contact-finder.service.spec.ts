import { BadRequestException } from '@nestjs/common';
import { ContactFinderService } from './contact-finder.service';
import { HunterClient } from './hunter.client';

function makeService(apiKey = 'hunter-key') {
  const db: any = {
    contact: {
      findMany: jest.fn(async () => [{ email: 'known@acme.com' }]),
    },
  };
  const settings = { getHunterApiKey: jest.fn(async () => apiKey) };
  const contacts = {
    importContacts: jest.fn(async () => ({
      importedCount: 1,
      updatedCount: 0,
      skippedCount: 1,
      errors: ['Row 2: Missing first name'],
    })),
  };
  const service = new ContactFinderService(
    db,
    settings as any,
    contacts as any,
  );
  return { service, db, contacts };
}

const person = (email: string) => ({
  email,
  firstName: 'Jane',
  lastName: 'Doe',
  position: '',
  seniority: '',
  department: '',
  linkedinUrl: '',
  phoneNumber: '',
  company: 'Acme',
  domain: 'acme.com',
  type: 'personal',
  confidence: 90,
  verificationStatus: 'valid',
  sourceUrl: '',
});

describe('ContactFinderService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks for a Hunter key before searching', async () => {
    const { service } = makeService('');
    await expect(
      service.search('user-a', { domain: 'acme.com' }),
    ).rejects.toThrow('Add your Hunter.io API key in Settings');
  });

  it('rejects a domain that is not a domain', async () => {
    const { service } = makeService();
    await expect(
      service.search('user-a', { domain: 'not a domain' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('searches personal emails by default and marks people already in contacts', async () => {
    const { service, db } = makeService();
    const domainSearch = jest
      .spyOn(HunterClient.prototype, 'domainSearch')
      .mockResolvedValue({
        domain: 'acme.com',
        company: 'Acme',
        pattern: '',
        people: [person('known@acme.com'), person('new@acme.com')],
        total: 2,
        limit: 10,
        offset: 0,
      });

    const result = await service.search('user-a', {
      domain: 'https://www.Acme.com/about',
    });

    expect(domainSearch).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'acme.com', type: 'personal' }),
    );
    expect(db.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: 'user-a',
          email: { in: ['known@acme.com', 'new@acme.com'] },
        },
      }),
    );
    expect(result.people.map((p) => p.alreadyInContacts)).toEqual([
      true,
      false,
    ]);
  });

  it('saves selected people through the contacts import', async () => {
    const { service, contacts } = makeService();

    const result = await service.save('user-a', {
      people: [
        {
          email: 'jane@acme.com',
          firstName: 'Jane',
          lastName: 'Doe',
          position: 'CTO',
          company: 'Acme',
          confidence: 94,
          verificationStatus: 'valid',
        },
      ],
      directoryId: 'dir-1',
    });

    const [dto, userId] = contacts.importContacts.mock.calls[0] as any;
    expect(userId).toBe('user-a');
    expect(dto.directoryId).toBe('dir-1');
    expect(dto.duplicateStrategy).toBe('SKIP');
    expect(dto.rows[0]).toMatchObject({
      firstName: 'Jane',
      email: 'jane@acme.com',
      jobTitle: 'CTO',
      notes: 'Found via Hunter.io (confidence 94%, valid).',
      hunterConfidence: '94',
      hunterVerification: 'valid',
    });
    expect(result).toEqual({
      added: 1,
      updated: 0,
      skipped: 1,
      errors: ['Row 2: Missing first name'],
    });
  });
});
