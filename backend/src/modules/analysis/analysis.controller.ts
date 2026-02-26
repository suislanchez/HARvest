import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AnalysisService } from './analysis.service';
import { AnalyzeHarDto } from './dto/analyze-har.dto';

@Controller('analyze')
export class AnalysisController {
  private readonly logger = new Logger(AnalysisController.name);

  constructor(private readonly analysisService: AnalysisService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
      fileFilter: (_req, file, cb) => {
        // Accept .har and .json files
        if (
          file.originalname.endsWith('.har') ||
          file.originalname.endsWith('.json') ||
          file.mimetype === 'application/json'
        ) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Only .har and .json files are accepted',
            ),
            false,
          );
        }
      },
    }),
  )
  async analyzeHar(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: AnalyzeHarDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    this.logger.log(
      `Analyzing HAR file: ${file.originalname} (${(file.size / 1024).toFixed(1)}KB)`,
    );

    return this.analysisService.analyzeHar(file.buffer, body.description);
  }
}
