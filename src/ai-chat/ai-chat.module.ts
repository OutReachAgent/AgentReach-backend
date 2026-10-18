import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BotModule } from '../bot/bot.module';
import { CallingCampaignsModule } from '../calling-campaigns/calling-campaigns.module';
import { ContactFinderModule } from '../contact-finder/contact-finder.module';
import { ContactsModule } from '../contacts/contacts.module';
import { EmailCampaignsModule } from '../email-campaigns/email-campaigns.module';
import { HistoryModule } from '../history/history.module';
import { MailboxModule } from '../mailbox/mailbox.module';
import { ProspectsModule } from '../prospects/prospects.module';
import { SettingsModule } from '../settings/settings.module';
import { SignalsModule } from '../signals/signals.module';
import { TemplatesModule } from '../templates/templates.module';
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';

@Module({
  imports: [
    AnalyticsModule,
    BotModule,
    CallingCampaignsModule,
    ContactFinderModule,
    ContactsModule,
    EmailCampaignsModule,
    HistoryModule,
    MailboxModule,
    ProspectsModule,
    SettingsModule,
    SignalsModule,
    TemplatesModule,
  ],
  controllers: [AiChatController],
  providers: [AiChatService],
})
export class AiChatModule {}
