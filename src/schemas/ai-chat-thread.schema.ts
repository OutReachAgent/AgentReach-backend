import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';

@Schema({ collection: 'AiChatThread', timestamps: true })
export class AiChatThread {
  @Prop({ default: () => randomUUID() })
  _id: string;

  @Prop({ type: String, required: true, index: true })
  ownerId: string;

  @Prop({ required: true, default: 'New conversation' })
  title: string;

  @Prop({ default: 'gemini-flash-lite-latest' })
  model: string;

  @Prop({ enum: ['low', 'medium', 'high'], default: 'medium' })
  reasoningEffort: 'low' | 'medium' | 'high';

  @Prop({ default: 'idle' })
  status: string;

  @Prop({ type: Object, default: null })
  pendingAction?: Record<string, unknown> | null;

  @Prop({ type: Date, default: null })
  lastMessageAt?: Date | null;
}

export const AiChatThreadSchema = SchemaFactory.createForClass(AiChatThread);
AiChatThreadSchema.index({ ownerId: 1, updatedAt: -1, _id: -1 });
