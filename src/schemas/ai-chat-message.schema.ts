import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';

@Schema({ collection: 'AiChatMessage', timestamps: true })
export class AiChatMessage {
  @Prop({ default: () => randomUUID() })
  _id: string;

  @Prop({ type: String, required: true, index: true })
  ownerId: string;

  @Prop({ type: String, required: true, index: true })
  threadId: string;

  @Prop({ enum: ['user', 'assistant', 'tool'], required: true })
  role: 'user' | 'assistant' | 'tool';

  @Prop({ required: true })
  content: string;

  @Prop({ type: String, default: null })
  toolName?: string | null;

  @Prop({ type: Object, default: null })
  toolResult?: Record<string, unknown> | null;
}

export const AiChatMessageSchema = SchemaFactory.createForClass(AiChatMessage);
AiChatMessageSchema.index({ ownerId: 1, threadId: 1, createdAt: 1, _id: 1 });
