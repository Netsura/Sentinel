import { ScheduleFrequency, ScanMode } from '@prisma/client';
import { IsEnum, IsString, MinLength } from 'class-validator';

export class CreateScheduleDto {
  @IsString()
  @MinLength(1)
  assetId!: string;

  @IsEnum(ScanMode)
  mode!: ScanMode;

  @IsEnum(ScheduleFrequency)
  frequency!: ScheduleFrequency;
}
