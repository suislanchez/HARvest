import { IsString, MinLength } from 'class-validator';

export class AnalyzeHarDto {
  @IsString()
  @MinLength(5, { message: 'Description must be at least 5 characters' })
  description: string;
}
