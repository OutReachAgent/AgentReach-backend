import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const HUNTER_SENIORITIES = ['junior', 'senior', 'executive'] as const;
export const HUNTER_DEPARTMENTS = [
  'executive',
  'it',
  'finance',
  'management',
  'sales',
  'legal',
  'support',
  'hr',
  'marketing',
  'communication',
  'education',
  'design',
  'health',
  'operations',
  'product',
  'research',
  'consulting',
  'administrative',
  'procurement',
] as const;

export class ContactFinderSearchDto {
  @ApiProperty({ required: false, example: 'stripe.com' })
  @IsString()
  @MaxLength(253)
  @IsOptional()
  domain?: string;

  @ApiProperty({ required: false, example: 'Stripe' })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  company?: string;

  @ApiProperty({ required: false, enum: ['personal', 'generic'] })
  @IsIn(['personal', 'generic'])
  @IsOptional()
  type?: 'personal' | 'generic';

  @ApiProperty({ required: false, enum: HUNTER_SENIORITIES, isArray: true })
  @IsArray()
  @IsIn(HUNTER_SENIORITIES, { each: true })
  @IsOptional()
  seniority?: string[];

  @ApiProperty({ required: false, enum: HUNTER_DEPARTMENTS, isArray: true })
  @IsArray()
  @IsIn(HUNTER_DEPARTMENTS, { each: true })
  @IsOptional()
  department?: string[];

  @ApiProperty({ required: false, default: 10 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  offset?: number;
}

export class ContactFinderFindEmailDto {
  @ApiProperty({ required: false, example: 'stripe.com' })
  @IsString()
  @MaxLength(253)
  @IsOptional()
  domain?: string;

  @ApiProperty({ required: false, example: 'Stripe' })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  company?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;
}

export class ContactFinderVerifyDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class ContactFinderPersonDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  lastName?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  position?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  company?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  linkedinUrl?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  phoneNumber?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  confidence?: number;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  verificationStatus?: string;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  sourceUrl?: string;
}

export class ContactFinderSaveDto {
  @ApiProperty({ type: [ContactFinderPersonDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ContactFinderPersonDto)
  people: ContactFinderPersonDto[];

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  directoryId?: string;

  @ApiProperty({ enum: ['SKIP', 'OVERWRITE'], default: 'SKIP' })
  @IsIn(['SKIP', 'OVERWRITE'])
  @IsOptional()
  duplicateStrategy?: 'SKIP' | 'OVERWRITE';
}
