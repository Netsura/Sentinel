import { Confidence, FindingStatus, Severity } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class FindingQueryDto {
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @IsOptional()
  @IsEnum(FindingStatus)
  status?: FindingStatus;

  @IsOptional()
  @IsEnum(Confidence)
  confidence?: Confidence;

  @IsOptional()
  @IsString()
  search?: string;
}

export class UpdateFindingDto {
  @IsEnum(FindingStatus)
  status!: FindingStatus;
}
