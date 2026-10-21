import { BadRequestException, Injectable } from '@nestjs/common';
import { MongoService } from '../mongo.service';
import { SettingsService } from '../settings/settings.service';
import { ContactsService } from '../contacts/contacts.service';
import { normalizeDomain } from '../prospects/site-reader';
import { HunterClient, HunterPerson } from './hunter.client';
import {
  ContactFinderFindEmailDto,
  ContactFinderSaveDto,
  ContactFinderSearchDto,
  ContactFinderVerifyDto,
} from './dto/contact-finder.dto';

@Injectable()
export class ContactFinderService {
  constructor(
    private readonly db: MongoService,
    private readonly settings: SettingsService,
    private readonly contacts: ContactsService,
  ) {}

  async account(userId: string) {
    const client = await this.client(userId);
    return client.account();
  }

  async search(userId: string, dto: ContactFinderSearchDto) {
    const client = await this.client(userId);
    const requestedTarget = this.target(dto);
    const location = this.location(dto.location);
    const target = await this.hiringTarget(client, requestedTarget, dto);
    if (!target) {
      return {
        domain: requestedTarget.domain || '',
        company: requestedTarget.company || '',
        pattern: '',
        people: [],
        total: 0,
        limit: dto.limit ?? 10,
        offset: dto.offset ?? 0,
      };
    }
    const params = {
      ...target,
      type: dto.type || 'personal',
      seniority: dto.seniority?.length ? dto.seniority : undefined,
      department: dto.department?.length ? dto.department : undefined,
      location,
      jobTitles: dto.jobTitles?.map((title) => title.trim()).filter(Boolean),
      limit: dto.limit ?? 10,
      offset: dto.offset ?? 0,
    };
    // Hunter caps results per request on some plans (10 on Free); retry at
    // the cap instead of failing the search.
    const result = await client.domainSearch(params).catch((error) => {
      const allowed = Number(
        /limited to (\d+) email/i.exec(String(error?.message))?.[1],
      );
      if (!allowed || params.offset > 0 || params.limit <= allowed) {
        throw error;
      }
      return client.domainSearch({ ...params, limit: allowed });
    });
    return {
      ...result,
      people: await this.markExisting(userId, result.people),
    };
  }

  async findEmail(userId: string, dto: ContactFinderFindEmailDto) {
    const target = this.target(dto);
    const client = await this.client(userId);
    const person = await client.findEmail({
      ...target,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
    });
    if (!person) return { person: null };
    const [marked] = await this.markExisting(userId, [person]);
    return { person: marked };
  }

  async verify(userId: string, dto: ContactFinderVerifyDto) {
    const client = await this.client(userId);
    return client.verifyEmail(dto.email.trim().toLowerCase());
  }

  async save(userId: string, dto: ContactFinderSaveDto) {
    const result = await this.contacts.importContacts(
      {
        rows: dto.people.map((person) => ({
          firstName: person.firstName,
          lastName: person.lastName || '',
          email: person.email,
          company: person.company || '',
          jobTitle: person.position || '',
          phoneNumber: person.phoneNumber,
          linkedinUrl: person.linkedinUrl,
          notes: `Found via Hunter.io${this.describe(person)}.`,
          hunterConfidence:
            person.confidence !== undefined ? String(person.confidence) : '',
          hunterVerification: person.verificationStatus || '',
          hunterSource: person.sourceUrl || '',
        })),
        mapping: {
          firstName: 'firstName',
          lastName: 'lastName',
          email: 'email',
          company: 'company',
          jobTitle: 'jobTitle',
          phoneNumber: 'phoneNumber',
          linkedinUrl: 'linkedinUrl',
          notes: 'notes',
          hunterConfidence: 'hunterConfidence',
          hunterVerification: 'hunterVerification',
          hunterSource: 'hunterSource',
        },
        duplicateStrategy: dto.duplicateStrategy || 'SKIP',
        directoryId: dto.directoryId,
      },
      userId,
    );

    return {
      added: result.importedCount,
      updated: result.updatedCount,
      skipped: result.skippedCount,
      errors: result.errors,
    };
  }

  private async client(userId: string) {
    const apiKey = await this.settings.getHunterApiKey(userId);
    if (!apiKey) {
      throw new BadRequestException(
        'Add your Hunter.io API key in Settings to search for contacts.',
      );
    }
    return new HunterClient(apiKey);
  }

  private target(dto: { domain?: string; company?: string }) {
    const rawDomain = dto.domain?.trim();
    if (rawDomain) {
      const domain = normalizeDomain(rawDomain);
      if (!domain) {
        throw new BadRequestException(
          'Enter a domain such as example.com, or search by company name.',
        );
      }
      return { domain };
    }
    const company = dto.company?.trim();
    if (!company) {
      throw new BadRequestException('Enter a company domain or name.');
    }
    return { company };
  }

  private async hiringTarget(
    client: HunterClient,
    target: { domain?: string; company?: string },
    dto: ContactFinderSearchDto,
  ) {
    if (dto.hiring === undefined) return target;

    const discovered = await client.discover({
      ...target,
      hiring: dto.hiring,
    });
    const company = discovered.companies[0];
    if (!company?.domain) return null;
    return { domain: company.domain };
  }

  private location(location?: {
    country?: string;
    state?: string;
    city?: string;
    continent?: string;
    businessRegion?: string;
  }) {
    if (!location) return undefined;
    const normalized = {
      country: location.country?.trim().toUpperCase(),
      state: location.state?.trim(),
      city: location.city?.trim(),
      continent: location.continent?.trim(),
      businessRegion: location.businessRegion?.trim().toUpperCase(),
    };
    const hasValue = Object.values(normalized).some(Boolean);
    if (!hasValue) return undefined;
    if ((normalized.city || normalized.state) && !normalized.country) {
      throw new BadRequestException(
        'Country is required when filtering by city or state.',
      );
    }
    if (
      (normalized.continent || normalized.businessRegion) &&
      (normalized.country || normalized.state || normalized.city)
    ) {
      throw new BadRequestException(
        'Use a continent or business region, or a country/state/city location.',
      );
    }
    return normalized;
  }

  private async markExisting(userId: string, people: HunterPerson[]) {
    const emails = people.map((person) => person.email).filter(Boolean);
    if (!emails.length) return [];
    const existing = await this.db.contact.findMany({
      where: { ownerId: userId, email: { in: emails } },
      select: { email: true },
    });
    const known = new Set(
      existing.map((contact: any) => String(contact.email).trim().toLowerCase()),
    );
    return people.map((person) => ({
      ...person,
      alreadyInContacts: known.has(
        String(person.email || '').trim().toLowerCase(),
      ),
    }));
  }

  private describe(person: {
    confidence?: number;
    verificationStatus?: string;
  }) {
    const parts = [
      person.confidence !== undefined ? `confidence ${person.confidence}%` : '',
      person.verificationStatus || '',
    ].filter(Boolean);
    return parts.length ? ` (${parts.join(', ')})` : '';
  }
}
