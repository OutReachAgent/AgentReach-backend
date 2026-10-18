import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { SettingsModule } from '../settings/settings.module';
import { ContactFinderController } from './contact-finder.controller';
import { ContactFinderService } from './contact-finder.service';

@Module({
  imports: [SettingsModule, ContactsModule],
  controllers: [ContactFinderController],
  providers: [ContactFinderService],
  exports: [ContactFinderService],
})
export class ContactFinderModule {}
