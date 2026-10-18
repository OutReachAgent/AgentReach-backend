import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ContactFinderFindEmailDto,
  ContactFinderSaveDto,
  ContactFinderSearchDto,
  ContactFinderVerifyDto,
} from './dto/contact-finder.dto';
import { ContactFinderService } from './contact-finder.service';

@ApiTags('contact-finder')
@Controller('contact-finder')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ContactFinderController {
  constructor(private readonly contactFinder: ContactFinderService) {}

  @Get('account')
  @ApiOperation({ summary: 'Hunter.io plan and remaining searches' })
  account(@Req() request: any) {
    return this.contactFinder.account(request.user.id);
  }

  @Post('search')
  @ApiOperation({
    summary: 'Find people at a company with Hunter.io (uses Hunter credits)',
  })
  search(@Req() request: any, @Body() dto: ContactFinderSearchDto) {
    return this.contactFinder.search(request.user.id, dto);
  }

  @Post('find-email')
  @ApiOperation({
    summary:
      "Find one person's work email with Hunter.io (uses Hunter credits)",
  })
  findEmail(@Req() request: any, @Body() dto: ContactFinderFindEmailDto) {
    return this.contactFinder.findEmail(request.user.id, dto);
  }

  @Post('verify')
  @ApiOperation({
    summary: 'Verify an email address with Hunter.io (uses Hunter credits)',
  })
  verify(@Req() request: any, @Body() dto: ContactFinderVerifyDto) {
    return this.contactFinder.verify(request.user.id, dto);
  }

  @Post('save')
  @ApiOperation({ summary: 'Save selected people to Contacts' })
  save(@Req() request: any, @Body() dto: ContactFinderSaveDto) {
    return this.contactFinder.save(request.user.id, dto);
  }
}
