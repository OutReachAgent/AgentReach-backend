import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CreateAiChatThreadDto,
  SendAiChatMessageDto,
  UpdateAiChatThreadDto,
} from './dto/ai-chat.dto';
import { AiChatService } from './ai-chat.service';

@ApiTags('ai-chat')
@Controller('ai-chat')
export class AiChatController {
  constructor(private readonly chat: AiChatService) {}

  @Get('models')
  @ApiOperation({ summary: 'List models and reasoning controls for AI chat' })
  models() {
    return this.chat.models();
  }

  @Get('threads')
  @ApiOperation({ summary: 'List the current user\'s AI conversations' })
  list(@Req() request: any) {
    return this.chat.listThreads(request.user.id);
  }

  @Post('threads')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Create an AI conversation' })
  create(@Req() request: any, @Body() dto: CreateAiChatThreadDto) {
    return this.chat.createThread(request.user.id, dto);
  }

  @Get('threads/:id')
  @ApiOperation({ summary: 'Get an AI conversation and its messages' })
  get(@Req() request: any, @Param('id') id: string) {
    return this.chat.getThread(request.user.id, id);
  }

  @Patch('threads/:id')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Update an AI conversation' })
  update(
    @Req() request: any,
    @Param('id') id: string,
    @Body() dto: UpdateAiChatThreadDto,
  ) {
    return this.chat.updateThread(request.user.id, id, dto);
  }

  @Delete('threads/:id')
  @ApiOperation({ summary: 'Delete an AI conversation' })
  remove(@Req() request: any, @Param('id') id: string) {
    return this.chat.removeThread(request.user.id, id);
  }

  @Post('threads/:id/messages/stream')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Stream an AI response and tool progress events' })
  async stream(
    @Req() request: any,
    @Param('id') id: string,
    @Body() dto: SendAiChatMessageDto,
    @Res() response: Response,
  ) {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) controller.abort();
    });
    await this.chat.streamMessage(
      request.user.id,
      id,
      dto,
      response,
      controller.signal,
    );
  }
}
