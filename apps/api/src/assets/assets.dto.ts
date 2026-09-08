import { AssetType } from '@prisma/client';
import { IsEnum, IsString, MinLength } from 'class-validator';

export class CreateAssetDto {
  @IsEnum(AssetType)
  type!: AssetType;

  @IsString()
  @MinLength(3)
  value!: string;
}
