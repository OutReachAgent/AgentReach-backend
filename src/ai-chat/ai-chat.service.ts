import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { AnalyticsService } from '../analytics/analytics.service';
import { BotService } from '../bot/bot.service';
import { CallingCampaignsService } from '../calling-campaigns/calling-campaigns.service';
import { ContactFinderService } from '../contact-finder/contact-finder.service';
import { ContactsService } from '../contacts/contacts.service';
import { EmailCampaignsService } from '../email-campaigns/email-campaigns.service';
import { HistoryService } from '../history/history.service';
import { MailboxService } from '../mailbox/mailbox.service';
import { MongoService } from '../mongo.service';
import { ProspectsService } from '../prospects/prospects.service';
import {
  DEFAULT_GEMINI_TEXT_MODEL,
  GEMINI_TEXT_MODEL_OPTIONS,
  resolveGeminiTextModel,
} from '../config/gemini-text';
import { SettingsService } from '../settings/settings.service';
import { PlaybooksService } from '../signals/playbooks.service';
import { SignalsService } from '../signals/signals.service';
import { WatchService } from '../signals/watch.service';
import { TemplatesService } from '../templates/templates.service';
import {
  CreateAiChatThreadDto,
  ReasoningEffort,
  SendAiChatMessageDto,
  UpdateAiChatThreadDto,
} from './dto/ai-chat.dto';

type ToolCall = { name: string; args?: Record<string, unknown>; id?: string };
type ChatThread = Record<string, any>;

const MAX_TOOL_ROUNDS: Record<ReasoningEffort, number> = {
  low: 2,
  medium: 5,
  high: 8,
};

const TOOL_DECLARATIONS = [
  {
    name: 'get_workspace_data',
    description:
      'Read one area of the authenticated ReachConvert workspace. Use this for dashboard, contacts, campaigns, inbox, signals, history, calling agents, prospects, scheduler, profile, or integration status.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        area: {
          type: 'string',
          enum: [
            'dashboard',
            'contacts',
            'campaigns',
            'inbox',
            'signals',
            'history',
            'calling_agents',
            'prospects',
            'scheduler',
            'profile',
            'integrations',
          ],
        },
        query: { type: 'string' },
      },
      required: ['area'],
    },
  },
  {
    name: 'get_signal_insights',
    description:
      'Read a focused Signals view for the authenticated workspace. Use this for recent signal activity, signal performance, watched companies, or pending review actions. Never invent signal records or source links.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Optional signal type filter, such as hiring, funding, or leadership.',
        },
        includeReviewQueue: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'find_hiring_companies',
    description:
      'Use Prospect Finder to discover companies and people matching a hiring-focused description. This can take a while and requires a Gemini key.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        maxCompanies: { type: 'integer', minimum: 1, maximum: 25 },
        peoplePerCompany: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['description'],
    },
  },
  {
    name: 'find_contacts',
    description:
      'Use Contact Finder to discover work contacts for a company. Preserve confidence and verification details.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        company: { type: 'string' },
        jobTitles: { type: 'array', items: { type: 'string' } },
        hiring: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'save_contacts',
    description:
      'Save discovered contacts into the current workspace, optionally creating or using a directory. Default duplicate behavior is SKIP.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        people: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              firstName: { type: 'string' },
              lastName: { type: 'string' },
              position: { type: 'string' },
              company: { type: 'string' },
              linkedinUrl: { type: 'string' },
              phoneNumber: { type: 'string' },
              confidence: { type: 'number' },
              verificationStatus: { type: 'string' },
              sourceUrl: { type: 'string' },
            },
            required: ['email', 'firstName'],
          },
        },
        directoryName: { type: 'string' },
        duplicateStrategy: { type: 'string', enum: ['SKIP', 'OVERWRITE'] },
      },
      required: ['people'],
    },
  },
  {
    name: 'prepare_email_campaign',
    description:
      'Create an email template and draft campaign with selected contacts. Never launch it. Always return a preview and wait for explicit confirmation.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        goal: { type: 'string' },
        audience: { type: 'string' },
        tone: { type: 'string' },
        instructions: { type: 'string' },
        contactIds: { type: 'array', items: { type: 'string' } },
        templateId: { type: 'string' },
      },
      required: ['name', 'goal', 'audience', 'contactIds'],
    },
  },
  {
    name: 'prepare_calling_campaign',
    description:
      'Create a calling campaign draft with selected contacts. Never launch it. Always return a preview and wait for explicit confirmation.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        objective: { type: 'string' },
        prompt: { type: 'string' },
        contactIds: { type: 'array', items: { type: 'string' } },
        aiCallingBotId: { type: 'string' },
      },
      required: ['name', 'objective', 'contactIds'],
    },
  },
  {
    name: 'prepare_signal_action',
    description:
      'Prepare an approve or reject action for one pending Signal review match. Always show the Signal, contact, playbook, and preview, then wait for explicit confirmation before executing.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        matchId: { type: 'string' },
        action: { type: 'string', enum: ['approve', 'reject'] },
        note: { type: 'string' },
      },
      required: ['matchId', 'action'],
    },
  },
];

@Injectable()
export class AiChatService {
  constructor(
    private readonly db: MongoService,
    private readonly analytics: AnalyticsService,
    private readonly bots: BotService,
    private readonly callingCampaigns: CallingCampaignsService,
    private readonly contactFinder: ContactFinderService,
    private readonly contacts: ContactsService,
    private readonly emailCampaigns: EmailCampaignsService,
    private readonly history: HistoryService,
    private readonly mailbox: MailboxService,
    private readonly prospects: ProspectsService,
    private readonly settings: SettingsService,
    private readonly signals: SignalsService,
    private readonly playbooks: PlaybooksService,
    private readonly watches: WatchService,
    private readonly templates: TemplatesService,
  ) {}

  models() {
    return {
      models: GEMINI_TEXT_MODEL_OPTIONS,
      defaultModel: DEFAULT_GEMINI_TEXT_MODEL,
      reasoningEfforts: [
        { value: 'low', label: 'Low', description: 'Fast answers and simple lookups' },
        { value: 'medium', label: 'Medium', description: 'Normal multi-step work' },
        { value: 'high', label: 'High', description: 'Deep research and orchestration' },
      ],
    };
  }

  async listThreads(userId: string) {
    const threads = await this.db.aiChatThread.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return threads.map((thread: ChatThread) => this.threadSummary(thread));
  }

  async createThread(userId: string, dto: CreateAiChatThreadDto = {}) {
    const thread = await this.db.aiChatThread.create({
      data: {
        ownerId: userId,
        title: dto.title?.trim() || 'New conversation',
        model: this.normalizeModel(dto.model),
        reasoningEffort: dto.reasoningEffort || 'medium',
        status: 'idle',
        pendingAction: null,
        lastMessageAt: null,
      },
    });
    return this.threadSummary(thread);
  }

  async getThread(userId: string, id: string) {
    const thread = await this.getOwnedThread(userId, id);
    const messages = await this.db.aiChatMessage.findMany({
      where: { ownerId: userId, threadId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return { ...this.threadSummary(thread), pendingAction: thread.pendingAction || null, messages };
  }

  async updateThread(userId: string, id: string, dto: UpdateAiChatThreadDto) {
    await this.getOwnedThread(userId, id);
    return this.threadSummary(
      await this.db.aiChatThread.update({
        where: { id, ownerId: userId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() || 'New conversation' } : {}),
          ...(dto.model !== undefined ? { model: this.normalizeModel(dto.model) } : {}),
          ...(dto.reasoningEffort !== undefined ? { reasoningEffort: dto.reasoningEffort } : {}),
        },
      }),
    );
  }

  async removeThread(userId: string, id: string) {
    await this.getOwnedThread(userId, id);
    await this.db.aiChatMessage.deleteMany({ where: { ownerId: userId, threadId: id } });
    await this.db.aiChatThread.delete({ where: { id, ownerId: userId } });
    return { success: true };
  }

  async streamMessage(
    userId: string,
    id: string,
    dto: SendAiChatMessageDto,
    response: Response,
  ) {
    const thread = await this.getOwnedThread(userId, id);
    const content = dto.content.trim();
    if (!content) throw new BadRequestException('Message cannot be empty.');

    const model = this.normalizeModel(dto.model || thread.model);
    const reasoningEffort = dto.reasoningEffort || thread.reasoningEffort || 'medium';
    await this.db.aiChatThread.update({
      where: { id, ownerId: userId },
      data: { model, reasoningEffort, status: 'running', lastMessageAt: new Date() },
    });
    await this.db.aiChatMessage.create({
      data: { ownerId: userId, threadId: id, role: 'user', content },
    });

    if (thread.title === 'New conversation') {
      await this.db.aiChatThread.update({
        where: { id, ownerId: userId },
        data: { title: this.buildThreadTitle(content) },
      });
    }

    this.event(response, 'start', { threadId: id, model, reasoningEffort });

    try {
      if (dto.confirm && thread.pendingAction) {
        this.event(response, 'status', { label: 'Executing your confirmed action' });
        const result = await this.executePendingAction(userId, thread.pendingAction);
        await this.db.aiChatThread.update({
          where: { id, ownerId: userId },
          data: { pendingAction: null, status: 'idle' },
        });
        const answer = this.confirmationResult(thread.pendingAction, result);
        await this.saveAssistantMessage(userId, id, answer);
        this.event(response, 'delta', { text: answer });
        this.event(response, 'done', { pendingAction: null });
        return;
      }

      if (thread.pendingAction && /^(cancel|no|not now|stop)$/i.test(content)) {
        await this.db.aiChatThread.update({
          where: { id, ownerId: userId },
          data: { pendingAction: null, status: 'idle' },
        });
        const answer = 'Cancelled. Nothing was sent or launched.';
        await this.saveAssistantMessage(userId, id, answer);
        this.event(response, 'delta', { text: answer });
        this.event(response, 'done', { pendingAction: null });
        return;
      }

      const answer = await this.runAgent(userId, id, thread, content, model, reasoningEffort, response);
      await this.saveAssistantMessage(userId, id, answer);
      this.event(response, 'delta', { text: answer });
      const refreshed = await this.getOwnedThread(userId, id);
      this.event(response, 'done', { pendingAction: refreshed.pendingAction || null });
    } catch (error: any) {
      const message = error?.message || 'The assistant could not complete that request.';
      await this.db.aiChatThread.update({
        where: { id, ownerId: userId },
        data: { status: 'error' },
      });
      this.event(response, 'error', { message });
    } finally {
      if (!response.writableEnded) response.end();
    }
  }

  private async runAgent(
    userId: string,
    threadId: string,
    thread: ChatThread,
    content: string,
    model: string,
    reasoningEffort: ReasoningEffort,
    response: Response,
  ) {
    const settings = await this.settings.getRawSettings(userId);
    const apiKey = settings?.geminiApiKey?.trim();
    if (!apiKey) return this.fallbackAnswer(userId, content, response);

    const history = await this.db.aiChatMessage.findMany({
      where: { ownerId: userId, threadId },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });
    const contents: any[] = history
      .filter((item: any) => item.role === 'user' || item.role === 'assistant')
      .map((item: any) => ({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(item.content).slice(0, 12000) }],
      }));
    const ai = new GoogleGenAI({ apiKey });
    const toolResults: Array<{ name: string; result: unknown }> = [];
    const maxRounds = MAX_TOOL_ROUNDS[reasoningEffort];

    for (let round = 0; round < maxRounds; round++) {
      const generated: any = await ai.models.generateContent({
        model: resolveGeminiTextModel(model),
        contents,
        config: {
          maxOutputTokens: reasoningEffort === 'high' ? 5000 : reasoningEffort === 'low' ? 1400 : 2800,
          systemInstruction: this.systemInstruction(),
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
      });
      const calls: ToolCall[] = generated.functionCalls || [];
      if (!calls.length) {
        return String(generated.text || '').trim() || this.fallbackAnswer(userId, content, response);
      }

      const modelParts = generated.candidates?.[0]?.content?.parts;
      if (modelParts) contents.push({ role: 'model', parts: modelParts });
      for (const call of calls) {
        this.event(response, 'tool_start', { name: call.name, args: call.args || {} });
        const result = await this.executeTool(userId, threadId, call.name, call.args || {}, response);
        toolResults.push({ name: call.name, result });
        await this.db.aiChatMessage.create({
          data: {
            ownerId: userId,
            threadId,
            role: 'tool',
            content: JSON.stringify(result).slice(0, 24000),
            toolName: call.name,
            toolResult: this.jsonObject(result),
          },
        });
        this.event(response, 'tool_result', { name: call.name, result });
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name: call.name, response: { result } } }],
        });
      }
    }

    return `I completed the available research steps but reached the ${reasoningEffort} reasoning limit. ${toolResults.length} tool operation(s) ran. Please ask me to continue if you want a deeper pass.`;
  }

  private async executeTool(
    userId: string,
    threadId: string,
    name: string,
    args: Record<string, unknown>,
    response: Response,
  ): Promise<unknown> {
    switch (name) {
      case 'get_workspace_data':
        return this.workspaceData(userId, String(args.area || 'dashboard'), String(args.query || ''));
      case 'get_signal_insights':
        return this.signalInsights(userId, args);
      case 'find_hiring_companies':
        return this.findHiringCompanies(userId, args, response);
      case 'find_contacts':
        return this.contactFinder.search(userId, {
          domain: this.optionalString(args.domain),
          company: this.optionalString(args.company),
          jobTitles: this.stringArray(args.jobTitles),
          hiring: args.hiring === true,
          limit: this.clampNumber(args.limit, 10, 1, 100),
        });
      case 'save_contacts':
        return this.saveContacts(userId, args);
      case 'prepare_email_campaign':
        return this.prepareEmailCampaign(userId, threadId, args);
      case 'prepare_calling_campaign':
        return this.prepareCallingCampaign(userId, threadId, args);
      case 'prepare_signal_action':
        return this.prepareSignalAction(userId, threadId, args);
      default:
        throw new BadRequestException(`Unknown assistant tool: ${name}`);
    }
  }

  private async workspaceData(userId: string, area: string, query: string) {
    switch (area) {
      case 'dashboard':
        return this.analytics.getDashboardAnalytics(userId);
      case 'contacts':
        return this.contacts.findAll(userId, { page: 1, limit: 50, search: query || undefined } as any);
      case 'campaigns':
        return {
          email: await this.emailCampaigns.findAll(userId),
          calling: await this.callingCampaigns.findAll(userId),
        };
      case 'inbox':
        return this.mailbox.listThreads(userId, {
          folder: 'inbox',
          page: 1,
          limit: 30,
          search: query || undefined,
        } as any);
      case 'signals':
        return {
          stats: await this.signals.getStats(userId),
          feed: await this.signals.getFeed(userId),
          reviewQueue: await this.signals.getReviewQueue(userId),
          watches: await this.watches.findAll(userId),
          playbooks: await this.playbooks.findAll(userId),
        };
      case 'history':
        return {
          emails: await this.history.getEmailHistory(userId, {}),
          calls: await this.history.getCallHistory(userId, {}),
        };
      case 'calling_agents':
        return this.bots.findAll(userId);
      case 'prospects':
        return this.prospects.listSearches(userId);
      case 'scheduler': {
        const [email, calling] = await Promise.all([
          this.emailCampaigns.findAll(userId),
          this.callingCampaigns.findAll(userId),
        ]);
        return {
          email: (email as any[]).filter((item) => item.status === 'SCHEDULED'),
          calling: (calling as any[]).filter((item) => item.status === 'SCHEDULED'),
        };
      }
      case 'profile':
        return this.db.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, name: true, initials: true, title: true, company: true, phone: true, theme: true, accentColor: true },
        });
      case 'integrations':
        return this.settings.getSettings(userId);
      default:
        throw new BadRequestException(`Unknown workspace area: ${area}`);
    }
  }

  private async signalInsights(userId: string, args: Record<string, unknown>) {
    const type = this.optionalString(args.type);
    const limit = this.clampNumber(args.limit, 20, 1, 50);
    const [stats, feed, watches, playbooks] = await Promise.all([
      this.signals.getStats(userId),
      this.signals.getFeed(userId, type ? { type } : {}),
      this.watches.findAll(userId),
      this.playbooks.findAll(userId),
    ]);
    const reviewQueue = args.includeReviewQueue === false
      ? []
      : await this.signals.getReviewQueue(userId);
    return {
      stats,
      feed: feed.slice(0, limit),
      reviewQueue: reviewQueue.slice(0, limit),
      watches,
      playbooks,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async findHiringCompanies(userId: string, args: Record<string, unknown>, response: Response) {
    const description = String(args.description || 'companies currently hiring').trim();
    this.event(response, 'status', { label: 'Building a prospect profile' });
    const profile = await this.prospects.buildProfile(userId, {
      description: description.length < 10 ? `${description} companies` : description,
      maxCompanies: this.clampNumber(args.maxCompanies, 10, 1, 25),
    } as any);
    const search = await this.prospects.createSearch(userId, {
      mode: 'icp',
      description,
      profile: profile.profile,
      maxCompanies: this.clampNumber(args.maxCompanies, 10, 1, 25),
      peoplePerCompany: this.clampNumber(args.peoplePerCompany, 3, 1, 10),
    } as any);
    this.event(response, 'status', { label: 'Searching companies and people' });
    const outcome = await this.prospects.run(userId, search.id, new AbortController().signal);
    const [companies, people] = await Promise.all([
      this.prospects.listCompanies(userId, search.id),
      this.prospects.listPeople(userId, search.id),
    ]);
    return {
      search: outcome,
      profile: profile.profile,
      companies: (companies as any[]).slice(0, 50),
      people: (people as any[]).slice(0, 100),
    };
  }

  private async prepareEmailCampaign(userId: string, threadId: string, args: Record<string, unknown>) {
    const contactIds = this.stringArray(args.contactIds).slice(0, 200);
    if (!contactIds.length) throw new BadRequestException('Select at least one contact before preparing a campaign.');
    const name = String(args.name || 'AI outreach campaign').trim();
    let templateId = this.optionalString(args.templateId);
    let template: any;
    if (templateId) {
      template = await this.templates.findOne(templateId, userId);
    } else {
      const generated = await this.templates.generateAiTemplate({
        goal: String(args.goal || 'Start a relevant business conversation'),
        audience: String(args.audience || 'Relevant decision makers'),
        tone: String(args.tone || 'professional, concise, and warm'),
        instructions: this.optionalString(args.instructions),
        format: 'HTML',
      } as any, userId);
      template = await this.templates.create({
        name: `${name} template`,
        subject: generated.subject,
        bodyHtml: generated.bodyHtml,
        bodyText: generated.bodyText,
        type: 'AI',
        goal: String(args.goal || ''),
        audience: String(args.audience || ''),
        tone: String(args.tone || ''),
        instructions: this.optionalString(args.instructions),
      } as any, userId);
      templateId = template.id;
    }
    const campaign = await this.emailCampaigns.create({
      name,
      templateId,
      trackOpens: true,
      unsubscribeLink: true,
    } as any, userId);
    const recipientResult = await this.emailCampaigns.addContacts(campaign.id, { contactIds } as any, userId);
    const contacts = await this.db.contact.findMany({ where: { ownerId: userId, id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true, email: true, company: true, jobTitle: true } });
    const pendingAction = {
      id: randomUUID(),
      kind: 'launch_email_campaign',
      campaignId: campaign.id,
      campaignName: campaign.name,
      contactCount: contacts.length,
    };
    await this.db.aiChatThread.update({ where: { id: threadId, ownerId: userId }, data: { pendingAction } });
    return { preview: { campaign, template, contacts, recipientResult }, requiresConfirmation: true, pendingAction };
  }

  private async saveContacts(userId: string, args: Record<string, unknown>) {
    const people = Array.isArray(args.people) ? args.people.filter((item) => item && typeof item === 'object') : [];
    if (!people.length) throw new BadRequestException('Provide at least one discovered contact to save.');
    const directoryName = this.optionalString(args.directoryName);
    let directoryId: string | undefined;
    if (directoryName) {
      const existing = (await this.contacts.findDirectories(userId) as any[]).find(
        (directory) => String(directory.name).toLowerCase() === directoryName.toLowerCase(),
      );
      directoryId = existing?.id;
      if (!directoryId) {
        const directory = await this.contacts.createDirectory({ name: directoryName, description: 'Created by AI Command Center' }, userId);
        directoryId = directory.id;
      }
    }
    const result = await this.contactFinder.save(userId, {
      people: people.slice(0, 200).map((item: any) => ({
        email: String(item.email || '').trim().toLowerCase(),
        firstName: String(item.firstName || '').trim(),
        lastName: String(item.lastName || '').trim(),
        position: this.optionalString(item.position),
        company: this.optionalString(item.company),
        linkedinUrl: this.optionalString(item.linkedinUrl),
        phoneNumber: this.optionalString(item.phoneNumber),
        confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
        verificationStatus: this.optionalString(item.verificationStatus),
        sourceUrl: this.optionalString(item.sourceUrl),
      })),
      directoryId,
      duplicateStrategy: args.duplicateStrategy === 'OVERWRITE' ? 'OVERWRITE' : 'SKIP',
    } as any);
    const emails = people.map((item: any) => String(item.email || '').trim().toLowerCase()).filter(Boolean);
    const saved = await this.db.contact.findMany({
      where: { ownerId: userId, email: { in: emails } },
      select: { id: true, firstName: true, lastName: true, email: true, company: true, jobTitle: true, directoryId: true },
    });
    return { ...result, directory: directoryId ? { id: directoryId, name: directoryName } : null, contacts: saved };
  }

  private async prepareCallingCampaign(userId: string, threadId: string, args: Record<string, unknown>) {
    const contactIds = this.stringArray(args.contactIds).slice(0, 200);
    if (!contactIds.length) throw new BadRequestException('Select at least one contact before preparing a calling campaign.');
    const campaign = await this.callingCampaigns.create({
      name: String(args.name || 'AI calling campaign'),
      objective: String(args.objective || 'Qualify the contact and capture a next step'),
      prompt: this.optionalString(args.prompt),
      aiCallingBotId: this.optionalString(args.aiCallingBotId),
      contactIds,
    } as any, userId);
    const pendingAction = {
      id: randomUUID(),
      kind: 'launch_calling_campaign',
      campaignId: campaign.id,
      campaignName: campaign.name,
      contactCount: contactIds.length,
    };
    await this.db.aiChatThread.update({ where: { id: threadId, ownerId: userId }, data: { pendingAction } });
    return { campaign, requiresConfirmation: true, pendingAction };
  }

  private async prepareSignalAction(userId: string, threadId: string, args: Record<string, unknown>) {
    const matchId = this.optionalString(args.matchId);
    const action = args.action === 'reject' ? 'reject' : args.action === 'approve' ? 'approve' : undefined;
    if (!matchId || !action) {
      throw new BadRequestException('A Signal match and approve/reject action are required.');
    }

    const queue = await this.signals.getReviewQueue(userId);
    const match = (queue as any[]).find((item) => item.matchId === matchId);
    if (!match) throw new BadRequestException('That Signal review is no longer pending. Refresh the Signals queue and try again.');

    const pendingAction = {
      id: randomUUID(),
      kind: 'review_signal_match',
      matchId,
      action,
      note: this.optionalString(args.note),
      signalTitle: match.signal?.title,
      companyName: match.signal?.companyName,
      contactName: match.contact?.name,
      playbookName: match.playbook?.name,
    };
    await this.db.aiChatThread.update({ where: { id: threadId, ownerId: userId }, data: { pendingAction } });
    return { review: match, requiresConfirmation: true, pendingAction };
  }

  private async executePendingAction(userId: string, action: Record<string, unknown>) {
    if (action.kind === 'launch_email_campaign') return this.emailCampaigns.launchCampaign(String(action.campaignId), userId);
    if (action.kind === 'launch_calling_campaign') return this.callingCampaigns.launchCampaign(String(action.campaignId), userId);
    if (action.kind === 'review_signal_match') {
      return this.signals.reviewMatch(String(action.matchId), {
        action: action.action === 'reject' ? 'reject' : 'approve',
        note: this.optionalString(action.note),
      }, userId);
    }
    throw new BadRequestException('This confirmation has expired.');
  }

  private confirmationResult(action: Record<string, unknown>, result: unknown) {
    if (action.kind === 'review_signal_match') {
      const outcome = action.action === 'reject' ? 'rejected' : 'approved and launched';
      return `Signal review ${outcome} for “${String(action.signalTitle || 'Signal')}” at ${String(action.companyName || 'the matched company')} / ${String(action.contactName || 'the matched contact')}.

` + '```json\n' + JSON.stringify(result, null, 2) + '\n```';
    }
    const channel = action.kind === 'launch_email_campaign' ? 'email campaign' : 'calling campaign';
    return `Launched the ${channel} “${String(action.campaignName || '')}” for ${String(action.contactCount || 0)} contact(s).\n\n` +
      '```json\n' + JSON.stringify(result, null, 2) + '\n```';
  }

  private async fallbackAnswer(userId: string, content: string, response: Response) {
    const lower = content.toLowerCase();
    let area = '';
    if (lower.includes('dashboard') || lower.includes('performance') || lower.includes('metrics')) area = 'dashboard';
    else if (lower.includes('inbox') || lower.includes('unread') || lower.includes('reply')) area = 'inbox';
    else if (lower.includes('signal') || lower.includes('hiring')) area = 'signals';
    else if (lower.includes('contact')) area = 'contacts';
    else if (lower.includes('campaign')) area = 'campaigns';
    else if (lower.includes('history')) area = 'history';
    if (area) {
      const data = await this.workspaceData(userId, area, '');
      return 'Gemini is not configured, so I can only provide structured workspace data right now. Configure Gemini in Settings for natural-language orchestration.\n\n' +
        '```json\n' + JSON.stringify(data, null, 2).slice(0, 18000) + '\n```';
    }
    this.event(response, 'status', { label: 'Gemini configuration required for this request' });
    return 'Connect a Gemini API key in Settings to use the AI Command Center for research, enrichment, campaign drafting, and multi-step actions.';
  }

  private systemInstruction() {
    return `You are ReachConvert AI Command Center, an authenticated outreach operations assistant. You can use only the typed tools provided to access the current user's workspace. Never invent data. Use read tools before proposing actions. For email, calling, and Signal review actions, prepare a draft or preview but never execute it until the application receives explicit confirmation. Preserve source URLs, confidence, verification status, and Signal timestamps. Do not reveal private chain-of-thought; give concise progress and final answers. When a tool returns a large result, summarize the important counts and records. The user is in a sales/outreach workspace with Prospect Finder, Contact Finder, Contacts, Email Campaigns, Inbox, AI Calling, Calling Agents, Signals, Scheduler, History, Dashboard, Profile, and Settings.`;
  }

  private buildThreadTitle(content: string) {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized) return 'New conversation';
    const withoutQuestion = normalized.replace(/[?!.]+$/, '');
    return withoutQuestion.length > 52
      ? `${withoutQuestion.slice(0, 49).trimEnd()}…`
      : withoutQuestion;
  }

  private async saveAssistantMessage(userId: string, threadId: string, content: string) {
    await this.db.aiChatMessage.create({ data: { ownerId: userId, threadId, role: 'assistant', content } });
    await this.db.aiChatThread.update({ where: { id: threadId, ownerId: userId }, data: { status: 'idle', lastMessageAt: new Date() } });
  }

  private async getOwnedThread(userId: string, id: string) {
    const thread = await this.db.aiChatThread.findUnique({ where: { id, ownerId: userId } });
    if (!thread) throw new NotFoundException('AI conversation not found');
    return thread;
  }

  private threadSummary(thread: ChatThread) {
    return {
      id: thread.id,
      title: thread.title,
      model: thread.model,
      reasoningEffort: thread.reasoningEffort,
      status: thread.status,
      hasPendingAction: Boolean(thread.pendingAction),
      pendingAction: thread.pendingAction || null,
      lastMessageAt: thread.lastMessageAt,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    };
  }

  private normalizeModel(value?: string | null) {
    const candidate = value?.trim();
    return GEMINI_TEXT_MODEL_OPTIONS.some((item) => item.value === candidate)
      ? candidate!
      : DEFAULT_GEMINI_TEXT_MODEL;
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private stringArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : [];
  }

  private clampNumber(value: unknown, fallback: number, min: number, max: number) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  private jsonObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    return { value };
  }

  private event(response: Response, event: string, data: unknown) {
    if (response.writableEnded) return;
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
