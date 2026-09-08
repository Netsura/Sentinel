import { ReportFormat } from '@prisma/client';
import { IsEnum, IsString, MinLength } from 'class-validator';

export class CreateReportDto {
  @IsString()
  @MinLength(1)
  scanId!: string;

  @IsEnum(ReportFormat)
  format!: ReportFormat;
}
