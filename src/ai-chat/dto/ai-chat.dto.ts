import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export class CreateAiChatThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  reasoningEffort?: ReasoningEffort;
}

export class UpdateAiChatThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  reasoningEffort?: ReasoningEffort;
}

export class SendAiChatMessageDto {
  @IsString()
  @MaxLength(12000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  reasoningEffort?: ReasoningEffort;

  /** Only the explicit confirmation button may set this to true. */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
