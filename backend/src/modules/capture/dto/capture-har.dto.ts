import { IsUrl } from 'class-validator';

export class CaptureHarDto {
  @IsUrl({}, { message: 'Please provide a valid URL' })
  url: string;
}
