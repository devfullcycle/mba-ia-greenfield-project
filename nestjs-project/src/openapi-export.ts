import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app.module';
import { buildSwaggerDocument } from './swagger/swagger-document';

export async function exportSpec(outputPath = 'openapi.json'): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = buildSwaggerDocument(app);
  writeFileSync(outputPath, JSON.stringify(document, null, 2));
  await app.close();
}

if (require.main === module) {
  void exportSpec();
}
