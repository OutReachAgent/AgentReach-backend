import { BadRequestException } from '@nestjs/common';

const HUNTER_API_URL = 'https://api.hunter.io/v2';
const HUNTER_TIMEOUT_MS = 25000;

export type HunterPerson = {
  email: string;
  firstName: string;
  lastName: string;
  position: string;
  seniority: string;
  department: string;
  linkedinUrl: string;
  phoneNumber: string;
  company: string;
  domain: string;
  type: string;
  confidence: number;
  verificationStatus: string;
  sourceUrl: string;
};

export type HunterUsage = {
  used: number;
  available: number;
  remaining: number;
};

export type HunterAccount = {
  planName: string;
  resetDate: string;
  searches: HunterUsage;
  verifications: HunterUsage;
  credits?: HunterUsage;
};

export type HunterLocation = {
  country?: string;
  state?: string;
  city?: string;
  continent?: string;
  businessRegion?: string;
};

export type HunterDomainSearchParams = {
  domain?: string;
  company?: string;
  type?: string;
  seniority?: string[];
  department?: string[];
  location?: HunterLocation;
  jobTitles?: string[];
  limit?: number;
  offset?: number;
};

export type HunterDiscoverParams = {
  domain?: string;
  company?: string;
  location?: HunterLocation;
  hiring?: boolean;
};

export type HunterEmailFinderParams = {
  domain?: string;
  company?: string;
  firstName: string;
  lastName: string;
};

const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const usage = (value: any): HunterUsage => ({
  used: Number(value?.used) || 0,
  available: Number(value?.available) || 0,
  remaining: Number(value?.remaining ?? value?.available - value?.used) || 0,
});

export function hunterErrorMessage(status: number, body: any) {
  const details = text(body?.errors?.[0]?.details);
  if (status === 401) {
    return 'Your Hunter API key is invalid. Check it in Settings.';
  }
  if (status === 403) {
    return 'Hunter is rate limiting requests. Wait a moment and try again.';
  }
  if (status === 429) {
    return 'Your Hunter plan has no searches left this month.';
  }
  if (status === 451) {
    return 'This person asked Hunter not to share their details.';
  }
  return details ? `Hunter: ${details}` : `Hunter request failed (${status}).`;
}

export class HunterClient {
  constructor(private readonly apiKey: string) {}

  async account(): Promise<HunterAccount> {
    const data = await this.get('/account', {});
    const account: HunterAccount = {
      planName: text(data?.plan_name) || 'Unknown',
      resetDate: text(data?.reset_date),
      searches: usage(data?.requests?.searches),
      verifications: usage(data?.requests?.verifications),
    };
    if (data?.requests?.credits) {
      account.credits = usage(data.requests.credits);
    }
    return account;
  }

  async domainSearch(params: HunterDomainSearchParams) {
    const query = {
      domain: params.domain,
      company: params.domain ? undefined : params.company,
      type: params.type,
      seniority: params.seniority?.join(','),
      department: params.department?.join(','),
      job_titles: params.jobTitles?.join(','),
      limit: params.limit,
      offset: params.offset,
    };
    const body = params.location
      ? await this.request(
          '/domain-search',
          {},
          {
            method: 'POST',
            body: {
              ...query,
              location: { include: [this.location(params.location)] },
            },
          },
        )
      : await this.request('/domain-search', query);
    const data = body?.data || {};
    const domain = text(data.domain);
    const company = text(data.organization);
    const emails: any[] = Array.isArray(data.emails) ? data.emails : [];
    return {
      domain,
      company,
      pattern: text(data.pattern),
      people: emails
        .filter((item) => text(item?.value))
        .map((item) => ({
          email: text(item.value).toLowerCase(),
          firstName: text(item.first_name),
          lastName: text(item.last_name),
          position: text(item.position),
          seniority: text(item.seniority),
          department: text(item.department),
          linkedinUrl: text(item.linkedin),
          phoneNumber: text(item.phone_number),
          company,
          domain,
          type: text(item.type),
          confidence: Number(item.confidence) || 0,
          verificationStatus: text(item.verification?.status),
          sourceUrl: text(item.sources?.[0]?.uri),
        })) as HunterPerson[],
      total: Number(body?.meta?.results) || 0,
      limit: Number(body?.meta?.limit) || params.limit || 10,
      offset: Number(body?.meta?.offset) || 0,
    };
  }

  async discover(params: HunterDiscoverParams) {
    const body = await this.request(
      '/discover',
      {},
      {
        method: 'POST',
        body: {
          organization: params.domain
            ? { domain: [params.domain] }
            : { name: [params.company] },
          headquarters_location: params.location
            ? { include: [this.location(params.location)] }
            : undefined,
          job_openings:
            params.hiring === undefined
              ? undefined
              : { hiring: params.hiring },
          limit: 1,
          offset: 0,
        },
      },
    );
    const data: any[] = Array.isArray(body?.data) ? body.data : [];
    return {
      companies: data.map((item) => ({
        domain: text(item?.domain),
        name: text(item?.organization),
        country: text(item?.country),
        state: text(item?.state),
        city: text(item?.city),
        headcount: text(item?.headcount),
      })),
      total: Number(body?.meta?.results) || 0,
    };
  }

  async findEmail(
    params: HunterEmailFinderParams,
  ): Promise<HunterPerson | null> {
    const data = await this.get('/email-finder', {
      domain: params.domain,
      company: params.domain ? undefined : params.company,
      first_name: params.firstName,
      last_name: params.lastName,
    });
    if (!text(data?.email)) return null;
    return {
      email: text(data.email).toLowerCase(),
      firstName: text(data.first_name) || params.firstName,
      lastName: text(data.last_name) || params.lastName,
      position: text(data.position),
      seniority: '',
      department: '',
      linkedinUrl: text(data.linkedin_url),
      phoneNumber: text(data.phone_number),
      company: text(data.company) || params.company || '',
      domain: text(data.domain),
      type: 'personal',
      confidence: Number(data.score) || 0,
      verificationStatus: text(data.verification?.status),
      sourceUrl: text(data.sources?.[0]?.uri),
    };
  }

  async verifyEmail(email: string) {
    const data = await this.get('/email-verifier', { email });
    return {
      email: text(data?.email) || email,
      status: text(data?.status) || 'unknown',
      score: Number(data?.score) || 0,
    };
  }

  private async get(
    path: string,
    query: Record<string, string | number | undefined>,
  ) {
    const body = await this.request(path, query);
    return body?.data;
  }

  private async request(
    path: string,
    query: Record<string, string | number | undefined>,
    options: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();

    let response: Response;
    try {
      response = await fetch(`${HUNTER_API_URL}${path}${qs ? `?${qs}` : ''}`, {
        method: options.method || (options.body === undefined ? 'GET' : 'POST'),
        headers: {
          'X-API-KEY': this.apiKey,
          Accept: 'application/json',
          ...(options.body === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(HUNTER_TIMEOUT_MS),
      });
    } catch (err) {
      throw new BadRequestException(
        `Could not reach Hunter: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BadRequestException(hunterErrorMessage(response.status, body));
    }
    return body;
  }

  private location(location: HunterLocation) {
    return {
      country: location.country?.trim().toUpperCase() || undefined,
      state: location.state?.trim() || undefined,
      city: location.city?.trim() || undefined,
      continent: location.continent?.trim() || undefined,
      business_region: location.businessRegion?.trim().toUpperCase() || undefined,
    };
  }
}
