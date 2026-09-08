import { ScanMode } from '@prisma/client';
import { IsEnum, IsString, MinLength } from 'class-validator';

export class CreateScanDto {
  @IsString()
  @MinLength(1)
  assetId!: string;

  @IsEnum(ScanMode)
  mode!: ScanMode;
}
